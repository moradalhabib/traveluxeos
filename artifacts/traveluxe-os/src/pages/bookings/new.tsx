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
import ProductPicker, { type OrderLine } from "@/components/booking/ProductPicker";
import { FlightLookupCard } from "@/components/booking/FlightLookupCard";

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
  client_id: z.string().optional(),
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
  price: z.coerce.number().optional().default(0),
  tvl_commission: z.coerce.number().optional().default(0),
  payment_status: z.string().default("Unpaid"),
  payment_method: z.string().optional(),
  source: z.string().optional(),
  status: z.string().default("Confirmed"),
  driver_id: z.string().optional(),
  notes: z.string().optional(),
  duration: z.coerce.number().optional(),
  // As Directed / Chauffeuring fields
  driver2_name: z.string().optional(),
  driver3_name: z.string().optional(),
  chauffeuring_notes: z.string().optional(),
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
  // Hotel fields
  hotel_name: z.string().optional(),
  room_type: z.string().optional(),
  hotel_booking_ref: z.string().optional(),
  breakfast_included: z.boolean().optional(),
  num_guests: z.coerce.number().optional(),
  num_nights: z.coerce.number().optional(),
  // Commission (Hotel / Apartment third-party)
  commission_amount: z.coerce.number().min(0).default(0),
  commission_notes: z.string().optional(),
  // Apartment-specific financials
  weekly_rent: z.coerce.number().optional(),
  pre_deposit: z.coerce.number().optional(),
  weeks_agreed: z.coerce.number().optional(),
  property_agent: z.string().optional(),
  payment_notes: z.string().optional(),
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
  const [orderLines, setOrderLines] = useState<OrderLine[]>([]);
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
  const watchedFlightNumber = bookingForm.watch("flight_number") ?? "";
  const watchedDirection = bookingForm.watch("direction") ?? "Arrival";
  const price = bookingForm.watch("price") || 0;
  const commission = bookingForm.watch("tvl_commission") || 0;
  const driverReceives = price - commission;
  const checkIn = bookingForm.watch("check_in_date");
  const checkOut = bookingForm.watch("check_out_date");
  const isTourType = serviceType === "Tour";
  const isAccommodation = serviceType === "Apartment";
  const isHotel = serviceType === "Hotel";
  const isAsDirected = serviceType === "As Directed";
  const needsCommission = isHotel || isAccommodation;

  // Clear order lines when switching to accommodation types (no vehicles)
  useEffect(() => {
    if (isHotel || isAccommodation) {
      setOrderLines([]);
    }
  }, [serviceType]);

  // Auto-calculate nights when check-in/check-out change
  useEffect(() => {
    if (checkIn && checkOut) {
      const days = Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000);
      if (days > 0) {
        if (isHotel) bookingForm.setValue("num_nights", days);
        else bookingForm.setValue("nights", days);
      }
    }
  }, [checkIn, checkOut, isHotel]);

  // Populate client_id from URL param on mount (coming from client profile)
  useEffect(() => {
    const params = new URLSearchParams(search);
    const clientId = params.get("client_id");
    if (clientId) {
      loadClientById(clientId);
    }
  }, []);

  // Auto-update price when order lines change (if total > 0)
  useEffect(() => {
    if (orderLines.length > 0) {
      const total = orderLines.reduce((s, l) => s + l.unit_price * l.quantity, 0);
      bookingForm.setValue("price", total);
    }
  }, [orderLines]);

  // Auto-fill vehicle_type from the selected Vehicle product in orderLines
  useEffect(() => {
    const vehicleLine = orderLines.find(l => l.category === "Vehicle");
    if (vehicleLine) {
      bookingForm.setValue("vehicle_type", vehicleLine.name);
    }
  }, [orderLines]);

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

  const onBookingSubmit = async (values: z.infer<typeof bookingSchema>) => {
    // Only include fields that exist as columns in the bookings table
    const allowedPayload: Record<string, any> = {
      client_id: values.client_id,
      service_type: values.service_type,
      direction: values.direction,
      pickup: values.pickup,
      dropoff: values.dropoff,
      destination: values.destination,
      flight_number: values.flight_number,
      date_time: values.date_time,
      passengers: values.passengers,
      luggage: values.luggage,
      vehicle_type: values.vehicle_type,
      nameboard: values.nameboard,
      special_requests: values.extras
        ? `${values.special_requests ? values.special_requests + "\n" : ""}Extras: ${values.extras}`
        : values.special_requests,
      additional_charges: values.additional_charges,
      price: values.price,
      tvl_commission: values.tvl_commission,
      payment_status: values.payment_status,
      payment_method: values.payment_method,
      source: values.source,
      status: values.status,
      driver_id: values.driver_id,
      notes: values.notes,
      duration: values.duration,
    };

    // Fold service-specific details into notes so data is preserved
    const extraDetails: string[] = [];
    // 2nd/3rd driver — all transport types (multi-vehicle bookings)
    if (!["Hotel", "Apartment"].includes(values.service_type)) {
      if (values.driver2_name) extraDetails.push(`Driver 2: ${values.driver2_name}`);
      if (values.driver3_name) extraDetails.push(`Driver 3: ${values.driver3_name}`);
    }
    if (values.service_type === "As Directed") {
      if (values.check_in_date) extraDetails.push(`Rental Start: ${values.check_in_date}`);
      if (values.check_out_date) extraDetails.push(`Rental Return: ${values.check_out_date}`);
      if (values.chauffeuring_notes) extraDetails.push(`Service Notes: ${values.chauffeuring_notes}`);
    }
    if (values.service_type === "Tour") {
      if (values.tour_name) extraDetails.push(`Tour: ${values.tour_name}`);
      if (values.meeting_point) extraDetails.push(`Meeting Point: ${values.meeting_point}`);
      if (values.itinerary) extraDetails.push(`Itinerary: ${values.itinerary}`);
      if (values.guide_included) extraDetails.push(`Guide: Included`);
      if (values.destination) allowedPayload.destination = values.destination;
    }
    if (values.service_type === "Hotel") {
      if (values.hotel_name) extraDetails.push(`Hotel: ${values.hotel_name}`);
      if (values.room_type) extraDetails.push(`Room: ${values.room_type}`);
      if (values.hotel_booking_ref) extraDetails.push(`Booking Ref: ${values.hotel_booking_ref}`);
      if (values.check_in_date) extraDetails.push(`Check-in: ${values.check_in_date}`);
      if (values.check_out_date) extraDetails.push(`Check-out: ${values.check_out_date}`);
      if (values.num_nights) extraDetails.push(`Nights: ${values.num_nights}`);
      if (values.num_guests) extraDetails.push(`Guests: ${values.num_guests}`);
      if (values.breakfast_included) extraDetails.push(`Breakfast: Included`);
      if (values.commission_amount) extraDetails.push(`Commission: £${values.commission_amount}${values.commission_notes ? ` — ${values.commission_notes}` : ""}`);
    }
    if (values.service_type === "Apartment") {
      if (values.property_name) extraDetails.push(`Property: ${values.property_name}`);
      if (values.property_address) extraDetails.push(`Address: ${values.property_address}`);
      if (values.check_in_date) extraDetails.push(`Check-in: ${values.check_in_date}`);
      if (values.check_out_date) extraDetails.push(`Check-out: ${values.check_out_date}`);
      if (values.nights) extraDetails.push(`Nights: ${values.nights}`);
      if (values.property_contact) extraDetails.push(`Contact: ${values.property_contact}`);
      if (values.commission_amount) extraDetails.push(`Commission: £${values.commission_amount}${values.commission_notes ? ` — ${values.commission_notes}` : ""}`);
      // Rental financials
      if (values.weekly_rent) extraDetails.push(`Weekly Rent: £${values.weekly_rent}`);
      if (values.weeks_agreed) extraDetails.push(`Weeks Agreed: ${values.weeks_agreed}`);
      if (values.pre_deposit) extraDetails.push(`Pre-Deposit: £${values.pre_deposit}`);
      if (values.property_agent) extraDetails.push(`Agent: ${values.property_agent}`);
      if (values.payment_notes) extraDetails.push(`Payment Notes: ${values.payment_notes}`);
    }
    if (extraDetails.length > 0) {
      const base = allowedPayload.notes ? `${allowedPayload.notes}\n---\n` : "";
      allowedPayload.notes = base + extraDetails.join(" | ");
    }

    // Remove undefined / empty string values to avoid sending nulls unnecessarily
    Object.keys(allowedPayload).forEach((k) => {
      if (allowedPayload[k] === undefined || allowedPayload[k] === "") {
        delete allowedPayload[k];
      }
    });

    if (allowedPayload.driver_id === "unassigned") delete allowedPayload.driver_id;

    createBooking.mutate(
      { data: allowedPayload as any },
      {
        onSuccess: async (booking: any) => {
          // Save order lines if any
          if (orderLines.length > 0) {
            const lines = orderLines.map(l => ({
              booking_id: booking.id,
              product_id: l.product_id,
              name: l.name,
              unit_price: l.unit_price,
              quantity: l.quantity,
              notes: l.notes ?? null,
            }));
            await supabase.from("booking_products").insert(lines);
          }
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
                            <SelectItem value="As Directed">As Directed</SelectItem>
                            <SelectItem value="Apartment">Apartment</SelectItem>
                            <SelectItem value="Hotel">Hotel</SelectItem>
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
                    <FormField control={bookingForm.control} name="source" render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>Source</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="WhatsApp">WhatsApp</SelectItem>
                            <SelectItem value="Snapchat">Snapchat</SelectItem>
                            <SelectItem value="Referral">Referral</SelectItem>
                            <SelectItem value="Returning Client">Returning Client</SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </CardContent>
              </Card>

              {/* Journey / Property Details */}
              <Card className="border-primary/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {(isAccommodation || isHotel) ? "Property Details" : isAsDirected ? "Chauffeuring Details" : "Journey Details"}
                  </CardTitle>
                </CardHeader>
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
                            <FormControl><Input placeholder="BA123" {...field} className="uppercase" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      {serviceType === "Airport Transfer" && (
                        <FlightLookupCard
                          flightNumber={watchedFlightNumber}
                          direction={watchedDirection}
                          onAutoFill={(dateTime, origin, destination) => {
                            bookingForm.setValue("date_time", dateTime);
                            if (watchedDirection === "Arrival" && origin) {
                              bookingForm.setValue("pickup", origin);
                            }
                            if (watchedDirection === "Departure" && destination) {
                              bookingForm.setValue("dropoff", destination);
                            }
                          }}
                        />
                      )}
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

                  {isAsDirected && (
                    <div className="space-y-3 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
                      <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Chauffeuring Period</p>
                      <div className="grid grid-cols-2 gap-3">
                        <FormField control={bookingForm.control} name="check_in_date" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Rental Start Date</FormLabel>
                            <FormControl><Input type="datetime-local" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="check_out_date" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Rental Return Date</FormLabel>
                            <FormControl><Input type="datetime-local" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                    </div>
                  )}

                  {isHotel && (
                    <div className="space-y-3 p-3 rounded-xl border border-blue-500/20 bg-blue-500/5">
                      <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Hotel Details</p>
                      <div className="grid grid-cols-2 gap-3">
                        <FormField control={bookingForm.control} name="hotel_name" render={({ field }) => (
                          <FormItem className="col-span-2">
                            <FormLabel>Hotel Name</FormLabel>
                            <FormControl><Input placeholder="e.g. The Savoy, Claridge's, Amba" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="room_type" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Room Type</FormLabel>
                            <FormControl><Input placeholder="e.g. Standard Room, Suite" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="hotel_booking_ref" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Booking Ref</FormLabel>
                            <FormControl><Input placeholder="External booking reference" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="check_in_date" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Check-in</FormLabel>
                            <FormControl><Input type="date" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="check_out_date" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Check-out</FormLabel>
                            <FormControl><Input type="date" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="num_nights" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Nights</FormLabel>
                            <FormControl><Input type="number" min="1" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="num_guests" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Guests</FormLabel>
                            <FormControl><Input type="number" min="1" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <div className="col-span-2 flex items-center gap-3 pt-1">
                          <input
                            type="checkbox"
                            id="breakfast_included"
                            className="w-4 h-4 accent-primary"
                            onChange={(e) => bookingForm.setValue("breakfast_included", e.target.checked)}
                          />
                          <label htmlFor="breakfast_included" className="text-sm font-medium cursor-pointer">Breakfast included</label>
                        </div>
                      </div>
                    </div>
                  )}

                  {isAccommodation && (
                    <div className="space-y-3 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
                      <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Apartment Details</p>
                      <div className="grid grid-cols-2 gap-3">
                        <FormField control={bookingForm.control} name="property_name" render={({ field }) => (
                          <FormItem className="col-span-2">
                            <FormLabel>Property Name</FormLabel>
                            <FormControl><Input placeholder="e.g. Hyde Park Penthouse" {...field} /></FormControl>
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
                            <FormControl><Input type="date" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="check_out_date" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Check-out</FormLabel>
                            <FormControl><Input type="date" {...field} /></FormControl>
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

                  {/* Pickup / Dropoff / Passengers / Luggage — transport services only */}
                  {(serviceType === "Airport Transfer" || serviceType === "As Directed") && (
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
                  )}

                  {/* Chauffeuring service notes — As Directed only */}
                  {isAsDirected && (
                    <FormField control={bookingForm.control} name="chauffeuring_notes" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Service Notes <span className="text-xs text-muted-foreground font-normal">(visible on booking record)</span></FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="e.g. Daily Chauffeuring. 10 Hours per day (in-city). Additional fuel charge for outside journeys."
                            className="resize-none" rows={2} {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}

                  {/* Passengers only (no pickup/dropoff) for Tour */}
                  {serviceType === "Tour" && (
                    <div className="grid grid-cols-2 gap-3">
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
                  )}

                  {/* Extras — transport only */}
                  {!isAccommodation && !isHotel && (
                    <FormField control={bookingForm.control} name="extras" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Extras <span className="text-xs text-muted-foreground font-normal">(child seat, flowers, champagne, etc.)</span></FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Child seat, bouquet of flowers" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}

                  <FormField control={bookingForm.control} name="special_requests" render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {isAccommodation || isHotel ? "Note to Manager" : "Special Requests"}
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={isAccommodation || isHotel
                            ? "Instructions or requests for the property manager..."
                            : "Client preferences, notes for driver..."}
                          className="resize-none" rows={2} {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </CardContent>
              </Card>

              {/* Products / Order Lines — transport & tours only */}
              {!isAccommodation && !isHotel && (
                <Card className="border-primary/10">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">
                      {serviceType === "Airport Transfer" && "Vehicle · Meet & Greet · Extras"}
                      {serviceType === "Tour" && "Tour · Vehicle · Extras"}
                      {serviceType === "As Directed" && "Vehicle · Extras"}
                      {(!serviceType || !["Airport Transfer","Tour","As Directed"].includes(serviceType)) && "Products & Order Lines"}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Select step by step — price totals automatically.
                    </p>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ProductPicker
                      orderLines={orderLines}
                      onChange={(lines) => setOrderLines(lines)}
                      serviceType={serviceType}
                    />
                  </CardContent>
                </Card>
              )}

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
                        <FormLabel>TVL Commission (£)</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    {!needsCommission && (
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Driver Gets</Label>
                        <div className="h-10 flex items-center px-3 border border-border rounded-md bg-muted/50 font-bold text-primary">
                          £{driverReceives.toFixed(0)}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Third-party Commission — Hotel & Apartment only */}
                  {needsCommission && (
                    <div className="space-y-3 p-3 rounded-xl border border-primary/20 bg-primary/5">
                      <p className="text-xs font-semibold text-primary uppercase tracking-wider">Third-party Commission</p>
                      <div className="grid grid-cols-2 gap-3">
                        <FormField control={bookingForm.control} name="commission_amount" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Commission Paid (£)</FormLabel>
                            <FormControl><Input type="number" step="0.01" placeholder="0.00" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="commission_notes" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Commission Notes</FormLabel>
                            <FormControl><Input placeholder="e.g. Agent: XYZ Travels" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                    </div>
                  )}

                  {/* Apartment rental financials */}
                  {isAccommodation && (
                    <div className="space-y-3 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
                      <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Rental Terms</p>
                      <div className="grid grid-cols-2 gap-3">
                        <FormField control={bookingForm.control} name="weekly_rent" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Weekly Rent (£)</FormLabel>
                            <FormControl><Input type="number" step="1" placeholder="0" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="weeks_agreed" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Weeks Agreed</FormLabel>
                            <FormControl><Input type="number" min="1" step="1" placeholder="e.g. 4" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="pre_deposit" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Pre-Deposit (£)</FormLabel>
                            <FormControl><Input type="number" step="1" placeholder="Confirms booking" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Est. Total Rent</Label>
                          <div className="h-10 flex items-center px-3 border border-border rounded-md bg-muted/50 font-bold text-amber-400">
                            £{((bookingForm.watch("weekly_rent") || 0) * (bookingForm.watch("weeks_agreed") || 0)).toLocaleString()}
                          </div>
                        </div>
                        <FormField control={bookingForm.control} name="property_agent" render={({ field }) => (
                          <FormItem className="col-span-2">
                            <FormLabel>Property Agent / Source</FormLabel>
                            <FormControl><Input placeholder="e.g. Foxtons, Knight Frank, Direct landlord" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="payment_notes" render={({ field }) => (
                          <FormItem className="col-span-2">
                            <FormLabel>Payment Notes <span className="text-xs text-muted-foreground font-normal">(extensions, weekly payments received, etc.)</span></FormLabel>
                            <FormControl><Textarea placeholder="e.g. Week 1 cash received 01/04. Client extended by 2 weeks on 14/04..." className="resize-none" rows={2} {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                    </div>
                  )}

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
                            <SelectItem value="PayPal">PayPal</SelectItem>
                            <SelectItem value="Cash">Cash</SelectItem>
                            {isAccommodation && <SelectItem value="Cash Weekly">Cash (Weekly)</SelectItem>}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  {/* Driver & Vehicle — transport only, not for accommodation */}
                  {!isAccommodation && !isHotel && (
                    <>
                      <FormField control={bookingForm.control} name="driver_id" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Assign Driver <span className="text-muted-foreground font-normal text-xs">(optional)</span></FormLabel>
                          <Select
                            onValueChange={(val) => {
                              field.onChange(val);
                              if (val && val !== "unassigned") {
                                const selected = drivers?.find((d: any) => d.id === val);
                                if (selected?.vehicle_model) {
                                  bookingForm.setValue("vehicle_type", selected.vehicle_model);
                                }
                              } else {
                                bookingForm.setValue("vehicle_type", "");
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

                      <FormField control={bookingForm.control} name="vehicle_type" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Vehicle <span className="text-xs text-muted-foreground font-normal">(auto-filled from driver · override if needed)</span></FormLabel>
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

                      {/* 2nd & 3rd Driver — all transport types (multi-vehicle bookings) */}
                      <div className="grid grid-cols-2 gap-3">
                        <FormField control={bookingForm.control} name="driver2_name" render={({ field }) => (
                          <FormItem>
                            <FormLabel>2nd Driver <span className="text-xs text-muted-foreground font-normal">(optional — multi-vehicle)</span></FormLabel>
                            <Select onValueChange={(val) => field.onChange(val === "none" ? "" : val)} value={field.value || "none"}>
                              <FormControl><SelectTrigger><SelectValue placeholder="None" /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="none">None</SelectItem>
                                {drivers?.map((driver: any) => (
                                  <SelectItem key={driver.id} value={driver.name}>
                                    {driver.name} · {driver.vehicle_model || driver.vehicle_type}
                                    {driver.plate ? ` (${driver.plate})` : ""}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="driver3_name" render={({ field }) => (
                          <FormItem>
                            <FormLabel>3rd Driver <span className="text-xs text-muted-foreground font-normal">(optional — multi-vehicle)</span></FormLabel>
                            <Select onValueChange={(val) => field.onChange(val === "none" ? "" : val)} value={field.value || "none"}>
                              <FormControl><SelectTrigger><SelectValue placeholder="None" /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="none">None</SelectItem>
                                {drivers?.map((driver: any) => (
                                  <SelectItem key={driver.id} value={driver.name}>
                                    {driver.name} · {driver.vehicle_model || driver.vehicle_type}
                                    {driver.plate ? ` (${driver.plate})` : ""}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                    </>
                  )}

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
