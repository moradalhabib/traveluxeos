import { useState, useEffect, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateBooking, useCreateClient, useListDrivers, getListDriversQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, Check, UserPlus, AlertTriangle, ArrowLeft, Phone } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { format } from "date-fns";
import { Label } from "@/components/ui/label";

type Phase = "lookup" | "found" | "register" | "booking";

interface FoundClient {
  id: string;
  name: string;
  whatsapp: string;
  email: string | null;
  nationality: string | null;
  vip_tier: string;
  lastBooking?: { tvl_ref: string; date_time: string; service_type: string; status: string } | null;
}

const registerSchema = z.object({
  name: z.string().min(2, "Name required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  nationality: z.string().optional(),
  vip_tier: z.string().default("Standard"),
});

const bookingSchema = z.object({
  client_id: z.string().min(1),
  service_type: z.string(),
  direction: z.string().optional(),
  pickup: z.string().optional(),
  dropoff: z.string().optional(),
  destination: z.string().optional(),
  flight_number: z.string().optional(),
  date_time: z.string().optional(),
  passengers: z.coerce.number().optional(),
  luggage: z.coerce.number().optional(),
  vehicle_type: z.string().optional(),
  nameboard: z.string().optional(),
  special_requests: z.string().optional(),
  extras: z.string().optional(),
  additional_charges: z.coerce.number().optional(),
  price: z.coerce.number().min(0, "Enter the price"),
  tvl_commission: z.coerce.number().min(0).default(0),
  payment_status: z.string().default("Unpaid"),
  payment_method: z.string().optional(),
  source: z.string().optional(),
  status: z.string().default("Confirmed"),
  driver_id: z.string().optional(),
  notes: z.string().optional(),
  duration: z.coerce.number().optional(),
  // Tour fields
  tour_name: z.string().optional(),
  meeting_point: z.string().optional(),
  guide_included: z.boolean().optional(),
  itinerary: z.string().optional(),
  // Accommodation fields
  property_name: z.string().optional(),
  property_address: z.string().optional(),
  check_in_date: z.string().optional(),
  check_out_date: z.string().optional(),
  nights: z.coerce.number().optional(),
  property_contact: z.string().optional(),
});

export default function NewBooking() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();

  const [phase, setPhase] = useState<Phase>("lookup");
  const [waInput, setWaInput] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [foundClient, setFoundClient] = useState<FoundClient | null>(null);
  const [confirmedClient, setConfirmedClient] = useState<FoundClient | null>(null);
  const [nameDuplicateWarning, setNameDuplicateWarning] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const createBooking = useCreateBooking();
  const createClient = useCreateClient();
  const { data: drivers } = useListDrivers({}, { query: { enabled: true, queryKey: getListDriversQueryKey({}) } });

  const registerForm = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", nationality: "", vip_tier: "Standard" },
  });

  const bookingForm = useForm<z.infer<typeof bookingSchema>>({
    resolver: zodResolver(bookingSchema),
    defaultValues: {
      client_id: "",
      service_type: "Airport Transfer",
      price: 0,
      tvl_commission: 0,
      status: "Confirmed",
      payment_status: "Unpaid",
      passengers: 1,
      luggage: 0,
      direction: "Arrival",
    },
  });

  const serviceType = bookingForm.watch("service_type");
  const price = bookingForm.watch("price") || 0;
  const commission = bookingForm.watch("tvl_commission") || 0;
  const driverReceives = price - commission;
  const isTourType = ["Tour", "City Tour", "Chauffeur Tour"].includes(serviceType);
  const isAccommodation = serviceType === "Apartment / Accommodation";

  // Populate client_id from URL param on mount (coming from client profile)
  useEffect(() => {
    const params = new URLSearchParams(search);
    const clientId = params.get("client_id");
    if (clientId) {
      loadClientById(clientId);
    }
  }, []);

  const loadClientById = async (clientId: string) => {
    const { data } = await supabase
      .from("clients")
      .select("id, name, whatsapp, email, nationality, vip_tier")
      .eq("id", clientId)
      .maybeSingle();
    if (data) {
      const client = data as FoundClient;
      const lastBooking = await fetchLastBooking(client.id);
      client.lastBooking = lastBooking;
      setFoundClient(client);
      setWaInput(client.whatsapp);
      setPhase("found");
    }
  };

  const fetchLastBooking = async (clientId: string) => {
    const { data } = await supabase
      .from("bookings")
      .select("tvl_ref, date_time, service_type, status")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data as any;
  };

  // Live WhatsApp search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const normalized = waInput.replace(/\D/g, "");
    if (normalized.length < 6) {
      setFoundClient(null);
      if (phase === "found") setPhase("lookup");
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const { data } = await supabase
          .from("clients")
          .select("id, name, whatsapp, email, nationality, vip_tier")
          .or(`whatsapp.ilike.%${normalized}%,whatsapp.ilike.%${waInput.trim()}%`)
          .eq("inactive", false)
          .limit(1)
          .maybeSingle();

        if (data) {
          const client = data as FoundClient;
          const lastBooking = await fetchLastBooking(client.id);
          client.lastBooking = lastBooking;
          setFoundClient(client);
          setPhase("found");
        } else {
          setFoundClient(null);
          if (normalized.length >= 8) {
            setPhase("register");
          } else {
            setPhase("lookup");
          }
        }
      } finally {
        setIsSearching(false);
      }
    }, 400);
  }, [waInput]);

  // Name duplicate check
  const watchedName = registerForm.watch("name");
  useEffect(() => {
    if (watchedName.length < 3) { setNameDuplicateWarning(null); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, name")
        .ilike("name", `%${watchedName}%`)
        .limit(1)
        .maybeSingle();
      if (data) setNameDuplicateWarning((data as any).name);
      else setNameDuplicateWarning(null);
    }, 600);
    return () => clearTimeout(t);
  }, [watchedName]);

  const confirmFoundClient = (client: FoundClient) => {
    setConfirmedClient(client);
    bookingForm.setValue("client_id", client.id);
    if (client.name) bookingForm.setValue("nameboard", client.name);
    setPhase("booking");
  };

  const handleRegisterAndContinue = (values: z.infer<typeof registerSchema>) => {
    createClient.mutate(
      {
        data: {
          name: values.name,
          whatsapp: waInput,
          email: values.email || undefined,
          nationality: values.nationality,
          vip_tier: values.vip_tier,
        },
      },
      {
        onSuccess: (newClient: any) => {
          const client: FoundClient = {
            id: newClient.id,
            name: newClient.name,
            whatsapp: waInput,
            email: newClient.email,
            nationality: newClient.nationality,
            vip_tier: newClient.vip_tier,
          };
          confirmFoundClient(client);
          toast({ title: `Client "${newClient.name}" registered` });
        },
        onError: () => toast({ title: "Error registering client", variant: "destructive" }),
      }
    );
  };

  const onBookingSubmit = (values: z.infer<typeof bookingSchema>) => {
    const payload = { ...values };
    if (values.driver_id === "unassigned") delete (payload as any).driver_id;
    createBooking.mutate(
      { data: payload },
      {
        onSuccess: (booking: any) => {
          toast({ title: "Booking created" });
          setLocation(`/bookings/${booking.id}`);
        },
        onError: () => toast({ title: "Error creating booking", variant: "destructive" }),
      }
    );
  };

  const getVipColor = (tier: string) => {
    if (tier === "VVIP") return "bg-purple-500/20 text-purple-400 border-purple-500/50";
    if (tier === "VIP") return "bg-primary/20 text-primary border-primary/50";
    return "bg-secondary text-secondary-foreground border-border";
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/bookings")} className="-ml-2">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">New Booking</h1>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        <div className={`flex items-center gap-1.5 font-medium ${phase !== "booking" ? "text-primary" : "text-muted-foreground"}`}>
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${phase !== "booking" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
            {confirmedClient ? <Check className="w-3 h-3" /> : "1"}
          </div>
          Client
        </div>
        <div className="flex-1 h-px bg-border" />
        <div className={`flex items-center gap-1.5 font-medium ${phase === "booking" ? "text-primary" : "text-muted-foreground"}`}>
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${phase === "booking" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
            2
          </div>
          Booking Details
        </div>
      </div>

      {/* === PHASE: LOOKUP / FOUND / REGISTER === */}
      {phase !== "booking" && (
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Phone className="w-4 h-4 text-primary" />
              Client WhatsApp Number
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* WhatsApp input */}
            <div className="relative">
              <Input
                type="tel"
                placeholder="+44 7700 000000"
                value={waInput}
                onChange={(e) => setWaInput(e.target.value)}
                className="text-lg h-12 pr-10 font-mono"
                autoFocus
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {isSearching ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : waInput.replace(/\D/g, "").length >= 6 ? (
                  foundClient ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Search className="w-4 h-4 text-muted-foreground" />
                  )
                ) : null}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Type the client's WhatsApp number — we'll check if they're already registered</p>

            {/* === Client FOUND === */}
            {phase === "found" && foundClient && (
              <div className="rounded-xl border border-green-500/40 bg-green-500/5 p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-foreground text-lg">{foundClient.name}</span>
                      <Badge variant="outline" className={getVipColor(foundClient.vip_tier)}>{foundClient.vip_tier}</Badge>
                    </div>
                    {foundClient.nationality && (
                      <p className="text-sm text-muted-foreground">{foundClient.nationality}</p>
                    )}
                  </div>
                  <div className="w-9 h-9 rounded-full bg-green-500/20 flex items-center justify-center">
                    <Check className="w-5 h-5 text-green-500" />
                  </div>
                </div>
                {foundClient.lastBooking && (
                  <div className="text-xs text-muted-foreground border-t border-border pt-2">
                    Last booking: <span className="text-foreground font-medium">{foundClient.lastBooking.tvl_ref}</span> · {foundClient.lastBooking.service_type} ·{" "}
                    {foundClient.lastBooking.date_time ? format(new Date(foundClient.lastBooking.date_time), "dd MMM yyyy") : ""} ·{" "}
                    <Badge variant="outline" className="text-[10px] py-0 px-1">{foundClient.lastBooking.status}</Badge>
                  </div>
                )}
                <Button className="w-full h-11" onClick={() => confirmFoundClient(foundClient)}>
                  <Check className="w-4 h-4 mr-2" />
                  Confirm & Continue with {foundClient.name.split(" ")[0]}
                </Button>
                <button className="text-xs text-muted-foreground underline w-full text-center" onClick={() => { setFoundClient(null); setPhase("lookup"); setWaInput(""); }}>
                  Not this person? Clear and re-enter
                </button>
              </div>
            )}

            {/* === NO MATCH — Register new client === */}
            {phase === "register" && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm text-foreground">New client — register on the spot</span>
                </div>

                {nameDuplicateWarning && (
                  <div className="flex items-center gap-2 text-amber-500 text-xs bg-amber-500/10 border border-amber-500/30 rounded-lg p-2">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                    Similar name already exists: <strong className="ml-1">{nameDuplicateWarning}</strong>
                  </div>
                )}

                <Form {...registerForm}>
                  <form onSubmit={registerForm.handleSubmit(handleRegisterAndContinue)} className="space-y-3">
                    <FormField control={registerForm.control} name="name" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full Name *</FormLabel>
                        <FormControl><Input placeholder="e.g. Mohammed Al-Rashid" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={registerForm.control} name="nationality" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nationality</FormLabel>
                          <FormControl><Input placeholder="e.g. Saudi" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={registerForm.control} name="vip_tier" render={({ field }) => (
                        <FormItem>
                          <FormLabel>VIP Tier</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="Standard">Standard</SelectItem>
                              <SelectItem value="VIP">VIP</SelectItem>
                              <SelectItem value="VVIP">VVIP</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={registerForm.control} name="email" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                        <FormControl><Input type="email" placeholder="email@example.com" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <Button type="submit" className="w-full" disabled={createClient.isPending}>
                      {createClient.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      <UserPlus className="w-4 h-4 mr-2" />
                      Register & Continue to Booking
                    </Button>
                  </form>
                </Form>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* === PHASE: BOOKING FORM === */}
      {phase === "booking" && confirmedClient && (
        <>
          {/* Confirmed client strip */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-green-500/10 border border-green-500/30">
            <div className="flex items-center gap-3">
              <Check className="w-4 h-4 text-green-500" />
              <div>
                <span className="font-semibold text-foreground">{confirmedClient.name}</span>
                <span className="text-xs text-muted-foreground ml-2">{confirmedClient.whatsapp}</span>
              </div>
              <Badge variant="outline" className={getVipColor(confirmedClient.vip_tier)}>{confirmedClient.vip_tier}</Badge>
            </div>
            <button onClick={() => { setConfirmedClient(null); setPhase("lookup"); setWaInput(""); }} className="text-xs text-muted-foreground underline">Change</button>
          </div>

          <Form {...bookingForm}>
            <form onSubmit={bookingForm.handleSubmit(onBookingSubmit)} className="space-y-5">

              {/* Service & Schedule */}
              <Card className="border-primary/10">
                <CardHeader className="pb-3"><CardTitle className="text-base">Service & Schedule</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={bookingForm.control} name="service_type" render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>Service Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="Airport Transfer">Airport Transfer</SelectItem>
                            <SelectItem value="Tour">Tour</SelectItem>
                            <SelectItem value="City Tour">City Tour</SelectItem>
                            <SelectItem value="Chauffeur Tour">Chauffeur Tour</SelectItem>
                            <SelectItem value="As Directed">As Directed</SelectItem>
                            <SelectItem value="Event Transfer">Event Transfer</SelectItem>
                            <SelectItem value="Apartment / Accommodation">Apartment / Accommodation</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={bookingForm.control} name="date_time" render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>Date & Time</FormLabel>
                        <FormControl><Input type="datetime-local" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={bookingForm.control} name="vehicle_type" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Vehicle <span className="text-xs text-muted-foreground font-normal">(make &amp; model)</span></FormLabel>
                        <FormControl>
                          <Input
                            list="fleet-vehicles-list"
                            placeholder="e.g. MB V-Class, Range Rover"
                            {...field}
                          />
                        </FormControl>
                        <datalist id="fleet-vehicles-list">
                          {drivers?.map((d: any) => d.vehicle_model && (
                            <option key={d.id} value={d.vehicle_model} />
                          ))}
                          <option value="MB V-Class" />
                          <option value="MB S-Class" />
                          <option value="MB E-Class" />
                          <option value="MB GLS" />
                          <option value="BMW 7 Series" />
                          <option value="Range Rover" />
                          <option value="Rolls-Royce Ghost" />
                          <option value="Bentley Flying Spur" />
                          <option value="Toyota Alphard" />
                          <option value="VW Caravelle" />
                        </datalist>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={bookingForm.control} name="source" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Source</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="WhatsApp">WhatsApp</SelectItem>
                            <SelectItem value="Snapchat">Snapchat</SelectItem>
                            <SelectItem value="Referral">Referral</SelectItem>
                            <SelectItem value="Returning">Returning</SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </CardContent>
              </Card>

              {/* Journey Details */}
              <Card className="border-primary/10">
                <CardHeader className="pb-3"><CardTitle className="text-base">Journey Details</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {serviceType === "Airport Transfer" && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <FormField control={bookingForm.control} name="direction" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Direction</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="Arrival">Arrival</SelectItem>
                                <SelectItem value="Departure">Departure</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="flight_number" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Flight No.</FormLabel>
                            <FormControl><Input placeholder="BA123" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      <FormField control={bookingForm.control} name="nameboard" render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Meet &amp; Greet Name Board
                            <span className="text-xs text-muted-foreground font-normal ml-1">(auto-filled from client name)</span>
                          </FormLabel>
                          <FormControl>
                            <Input placeholder={confirmedClient?.name || "Name for board"} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </>
                  )}

                  {isTourType && (
                    <div className="space-y-3 p-3 rounded-xl border border-primary/20 bg-primary/5">
                      <p className="text-xs font-semibold text-primary uppercase tracking-wider">Tour Details</p>
                      <div className="grid grid-cols-2 gap-3">
                        <FormField control={bookingForm.control} name="tour_name" render={({ field }) => (
                          <FormItem className="col-span-2">
                            <FormLabel>Tour Name</FormLabel>
                            <FormControl><Input placeholder="e.g. Oxford & Cotswolds Day Trip" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="meeting_point" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Meeting Point</FormLabel>
                            <FormControl><Input placeholder="e.g. Hotel lobby, Big Ben" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="duration" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Duration (hrs)</FormLabel>
                            <FormControl><Input type="number" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="itinerary" render={({ field }) => (
                          <FormItem className="col-span-2">
                            <FormLabel>Itinerary / Programme</FormLabel>
                            <FormControl><Textarea placeholder="Stop 1: Windsor Castle&#10;Stop 2: Stonehenge&#10;..." className="resize-none" rows={3} {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="destination" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Destination / Route</FormLabel>
                            <FormControl><Input placeholder="e.g. London to Cotswolds" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <div className="flex items-center gap-3 pt-5">
                          <input
                            type="checkbox"
                            id="guide_included"
                            className="w-4 h-4 accent-primary"
                            onChange={(e) => bookingForm.setValue("guide_included", e.target.checked)}
                          />
                          <label htmlFor="guide_included" className="text-sm font-medium cursor-pointer">Guide included</label>
                        </div>
                      </div>
                    </div>
                  )}

                  {isAccommodation && (
                    <div className="space-y-3 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
                      <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Accommodation Details</p>
                      <div className="grid grid-cols-2 gap-3">
                        <FormField control={bookingForm.control} name="property_name" render={({ field }) => (
                          <FormItem className="col-span-2">
                            <FormLabel>Property Name</FormLabel>
                            <FormControl><Input placeholder="e.g. The Dorchester, Hyde Park Penthouse" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="property_address" render={({ field }) => (
                          <FormItem className="col-span-2">
                            <FormLabel>Property Address</FormLabel>
                            <FormControl><Input placeholder="Full address" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="check_in_date" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Check-in</FormLabel>
                            <FormControl><Input type="datetime-local" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="check_out_date" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Check-out</FormLabel>
                            <FormControl><Input type="datetime-local" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="nights" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Nights</FormLabel>
                            <FormControl><Input type="number" min="1" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="property_contact" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Property Contact</FormLabel>
                            <FormControl><Input placeholder="Manager / concierge number" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={bookingForm.control} name="pickup" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pickup</FormLabel>
                        <FormControl><Input placeholder="Address or Airport" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={bookingForm.control} name="dropoff" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Dropoff</FormLabel>
                        <FormControl><Input placeholder="Address or Airport" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={bookingForm.control} name="passengers" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Passengers</FormLabel>
                        <FormControl><Input type="number" min="1" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={bookingForm.control} name="luggage" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Luggage</FormLabel>
                        <FormControl><Input type="number" min="0" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <FormField control={bookingForm.control} name="extras" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Extras <span className="text-xs text-muted-foreground font-normal">(child seat, flowers, champagne, etc.)</span></FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Child seat, bouquet of flowers" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={bookingForm.control} name="special_requests" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Special Requests</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Client preferences, notes for driver..." className="resize-none" rows={2} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </CardContent>
              </Card>

              {/* Financials */}
              <Card className="border-primary/10">
                <CardHeader className="pb-3"><CardTitle className="text-base">Financials &amp; Assignment</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <FormField control={bookingForm.control} name="price" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Price (£)</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} className="text-lg font-bold" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={bookingForm.control} name="tvl_commission" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Commission (£)</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Driver Gets</Label>
                      <div className="h-10 flex items-center px-3 border border-border rounded-md bg-muted/50 font-bold text-primary">
                        £{driverReceives.toFixed(0)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={bookingForm.control} name="payment_status" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Payment</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="Unpaid">Unpaid</SelectItem>
                            <SelectItem value="Paid">Paid</SelectItem>
                            <SelectItem value="Partial">Partial</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={bookingForm.control} name="payment_method" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Method</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Method" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="Card">Card / Link</SelectItem>
                            <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                            <SelectItem value="Cash">Cash (To Driver)</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <FormField control={bookingForm.control} name="driver_id" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Assign Driver <span className="text-muted-foreground font-normal text-xs">(optional)</span></FormLabel>
                      <Select
                        onValueChange={(val) => {
                          field.onChange(val);
                          // Auto-fill vehicle from selected driver's vehicle_model
                          if (val && val !== "unassigned") {
                            const selected = drivers?.find((d: any) => d.id === val);
                            if (selected?.vehicle_model) {
                              bookingForm.setValue("vehicle_type", selected.vehicle_model);
                            }
                          }
                        }}
                        defaultValue={field.value}
                      >
                        <FormControl><SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="unassigned">Unassigned</SelectItem>
                          {drivers?.map((driver: any) => (
                            <SelectItem key={driver.id} value={driver.id}>
                              {driver.name} · {driver.vehicle_model || driver.vehicle_type}
                              {driver.plate ? ` (${driver.plate})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={bookingForm.control} name="notes" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Internal Notes <span className="text-muted-foreground font-normal text-xs">(not shared with client or driver)</span></FormLabel>
                      <FormControl>
                        <Textarea placeholder="Operator-only notes..." className="resize-none" rows={2} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </CardContent>
              </Card>

              <Button type="submit" className="w-full h-13 text-base font-semibold shadow-[0_0_20px_rgba(201,168,76,0.3)]" disabled={createBooking.isPending}>
                {createBooking.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Create Booking
              </Button>
            </form>
          </Form>
        </>
      )}
    </div>
  );
}
