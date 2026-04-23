import { useState, useEffect, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateBooking, useCreateClient, useListDrivers, getListDriversQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { TimePicker } from "@/components/ui/time-picker";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, Check, UserPlus, AlertTriangle, ArrowLeft, Phone, Pencil, X, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { format } from "date-fns";
import { isoToLondonInput, londonInputToIso } from "@/lib/datetime";
import { Label } from "@/components/ui/label";
import ProductPicker, { type OrderLine } from "@/components/booking/ProductPicker";
import { SupplierProductPicker } from "@/components/SupplierProductPicker";
import { AirportTransferProductPicker, type TransferExtra } from "@/components/booking/AirportTransferProductPicker";
import { NATIONALITIES, nationalityFlag } from "@/lib/nationalities";
import { Switch } from "@/components/ui/switch";
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
  airport_code: z.string().optional(),
  hours: z.coerce.number().optional(),
  direction: z.string().optional(),
  pickup: z.string().optional(),
  dropoff: z.string().optional(),
  destination: z.string().optional(),
  flight_number: z.string().optional(),
  date_time: z.string().optional(),
  passengers: z.coerce.number().optional(),
  luggage: z.coerce.number().optional(),
  vehicle_type: z.string().optional(),
  vehicle_preference: z.string().optional(),
  // Feature 4 — Commission Split (referral partner)
  referral_partner_name: z.string().optional(),
  referral_commission_type: z.enum(["percent", "amount"]).optional(),
  referral_commission_value: z.coerce.number().optional(),
  nameboard: z.string().optional(),
  special_requests: z.string().optional(),
  extras: z.string().optional(),
  additional_charges: z.coerce.number().optional(),
  price: z.coerce.number().optional(),
  tvl_commission: z.coerce.number().optional().default(0),
  payment_status: z.string().default("Unpaid"),
  payment_method: z.string().optional(),
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
  tour_product_id: z.string().optional(),
  tour_alt_label: z.string().optional(),
  tour_alt_uplift: z.coerce.number().optional(),
  tour_base_price: z.coerce.number().optional(),
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
  // Hotel-only inputs (NOT persisted as columns — folded into price / commission_amount / notes)
  hotel_cost_per_night: z.coerce.number().min(0).optional(),
  hotel_sold_per_night: z.coerce.number().min(0).optional(),
  hotel_third_party: z.string().optional(),
  // Apartment-specific financials
  weekly_rent: z.coerce.number().optional(),
  pre_deposit: z.coerce.number().optional(),
  weeks_agreed: z.coerce.number().optional(),
  property_agent: z.string().optional(),
  payment_notes: z.string().optional(),
  // Build 4 — Supplier link + Car Rental / As Directed cost breakdown
  supplier_id: z.string().optional(),
  supplier_product_id: z.string().optional(),
  supplier_commission: z.coerce.number().optional(),
  // Manual override — used when the supplier has no products configured,
  // so the operator can enter the cost directly and TVL Commission can be
  // computed as client_price - supplier_cost.
  supplier_cost: z.coerce.number().optional(),
  base_daily_rate: z.coerce.number().optional(),
  rental_days: z.coerce.number().optional(),
  fuel_cost: z.coerce.number().optional(),
  driver_cost: z.coerce.number().optional(),
  extra_charges: z.array(z.object({
    description: z.string().optional().default(""),
    amount: z.coerce.number().optional().default(0),
  })).optional(),
  as_directed_supplier_driver: z.boolean().optional().default(false),
  overtime_hours: z.coerce.number().optional().default(0),
  // Airport Transfer pricing matrix
  vehicle_product_id: z.string().optional(),
  meet_greet_product_id: z.string().optional(),
  transfer_extras: z.array(z.object({
    id: z.string(),
    name: z.string(),
    price: z.coerce.number(),
  })).optional().default([]),
});

export default function NewBooking() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();

  const [phase, setPhase] = useState<Phase>("lookup");
  const [waInput, setWaInput] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  // Feature 4 — operator opens the Commission Split block per booking. We
  // also auto-open it whenever the booking already has a referral_partner_name
  // (e.g. when re-rendering an edit) — handled at the render site below.
  const [showReferralSplit, setShowReferralSplit] = useState(false);
  const [showVehiclePref, setShowVehiclePref] = useState(false);
  const [showVehicleOverride, setShowVehicleOverride] = useState(false);
  const [foundClient, setFoundClient] = useState<FoundClient | null>(null);
  const [confirmedClient, setConfirmedClient] = useState<FoundClient | null>(null);
  const [isEditingFound, setIsEditingFound] = useState(false);
  const [savingFoundEdit, setSavingFoundEdit] = useState(false);
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

  const editFoundForm = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", nationality: "", vip_tier: "Standard" },
  });

  const startEditFound = () => {
    if (!foundClient) return;
    editFoundForm.reset({
      name: foundClient.name || "",
      email: foundClient.email || "",
      nationality: foundClient.nationality || "",
      vip_tier: foundClient.vip_tier || "Standard",
    });
    setIsEditingFound(true);
  };

  const handleSaveFoundEdit = async (values: z.infer<typeof registerSchema>) => {
    if (!foundClient) return;
    setSavingFoundEdit(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token;
      const res = await fetch(`/api/clients/${foundClient.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          name: values.name,
          email: values.email || null,
          nationality: values.nationality || null,
          vip_tier: values.vip_tier,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update client");
      }
      const updated = await res.json();
      setFoundClient({
        ...foundClient,
        name: updated.name,
        email: updated.email,
        nationality: updated.nationality,
        vip_tier: updated.vip_tier,
      });
      setIsEditingFound(false);
      toast({ title: "Client updated", description: `${updated.name}'s profile has been saved.` });
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    } finally {
      setSavingFoundEdit(false);
    }
  };

  const bookingForm = useForm<z.infer<typeof bookingSchema>>({
    resolver: zodResolver(bookingSchema),
    defaultValues: {
      client_id: "",
      service_type: "Airport Transfer",
      price: undefined,
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
  // Hotel financial calculations
  const hotelNights = bookingForm.watch("num_nights") || 0;
  const hotelCostPerNight = bookingForm.watch("hotel_cost_per_night") || 0;
  const hotelSoldPerNight = bookingForm.watch("hotel_sold_per_night") || 0;
  const hotelTotalCost = hotelCostPerNight * hotelNights;
  const hotelTotalRevenue = hotelSoldPerNight * hotelNights;
  const hotelCommissionPerNight = Math.max(0, hotelSoldPerNight - hotelCostPerNight);
  const hotelTotalCommission = hotelCommissionPerNight * hotelNights;
  const isTourType = serviceType === "Tour";
  const isAccommodation = serviceType === "Apartment";
  const isHotel = serviceType === "Hotel";
  const isAsDirected = serviceType === "As Directed";
  const isCarRental = serviceType === "Car Rental";
  const isAirportTransfer = serviceType === "Airport Transfer";
  const needsCommission = isHotel || isAccommodation;
  // Service types that benefit from a third-party Supplier link
  const needsSupplier = isCarRental || isAsDirected || isAccommodation || isHotel || isTourType || isAirportTransfer;
  const needsCostBreakdown = isCarRental || isAsDirected;

  // ─── Car Rental cost breakdown (live) ────────────────────────────────────
  const baseDailyRate = bookingForm.watch("base_daily_rate" as any) || 0;
  const rentalDays    = bookingForm.watch("rental_days" as any) || 0;
  const fuelCost      = bookingForm.watch("fuel_cost" as any) || 0;
  const driverCost    = bookingForm.watch("driver_cost" as any) || 0;
  const extraCharges  = (bookingForm.watch("extra_charges" as any) as any[]) || [];
  const extrasTotal   = extraCharges.reduce((s: number, e: any) => s + (Number(e?.amount) || 0), 0);
  const carRentalDerivedSubtotal = (Number(baseDailyRate) * Number(rentalDays)) + Number(fuelCost) + Number(driverCost) + extrasTotal;
  // Manual supplier_cost override: when the operator types a value into the
  // amber-bordered "Supplier total cost — manual" input at the top of the
  // Cost Breakdown card, that figure is the source of truth for margin —
  // not the auto-derived base×days+fuel+driver+extras formula. Without this,
  // the displayed Margin silently disagreed with what we'd persist.
  const supplierCostManualWatch = bookingForm.watch("supplier_cost" as any);
  const hasManualSupplierCost =
    supplierCostManualWatch != null &&
    supplierCostManualWatch !== "" &&
    !Number.isNaN(Number(supplierCostManualWatch)) &&
    Number(supplierCostManualWatch) > 0;
  const carRentalSubtotal = hasManualSupplierCost
    ? Number(supplierCostManualWatch)
    : carRentalDerivedSubtotal;
  const clientPriceWatch = bookingForm.watch("price") || 0;
  const carRentalMargin = Number(clientPriceWatch) - carRentalSubtotal;

  // ─── Tour catalogue fetch (Tours-only, active) ──────────────────────────
  const [tourList, setTourList] = useState<Array<{ id: string; name: string; description: string | null; unit_price: number | null; tour_alt_vehicles: Array<{ label: string; uplift: number }> | null }>>([]);
  useEffect(() => {
    if (!isTourType) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("products")
        .select("id, name, description, unit_price, tour_alt_vehicles")
        .eq("category", "Tour")
        .eq("active", true)
        .order("sort_order")
        .order("name");
      if (active) setTourList((data ?? []) as any);
    })();
    return () => { active = false; };
  }, [isTourType]);

  // Recompute price when tour or alt vehicle changes — only when a catalogue
  // tour is picked, so custom-name tours can still be manually priced.
  const tourProductIdWatch = bookingForm.watch("tour_product_id" as any) as string | undefined;
  const tourBasePriceWatch = bookingForm.watch("tour_base_price" as any) || 0;
  const tourAltUpliftWatch = bookingForm.watch("tour_alt_uplift" as any) || 0;
  useEffect(() => {
    if (!isTourType) return;
    if (!tourProductIdWatch) return;
    const total = Number(tourBasePriceWatch) + Number(tourAltUpliftWatch);
    bookingForm.setValue("price", total, { shouldDirty: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTourType, tourProductIdWatch, tourBasePriceWatch, tourAltUpliftWatch]);

  // ─── Suppliers fetch (used by picker) ────────────────────────────────────
  const [supplierList, setSupplierList] = useState<any[]>([]);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch("/api/suppliers?active=true", {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        if (active) setSupplierList(Array.isArray(data) ? data : []);
      } catch {}
    })();
    return () => { active = false; };
  }, []);

  // Clear order lines AND any transport-specific fields when switching to
  // accommodation types — Hotel/Apartment have no vehicle, no name board, no
  // pickup/drop-off, no passengers/luggage. Leaving stale values causes them
  // to leak into the booking record and the Job Sheet / WhatsApp message.
  useEffect(() => {
    if (isHotel || isAccommodation) {
      setOrderLines([]);
      bookingForm.setValue("vehicle_type", "");
      bookingForm.setValue("nameboard", "");
      bookingForm.setValue("pickup", "");
      bookingForm.setValue("dropoff", "");
      bookingForm.setValue("destination", "");
      bookingForm.setValue("flight_number", "");
      bookingForm.setValue("direction", "");
      bookingForm.setValue("passengers", undefined as any);
      bookingForm.setValue("luggage", undefined as any);
    }
    // Supplier-product is only meaningful for Car Rental / As Directed.
    // Switching service type away from those flows must clear any stale
    // product link so it isn't silently posted on save.
    if (!isCarRental && !isAsDirected) {
      bookingForm.setValue("supplier_product_id" as any, "");
    }
  }, [serviceType]);

  // Clear the chosen product whenever the supplier changes, so we never
  // submit a product belonging to a different supplier (server validates
  // this too, but this prevents the request from ever being made).
  const supplierIdWatch = bookingForm.watch("supplier_id" as any);
  useEffect(() => {
    bookingForm.setValue("supplier_product_id" as any, "");
  }, [supplierIdWatch]);

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

  // Hotel: auto-set the booking price (what client pays) and commission earned
  // from the per-night inputs and number of nights. We never use any field
  // called "TVL commission" for hotels — there is no driver to split with.
  useEffect(() => {
    if (!isHotel) return;
    bookingForm.setValue("price", hotelTotalRevenue);
    bookingForm.setValue("commission_amount", hotelTotalCommission);
    bookingForm.setValue("tvl_commission", 0);
  }, [isHotel, hotelTotalRevenue, hotelTotalCommission]);

  // Auto-sync TVL Margin into the existing tvl_commission field for transport
  // service types so the consolidated Financials section persists correctly
  // without changing the DB schema. Hotel + Apartment have their own logic.
  // Airport Transfer is excluded — operator enters tvl_commission MANUALLY
  // (zone-based pricing makes a derived margin meaningless, and the manual
  // value still flows through to Commissions / driver profiles / finance
  // via the unchanged tvl_commission column).
  useEffect(() => {
    if (isHotel || isAccommodation) return;
    if (serviceType === "Airport Transfer") return;
    const cp = Number(clientPriceWatch) || 0;
    const sc = Number(supplierCostManualWatch) || 0;
    const dr = Number(driverCost) || 0;
    const fc = Number(fuelCost) || 0;
    bookingForm.setValue("tvl_commission", cp - sc - dr - fc);
  }, [isHotel, isAccommodation, serviceType, clientPriceWatch, supplierCostManualWatch, driverCost, fuelCost]);

  // Populate client_id from URL param on mount (coming from client profile
  // or a request conversion). When `from_request` is present we also prefill
  // service_type/date_time/notes/price.
  useEffect(() => {
    const params = new URLSearchParams(search);
    const clientId = params.get("client_id");
    if (clientId) loadClientById(clientId);

    const fromRequest = params.get("from_request");
    if (fromRequest) {
      const svc = params.get("service_type");
      const dt  = params.get("date_time");
      const notes = params.get("notes");
      const price = params.get("price");
      if (svc) bookingForm.setValue("service_type", svc as any);
      if (dt)  bookingForm.setValue("date_time", isoToLondonInput(dt));
      if (notes) bookingForm.setValue("notes", notes);
      if (price) bookingForm.setValue("price", Number(price));
      toast({ title: "Prefilled from request", description: "Edit and save to convert." });
    }

    // Return-journey prefill (from booking detail "Add Return Journey")
    const returnFrom = params.get("return_from");
    const pickup = params.get("pickup");
    const dropoff = params.get("dropoff");
    const svcParam = params.get("service_type");
    const dirParam = params.get("direction");
    if (returnFrom) {
      if (svcParam) bookingForm.setValue("service_type", svcParam as any);
      if (pickup)  bookingForm.setValue("pickup", pickup);
      if (dropoff) bookingForm.setValue("dropoff", dropoff);
      if (dirParam) bookingForm.setValue("direction", dirParam as any);
      toast({ title: "Return journey prefilled", description: `Reversed route from ${returnFrom}.` });
    }

    // Auto return-trip prefill (from "Create return" toast on a completed
    // Arrival booking). Fetch the source booking and reverse the route /
    // direction so the operator only confirms date+time.
    // Rebook prefill (from booking detail "Rebook" button or client profile).
    // Loads the source booking and pre-populates client + service details so
    // the operator only confirms the new date / pickup time. Always issues a
    // fresh tvl_ref because it's saved as a brand-new booking.
    const cloneOf = params.get("clone_of");
    if (cloneOf) {
      (async () => {
        const { data: src } = await supabase
          .from("bookings")
          .select("tvl_ref, client_id, service_type, direction, pickup, dropoff, airport_code, vehicle_type, passengers, luggage, notes, special_requests, price")
          .eq("id", cloneOf)
          .maybeSingle();
        if (!src) return;
        if (src.client_id) loadClientById(src.client_id);
        if (src.service_type) bookingForm.setValue("service_type", src.service_type as any);
        if (src.direction) bookingForm.setValue("direction", src.direction as any);
        if (src.pickup)  bookingForm.setValue("pickup", src.pickup);
        if (src.dropoff) bookingForm.setValue("dropoff", src.dropoff);
        if (src.airport_code) bookingForm.setValue("airport_code" as any, src.airport_code);
        if (src.vehicle_type) bookingForm.setValue("vehicle_type", src.vehicle_type);
        if (src.passengers) bookingForm.setValue("passengers", src.passengers);
        if (src.luggage) bookingForm.setValue("luggage", src.luggage);
        if (src.notes) bookingForm.setValue("notes" as any, src.notes);
        if (src.special_requests) bookingForm.setValue("special_requests" as any, src.special_requests);
        if (src.price) bookingForm.setValue("price", Number(src.price));
        toast({
          title: "Rebooking prefilled",
          description: `Cloned from ${src.tvl_ref ?? "source booking"} — set the new date/time and save.`,
        });
      })();
    }

    const returnOf = params.get("return_of");
    if (returnOf) {
      (async () => {
        const { data: src } = await supabase
          .from("bookings")
          .select("tvl_ref, client_id, service_type, direction, pickup, dropoff, airport_code, vehicle_type, passengers, luggage")
          .eq("id", returnOf)
          .maybeSingle();
        if (!src) return;
        if (src.client_id) loadClientById(src.client_id);
        bookingForm.setValue("service_type", (src.service_type ?? "Airport Transfer") as any);
        const reversedDir = src.direction === "Arrival" ? "Departure" : "Arrival";
        bookingForm.setValue("direction", reversedDir as any);
        if (src.pickup)  bookingForm.setValue("dropoff", src.pickup);
        if (src.dropoff) bookingForm.setValue("pickup", src.dropoff);
        if (src.airport_code) bookingForm.setValue("airport_code" as any, src.airport_code);
        if (src.vehicle_type) bookingForm.setValue("vehicle_type", src.vehicle_type);
        if (src.passengers) bookingForm.setValue("passengers", src.passengers);
        if (src.luggage) bookingForm.setValue("luggage", src.luggage);
        toast({
          title: "Return trip prefilled",
          description: `Reversed route from ${src.tvl_ref ?? "source booking"} — set the pickup time.`,
        });
      })();
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

  // ── Airport Transfer auto-pricing ──────────────────────────
  // When both an airport AND a vehicle product are selected for an
  // Airport Transfer, fetch the per-airport price from
  // vehicle_airport_pricing and update the order line's unit_price.
  // This keeps pricing consistent and removes manual entry.
  const airportCode = bookingForm.watch("airport_code");
  useEffect(() => {
    if (serviceType !== "Airport Transfer" || !airportCode) return;
    const vehicleLine = orderLines.find(l => l.category === "Vehicle" && l.product_id);
    if (!vehicleLine || !vehicleLine.product_id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("vehicle_airport_pricing")
        .select("price")
        .eq("product_id", vehicleLine.product_id)
        .eq("airport_code", airportCode)
        .maybeSingle();
      if (cancelled || !data || data.price == null) return;
      const newPrice = Number(data.price);
      if (newPrice > 0 && newPrice !== vehicleLine.unit_price) {
        setOrderLines(prev => prev.map(l => l.key === vehicleLine.key ? { ...l, unit_price: newPrice } : l));
        toast({ title: `Auto-priced from ${airportCode}: £${newPrice}`, description: `${vehicleLine.name}` });
      }
    })();
    return () => { cancelled = true; };
  }, [airportCode, orderLines.map(l => l.product_id).join("|"), serviceType]);

  // ── As Directed: auto-compute rental_days (inclusive) from start → return ──
  // Same calendar day = 1 day. Sat 21st → Sat 21st = 1 day. 21st → 26th = 6 days.
  const adStart = bookingForm.watch("check_in_date");
  const adEnd   = bookingForm.watch("check_out_date");
  useEffect(() => {
    if (serviceType !== "As Directed") return;
    // Clear stale days if dates are missing/invalid/inverted
    if (!adStart || !adEnd) {
      bookingForm.setValue("rental_days" as any, 0);
      return;
    }
    const s = new Date(adStart.slice(0, 10) + "T00:00:00");
    const e = new Date(adEnd.slice(0, 10) + "T00:00:00");
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || e.getTime() < s.getTime()) {
      bookingForm.setValue("rental_days" as any, 0);
      return;
    }
    const diff = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
    bookingForm.setValue("rental_days" as any, diff);
  }, [adStart, adEnd, serviceType]);

  // ── As Directed auto-pricing: vehicle daily rate × days + overtime ──
  // Daily rate is derived from vehicle hourly_rate × 10 (10 hrs = 1 standard day)
  // unless the operator has already set a base_daily_rate manually.
  const hoursWatched   = bookingForm.watch("hours") || 0; // hours per day (max 10)
  const overtimeHours  = Number((bookingForm.watch("overtime_hours" as any) as any) || 0);
  const adRentalDays   = Number((bookingForm.watch("rental_days" as any) as any) || 0);
  useEffect(() => {
    if (serviceType !== "As Directed" || adRentalDays <= 0) return;
    const vehicleLine = orderLines.find(l => l.category === "Vehicle" && l.product_id);
    if (!vehicleLine || !vehicleLine.product_id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("vehicle_airport_pricing")
        .select("airport_code, hourly_rate")
        .eq("product_id", vehicleLine.product_id)
        .not("hourly_rate", "is", null);
      if (cancelled) return;
      const rateRow = (data ?? []).find((r: any) => r.airport_code === "OTHER")
                   ?? (data ?? []).find((r: any) => r.airport_code === "LHR")
                   ?? (data ?? [])[0];
      const hourly = Number(rateRow?.hourly_rate ?? 0);
      if (hourly <= 0) return;
      const dailyRate = hourly * 10;
      // Always push the auto-derived daily rate so the cost-breakdown stays
      // in sync when the vehicle / pricing row changes. Operators who want a
      // bespoke rate should adjust the line item unit price directly.
      bookingForm.setValue("base_daily_rate" as any, dailyRate);
      const overtimeAmount = overtimeHours * dailyRate * 0.10;
      const newPrice = dailyRate * adRentalDays + overtimeAmount;
      if (newPrice > 0 && newPrice !== vehicleLine.unit_price) {
        setOrderLines(prev => prev.map(l => l.key === vehicleLine.key ? { ...l, unit_price: newPrice } : l));
      }
    })();
    return () => { cancelled = true; };
  }, [adRentalDays, overtimeHours, orderLines.map(l => l.product_id).join("|"), serviceType]);

  // ── As Directed: per-day Financials → totals ──
  // For As Directed, the operator enters PER-DAY values for client price,
  // supplier cost, driver rate, and fuel cost. We auto-multiply by rental
  // days to populate the underlying total fields the rest of the system
  // (invoices, reports, dashboards) reads. Supplier per-day auto-fills from
  // the picked supplier product's daily rate.
  const adPricePerDay    = Number((bookingForm.watch("price_per_day" as any) as any) || 0);
  const adSupplierPerDay = Number((bookingForm.watch("supplier_cost_per_day" as any) as any) || 0);
  const adDriverPerDay   = Number((bookingForm.watch("driver_cost_per_day" as any) as any) || 0);
  const adFuelPerDay     = Number((bookingForm.watch("fuel_cost_per_day" as any) as any) || 0);

  // Auto-fill supplier per-day from supplier product's daily rate
  useEffect(() => {
    if (serviceType !== "As Directed") return;
    const baseRate = Number((bookingForm.watch("base_daily_rate" as any) as any) || 0);
    if (baseRate > 0) {
      bookingForm.setValue("supplier_cost_per_day" as any, baseRate, { shouldDirty: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceType, bookingForm.watch("base_daily_rate" as any)]);

  // Mirror per-day × days → total fields the backend stores
  useEffect(() => {
    if (serviceType !== "As Directed" || adRentalDays <= 0) return;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    bookingForm.setValue("price"         as any, r2(adPricePerDay    * adRentalDays), { shouldDirty: true });
    bookingForm.setValue("supplier_cost" as any, r2(adSupplierPerDay * adRentalDays), { shouldDirty: true });
    bookingForm.setValue("driver_cost"   as any, r2(adDriverPerDay   * adRentalDays), { shouldDirty: true });
    bookingForm.setValue("fuel_cost"     as any, r2(adFuelPerDay     * adRentalDays), { shouldDirty: true });
  }, [serviceType, adRentalDays, adPricePerDay, adSupplierPerDay, adDriverPerDay, adFuelPerDay]);

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
    const trimmed = waInput.trim();
    const normalized = waInput.replace(/\D/g, "");
    const looksLikePhone = normalized.length >= 6;
    const looksLikeName = trimmed.length >= 2 && /[a-zA-Z]/.test(trimmed);
    if (!looksLikePhone && !looksLikeName) {
      setFoundClient(null);
      if (phase === "found") setPhase("lookup");
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const orParts: string[] = [];
        if (looksLikePhone) {
          orParts.push(`whatsapp.ilike.%${normalized}%`);
          orParts.push(`whatsapp.ilike.%${trimmed}%`);
        }
        if (looksLikeName) {
          const safe = trimmed.replace(/[,()]/g, " ");
          orParts.push(`name.ilike.%${safe}%`);
        }
        const { data } = await supabase
          .from("clients")
          .select("id, name, whatsapp, email, nationality, vip_tier")
          .or(orParts.join(","))
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
          // Only auto-jump to register when we have a usable phone number; a
          // bare name without a number can't create a client record.
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
    // Only auto-fill the meet & greet name board for transport services.
    // Hotel and Apartment bookings do not use a name board.
    if (client.name && !isHotel && !isAccommodation) {
      bookingForm.setValue("nameboard", client.name);
    }
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
    const isAccommodationSubmit =
      values.service_type === "Hotel" || values.service_type === "Apartment";

    // Hotel and Apartment have NO transport fields. Force them blank on the
    // payload so old auto-fills (name board from client name, vehicle from
    // order lines) cannot leak into the booking record, the Job Sheet card,
    // or the WhatsApp/driver message.
    const transportSafe = {
      direction: isAccommodationSubmit ? undefined : values.direction,
      pickup: isAccommodationSubmit ? undefined : values.pickup,
      dropoff: isAccommodationSubmit ? undefined : values.dropoff,
      destination: isAccommodationSubmit ? undefined : values.destination,
      flight_number: isAccommodationSubmit ? undefined : values.flight_number,
      passengers: isAccommodationSubmit ? undefined : values.passengers,
      luggage: isAccommodationSubmit ? undefined : values.luggage,
      vehicle_type: isAccommodationSubmit ? undefined : values.vehicle_type,
      vehicle_preference: isAccommodationSubmit ? undefined : (values.vehicle_preference || null),
      // Feature 4 — referral split. Only emit the columns when the operator
      // actually filled in a partner name; otherwise we leave them NULL so
      // bookings without a referral remain clean.
      ...(values.referral_partner_name?.trim() ? {
        referral_partner_name: values.referral_partner_name.trim(),
        referral_commission_type: values.referral_commission_type ?? "percent",
        referral_commission_value: Number(values.referral_commission_value) || 0,
      } : {}),
      nameboard: isAccommodationSubmit ? undefined : values.nameboard,
    };

    // For Hotel/Apartment, derive date_time from the check-in date so
    // calendars, dashboard sorting, and "upcoming" filters still work even
    // though the user no longer enters a separate Date & Time.
    const isAsDirectedSubmit = values.service_type === "As Directed";
    const effectiveDateTime = isAccommodationSubmit
      ? values.check_in_date
        ? `${values.check_in_date}T12:00`
        : undefined
      : isAsDirectedSubmit
        ? (values.check_in_date || values.date_time)
        : values.date_time;

    // Past-date guardrail. We do NOT block historical entries (operators
    // sometimes need to back-fill bookings that already happened) but we
    // surface a clear warning so an accidental wrong-year/month doesn't slip
    // through. Compares the date portion only against today's date so a
    // booking earlier today (a few hours ago) doesn't trigger.
    if (effectiveDateTime) {
      const picked = new Date(effectiveDateTime);
      if (!isNaN(picked.getTime())) {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        if (picked < todayStart) {
          const human = picked.toLocaleDateString("en-GB", {
            weekday: "short", day: "2-digit", month: "short", year: "numeric",
          });
          const ok = window.confirm(
            `This date (${human}) is in the past — are you sure you want to continue?\n\n` +
            `Press OK to log this as a historical booking, or Cancel to go back and change the date.`
          );
          if (!ok) return;
        }
      }
    }

    // Hours/day & Overtime hrs are now captured on the booking detail page
    // (post-creation), so we just forward whatever extras were entered here.
    let mergedExtras = Array.isArray((values as any).extra_charges)
      ? [...(values as any).extra_charges]
      : [];

    // Only include fields that exist as columns in the bookings table
    const allowedPayload: Record<string, any> = {
      client_id: values.client_id,
      service_type: values.service_type,
      airport_code: values.airport_code ?? null,
      hours: values.hours ?? null,
      ...transportSafe,
      // Convert London-local form string → UTC ISO so Postgres stores
      // the correct absolute moment regardless of admin / server timezone.
      date_time: effectiveDateTime ? londonInputToIso(effectiveDateTime) : undefined,
      special_requests: values.extras
        ? `${values.special_requests ? values.special_requests + "\n" : ""}Extras: ${values.extras}`
        : values.special_requests,
      additional_charges: values.additional_charges,
      price: values.price,
      tvl_commission: values.tvl_commission,
      commission_amount: values.commission_amount,
      commission_notes: values.commission_notes,
      payment_status: values.payment_status,
      payment_method: values.payment_method,
      status: values.status,
      driver_id: values.driver_id,
      notes: values.notes,
      duration: values.duration,
      // Build 4 — supplier + cost breakdown (Car Rental / As Directed / AT)
      supplier_id: (values as any).supplier_id || undefined,
      supplier_product_id: (values as any).supplier_product_id || undefined,
      // Only persist supplier_commission for service types whose UI exposes it.
      // Otherwise a stale value (e.g. operator typed it in AT then switched to
      // Hotel before saving) would silently pollute the new booking.
      supplier_commission: ["Airport Transfer", "Car Rental", "As Directed"].includes(values.service_type)
        ? (values as any).supplier_commission
        : undefined,
      // Manual supplier_cost override — only persist when set, otherwise
      // the DB trigger derives it from base_daily_rate × rental_days + fuel + driver.
      supplier_cost: (values as any).supplier_cost != null && (values as any).supplier_cost !== ""
        ? Number((values as any).supplier_cost)
        : undefined,
      base_daily_rate: (values as any).base_daily_rate,
      rental_days: (values as any).rental_days,
      fuel_cost: (values as any).fuel_cost,
      driver_cost: (values as any).driver_cost,
      extra_charges: mergedExtras.length > 0 ? mergedExtras : undefined,
      as_directed_supplier_driver: !!(values as any).as_directed_supplier_driver,
      // Airport Transfer matrix selections
      ...(values.service_type === "Airport Transfer" ? {
        vehicle_product_id: (values as any).vehicle_product_id || null,
        meet_greet_product_id: (values as any).meet_greet_product_id || null,
        transfer_extras: Array.isArray((values as any).transfer_extras)
          ? (values as any).transfer_extras
          : [],
      } : {}),
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
      if (values.tour_alt_label) {
        extraDetails.push(`Vehicle: ${values.tour_alt_label} (+£${Number(values.tour_alt_uplift ?? 0)})`);
      } else if (values.tour_product_id) {
        extraDetails.push(`Vehicle: V Class (standard)`);
      }
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
      // Per-night financials breakdown
      if (values.hotel_cost_per_night) extraDetails.push(`Cost/Night: £${values.hotel_cost_per_night}`);
      if (values.hotel_sold_per_night) extraDetails.push(`Sold/Night: £${values.hotel_sold_per_night}`);
      if (hotelTotalCost > 0) extraDetails.push(`Total Cost: £${hotelTotalCost}`);
      // Synthesise commission_notes for the commissions/finance pages
      const noteParts: string[] = [];
      if (values.hotel_cost_per_night && values.hotel_sold_per_night) {
        noteParts.push(`£${values.hotel_cost_per_night}/n cost · £${values.hotel_sold_per_night}/n sold · ${values.num_nights ?? 0}n`);
      }
      if (noteParts.length > 0 && !values.commission_notes) {
        allowedPayload.commission_notes = noteParts.join(" — ");
      }
      if (hotelTotalCommission > 0) extraDetails.push(`Commission Earned: £${hotelTotalCommission}`);
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

          // If we came from a Request conversion, mark it Converted
          const fromRequest = new URLSearchParams(search).get("from_request");
          if (fromRequest) {
            try {
              const { data: { session } } = await supabase.auth.getSession();
              await fetch(`/api/requests/${fromRequest}`, {
                method: "PUT",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${session?.access_token ?? ""}`,
                },
                body: JSON.stringify({ status: "Converted", converted_booking_id: booking.id }),
              });
            } catch (e) { console.warn("[request convert] failed to mark converted", e); }
          }

          toast({ title: "Booking created" });
          setLocation(`/bookings/${booking.id}`);
        },
        onError: (err: any) => {
          const msg = err?.data?.error ?? err?.message ?? "Unknown error";
          toast({ title: "Error creating booking", description: msg, variant: "destructive" });
          console.error("[createBooking]", err);
        },
      }
    );
  };

  const getVipColor = (tier: string) => {
    if (tier === "Platinum") return "bg-gradient-to-r from-amber-500/30 to-yellow-300/30 text-amber-200 border-amber-400/70 shadow-[0_0_8px_rgba(251,191,36,0.35)]";
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
            {phase === "found" && foundClient && !isEditingFound && (
              <div className="rounded-xl border border-green-500/40 bg-green-500/5 p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-foreground text-lg">{foundClient.name}</span>
                      <Badge variant="outline" className={getVipColor(foundClient.vip_tier)}>{foundClient.vip_tier}</Badge>
                    </div>
                    {foundClient.nationality && (
                      <p className="text-sm text-muted-foreground">
                        <span className="mr-1.5">{nationalityFlag(foundClient.nationality)}</span>
                        {foundClient.nationality}
                      </p>
                    )}
                    {foundClient.email && (
                      <p className="text-xs text-muted-foreground">{foundClient.email}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={startEditFound}
                      title="Edit this client's profile"
                    >
                      <Pencil className="w-3.5 h-3.5 mr-1" />
                      Edit
                    </Button>
                    <div className="w-9 h-9 rounded-full bg-green-500/20 flex items-center justify-center">
                      <Check className="w-5 h-5 text-green-500" />
                    </div>
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

            {/* === Client FOUND — EDIT MODE === */}
            {phase === "found" && foundClient && isEditingFound && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Pencil className="w-4 h-4 text-amber-500" />
                    <span className="font-semibold text-sm text-foreground">Update profile for {foundClient.whatsapp}</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => setIsEditingFound(false)}
                    disabled={savingFoundEdit}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <Form {...editFoundForm}>
                  <form onSubmit={editFoundForm.handleSubmit(handleSaveFoundEdit)} className="space-y-3">
                    <FormField control={editFoundForm.control} name="name" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full Name *</FormLabel>
                        <FormControl><Input placeholder="e.g. Mohammed Al-Rashid" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="grid grid-cols-2 gap-3">
                      <FormField control={editFoundForm.control} name="email" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl><Input type="email" placeholder="optional" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={editFoundForm.control} name="nationality" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nationality</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ""}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select nationality" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {NATIONALITIES.map((n) => (
                                <SelectItem key={n.value} value={n.value}>
                                  <span className="mr-2">{n.flag}</span>{n.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={editFoundForm.control} name="vip_tier" render={({ field }) => (
                      <FormItem>
                        <FormLabel>VIP Tier</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="Standard">Standard</SelectItem>
                            <SelectItem value="VIP">VIP</SelectItem>
                            <SelectItem value="VVIP">VVIP</SelectItem>
                            <SelectItem value="Platinum">Platinum</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="flex gap-2">
                      <Button type="submit" className="flex-1 h-11" disabled={savingFoundEdit}>
                        {savingFoundEdit ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                        Save changes
                      </Button>
                      <Button type="button" variant="outline" className="h-11" onClick={() => setIsEditingFound(false)} disabled={savingFoundEdit}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                </Form>
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
                          <Select onValueChange={field.onChange} value={field.value || ""}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select nationality" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {NATIONALITIES.map((n) => (
                                <SelectItem key={n.value} value={n.value}>
                                  <span className="mr-2">{n.flag}</span>{n.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
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
                              <SelectItem value="Platinum">Platinum</SelectItem>
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
                        <p className="text-[11px] text-amber-400/80 mt-1">
                          Without an email, booking confirmation and receipt emails cannot be sent automatically.
                        </p>
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

          {/* VIP banner — Platinum / VVIP only */}
          {(confirmedClient.vip_tier === "Platinum" || confirmedClient.vip_tier === "VVIP") && (
            <div
              className="rounded-xl p-4 bg-gradient-to-r from-amber-500/30 to-yellow-300/30 border border-amber-400/70 text-amber-100 shadow-md"
              data-testid="vip-banner"
            >
              <p className="text-sm font-semibold tracking-wide">
                ⭐ VIP CLIENT — Please ensure premium vehicle is confirmed,
                name board spelling is verified, and all special preferences
                are checked before confirming this booking.
              </p>
            </div>
          )}

          <Form {...bookingForm}>
            <form onSubmit={bookingForm.handleSubmit(onBookingSubmit)} className="space-y-5">

              {/* Service */}
              <Card className="border-primary/10">
                <CardHeader className="pb-3"><CardTitle className="text-base">Service</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <FormField control={bookingForm.control} name="service_type" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Service Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="Airport Transfer">Airport Transfer</SelectItem>
                          <SelectItem value="Tour">Tour</SelectItem>
                          <SelectItem value="As Directed">As Directed</SelectItem>
                          <SelectItem value="Apartment">Apartment</SelectItem>
                          <SelectItem value="Hotel">Hotel</SelectItem>
                          <SelectItem value="Car Rental">Car Rental</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {/* Supplier picker — appears for any service that
                      typically uses a third-party provider. Filtered to the
                      relevant category so the operator sees only car-rental
                      suppliers when booking a Car Rental, etc. */}
                  {needsSupplier && (
                    <FormField control={bookingForm.control} name={"supplier_id" as any} render={({ field }) => {
                      const filterCat = isCarRental ? "Car Rental"
                        : isAccommodation ? "Apartment"
                        : isHotel ? "Hotel"
                        : isTourType ? "Tour Operator"
                        : isAirportTransfer ? "Airport Transfer"
                        : null;
                      const filtered = filterCat
                        ? supplierList.filter((s: any) => s.category === filterCat || s.category === "Other")
                        : supplierList;
                      return (
                        <FormItem>
                          <FormLabel>
                            Supplier <span className="text-xs text-muted-foreground font-normal">(optional)</span>
                          </FormLabel>
                          <Select onValueChange={(v) => field.onChange(v === "none" ? "" : v)} value={field.value || "none"}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select supplier…" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="max-h-[55vh] overflow-y-auto">
                              <SelectItem value="none">None</SelectItem>
                              {filtered.map((s: any) => (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.name}{s.city ? ` · ${s.city}` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-[11px] text-muted-foreground mt-1">
                            Manage suppliers from the Suppliers page in the menu.
                          </p>
                          <FormMessage />
                        </FormItem>
                      );
                    }} />
                  )}

                  {/* Supplier Product picker — shown for Car Rental & As Directed
                      once a supplier is selected. Lets the operator pick the
                      exact car (or driver) the supplier is providing, so the
                      supplier KPI rolls up to the right product. */}
                  {needsCostBreakdown && (bookingForm.watch("supplier_id" as any) || "") !== "" && (
                    <SupplierProductPicker
                      supplierId={String(bookingForm.watch("supplier_id" as any) || "")}
                      value={String(bookingForm.watch("supplier_product_id" as any) || "")}
                      onChange={(productId, product) => {
                        bookingForm.setValue("supplier_product_id" as any, productId || "");
                        if (product) {
                          // Auto-fill base_daily_rate so the Cost Breakdown
                          // reflects what we pay this supplier for this car.
                          if (product.daily_rate != null) {
                            bookingForm.setValue("base_daily_rate" as any, Number(product.daily_rate));
                          }
                          // Mirror the product name into vehicle_type so the
                          // Job Sheet still shows a human-readable vehicle.
                          if (product.kind === "Car" && product.name) {
                            bookingForm.setValue("vehicle_type", product.name);
                          }
                        }
                      }}
                    />
                  )}
                </CardContent>
              </Card>

              {/* ─── Cost Breakdown — HIDDEN per Financials Cleanup spec.
                  Fields (supplier_cost, driver_cost, fuel_cost, etc.) now live
                  in the consolidated Financials section below. The data model
                  is unchanged — saved bookings still read/write the same
                  columns, and the booking detail / invoice screens are
                  untouched. */}
              {false && needsCostBreakdown && (
                <Card className="border-primary/20">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Cost Breakdown</CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">
                      Track what you pay the supplier and the driver, separately from what you charge the client.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Driver source toggle — only meaningful when a supplier is set */}
                    {(bookingForm.watch("supplier_id" as any) || "") !== "" && (
                      <div className="rounded-md border border-border bg-secondary/20 p-3 space-y-2">
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Driver source</Label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => bookingForm.setValue("as_directed_supplier_driver" as any, false)}
                            className={`px-3 py-2 rounded-md text-sm font-medium border transition-colors ${
                              !bookingForm.watch("as_directed_supplier_driver" as any)
                                ? "bg-primary/10 border-primary/50 text-primary"
                                : "bg-background border-border text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            Our driver
                          </button>
                          <button
                            type="button"
                            onClick={() => bookingForm.setValue("as_directed_supplier_driver" as any, true)}
                            className={`px-3 py-2 rounded-md text-sm font-medium border transition-colors ${
                              bookingForm.watch("as_directed_supplier_driver" as any)
                                ? "bg-primary/10 border-primary/50 text-primary"
                                : "bg-background border-border text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            Supplier's driver
                          </button>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {bookingForm.watch("as_directed_supplier_driver" as any)
                            ? "Driver cost will be billed to the supplier and counted in their KPI."
                            : "Driver cost goes to your assigned TVL driver. Supplier KPI shows car-only cost."}
                        </p>
                      </div>
                    )}

                    {/* Manual supplier-cost override.
                        When the supplier has no products configured (or you
                        don't want to deal with daily rate × days), enter the
                        total here and TVL Commission will compute as
                        client_price - supplier_cost automatically. */}
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
                      <Label className="text-xs uppercase tracking-wider text-amber-400">
                        Supplier total cost — manual (£)
                      </Label>
                      <Input
                        type="number" step="0.01" min="0"
                        placeholder="e.g. 450.00"
                        value={(bookingForm.watch("supplier_cost" as any) as any) ?? ""}
                        onChange={e => bookingForm.setValue("supplier_cost" as any, e.target.value === "" ? undefined : Number(e.target.value))}
                        data-testid="input-supplier-cost-manual"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Use this when the supplier has no products set up. Leave blank to let the system compute it from rate × days + fuel + driver below.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Base daily rate (£)</Label>
                        <Input type="number" step="0.01" min="0"
                          value={(bookingForm.watch("base_daily_rate" as any) as any) ?? ""}
                          onChange={e => bookingForm.setValue("base_daily_rate" as any, e.target.value === "" ? undefined : Number(e.target.value))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Rental days</Label>
                        <Input type="number" step="1" min="0"
                          value={(bookingForm.watch("rental_days" as any) as any) ?? ""}
                          onChange={e => bookingForm.setValue("rental_days" as any, e.target.value === "" ? undefined : Number(e.target.value))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Fuel cost (£)</Label>
                        <Input type="number" step="0.01" min="0"
                          value={(bookingForm.watch("fuel_cost" as any) as any) ?? ""}
                          onChange={e => bookingForm.setValue("fuel_cost" as any, e.target.value === "" ? undefined : Number(e.target.value))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Driver cost (£)</Label>
                        <Input type="number" step="0.01" min="0"
                          value={(bookingForm.watch("driver_cost" as any) as any) ?? ""}
                          onChange={e => bookingForm.setValue("driver_cost" as any, e.target.value === "" ? undefined : Number(e.target.value))}
                        />
                      </div>
                    </div>

                    {/* Extra charges — JSONB array of {description, amount} */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Extra charges</Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const next = [...extraCharges, { description: "", amount: 0 }];
                            bookingForm.setValue("extra_charges" as any, next);
                          }}
                        >
                          + Add line
                        </Button>
                      </div>
                      {extraCharges.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">No extras (insurance excess, tolls, child seats…)</p>
                      ) : (
                        <div className="space-y-2">
                          {extraCharges.map((extra: any, idx: number) => (
                            <div key={idx} className="flex gap-2 items-start">
                              <Input
                                placeholder="Description"
                                value={extra?.description ?? ""}
                                onChange={e => {
                                  const next = [...extraCharges];
                                  next[idx] = { ...next[idx], description: e.target.value };
                                  bookingForm.setValue("extra_charges" as any, next);
                                }}
                                className="flex-1"
                              />
                              <Input
                                type="number"
                                step="0.01"
                                placeholder="£"
                                value={extra?.amount ?? ""}
                                onChange={e => {
                                  const next = [...extraCharges];
                                  next[idx] = { ...next[idx], amount: e.target.value === "" ? 0 : Number(e.target.value) };
                                  bookingForm.setValue("extra_charges" as any, next);
                                }}
                                className="w-28"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-destructive"
                                onClick={() => {
                                  const next = extraCharges.filter((_: any, i: number) => i !== idx);
                                  bookingForm.setValue("extra_charges" as any, next);
                                }}
                              >
                                ×
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Live totals strip */}
                    <div className="pt-3 border-t border-border space-y-1.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Base × Days</span>
                        <span className="font-medium text-foreground">£{(Number(baseDailyRate) * Number(rentalDays)).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Fuel</span>
                        <span className="font-medium text-foreground">£{Number(fuelCost).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Driver</span>
                        <span className="font-medium text-foreground">£{Number(driverCost).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Extras</span>
                        <span className="font-medium text-foreground">£{extrasTotal.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm pt-1.5 border-t border-border/50">
                        <span className="font-semibold text-foreground">Cost subtotal</span>
                        <span className="font-bold text-foreground">£{carRentalSubtotal.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="font-semibold text-foreground">Client price</span>
                        <span className="font-bold text-primary">£{Number(clientPriceWatch).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm pt-1.5 border-t border-border/50">
                        <span className="font-semibold text-foreground">TVL Commission</span>
                        <span className={`font-bold ${carRentalMargin >= 0 ? "text-green-400" : "text-destructive"}`}>
                          £{carRentalMargin.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Journey / Property Details */}
              <Card className="border-primary/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {(isAccommodation || isHotel) ? "Property Details" : isAsDirected ? "Chauffeuring Details" : "Journey Details"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Date / Time are shown for every transport service in the
                      order the operator asked for: Date → (Flight No.) → Time.
                      Hotel / Apartment use Check-in / Check-out instead. */}
                  {!isHotel && !isAccommodation && !isAsDirected && (() => {
                    const dt = bookingForm.watch("date_time") ?? "";
                    const dateVal = dt.slice(0, 10);
                    const timeVal = dt.slice(11, 16);
                    const writeDate = (d: string) => {
                      // Past-date guardrail: ask the operator to confirm if
                      // the chosen pickup date is in the past (typo guard).
                      if (d) {
                        const today = new Date(); today.setHours(0,0,0,0);
                        const chosen = new Date(`${d}T00:00:00`);
                        if (chosen < today) {
                          const ok = window.confirm(
                            `Pickup date ${d} is in the past. Continue anyway?\n\n(Useful for back-dating completed bookings — otherwise pick a future date.)`,
                          );
                          if (!ok) return;
                        }
                      }
                      bookingForm.setValue("date_time", d ? `${d}T${timeVal || "00:00"}` : "");
                    };
                    const writeTime = (t: string) =>
                      bookingForm.setValue(
                        "date_time",
                        dateVal ? `${dateVal}T${t || "00:00"}` : (t ? `${new Date().toISOString().slice(0,10)}T${t}` : ""),
                      );
                    if (serviceType === "Airport Transfer") {
                      return (
                        <>
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
                          <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-2">
                              <Label>Date</Label>
                              <Input type="date" value={dateVal} onChange={(e) => writeDate(e.target.value)} />
                            </div>
                            <FormField control={bookingForm.control} name="flight_number" render={({ field }) => (
                              <FormItem>
                                <FormLabel>Flight No.</FormLabel>
                                <FormControl><Input placeholder="BA123" {...field} className="uppercase" /></FormControl>
                                <FormMessage />
                              </FormItem>
                            )} />
                            <div className="space-y-2">
                              <Label>Time <span className="text-[10px] text-muted-foreground font-normal">(UK)</span></Label>
                              <TimePicker value={timeVal} onChange={writeTime} />
                            </div>
                          </div>
                        </>
                      );
                    }
                    // Tour, As Directed → Date + Time + optional Flight No.
                    // Flight number lets the operator surface a Flightradar24
                    // link on the booking detail / driver job sheet for clients
                    // arriving by air who then want a tour or chauffeur day.
                    return (
                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-2">
                          <Label>Date</Label>
                          <Input type="date" value={dateVal} onChange={(e) => writeDate(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                          <Label>Time <span className="text-[10px] text-muted-foreground font-normal">(UK)</span></Label>
                          <TimePicker value={timeVal} onChange={writeTime} />
                        </div>
                        <FormField control={bookingForm.control} name="flight_number" render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              Flight No.
                              <span className="text-[10px] text-muted-foreground font-normal ml-1">(optional)</span>
                            </FormLabel>
                            <FormControl><Input placeholder="BA123" {...field} className="uppercase" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                    );
                  })()}
                  {serviceType === "Airport Transfer" && (
                    <>
                      <FormField control={bookingForm.control} name="airport_code" render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Airport
                            <span className="text-xs text-muted-foreground font-normal ml-1">
                              (auto-prices the vehicle once selected)
                            </span>
                          </FormLabel>
                          <FormControl>
                            <div className="grid grid-cols-3 gap-2">
                              {[
                                { code: "LHR", name: "Heathrow"   },
                                { code: "LGW", name: "Gatwick"    },
                                { code: "STN", name: "Stansted"   },
                                { code: "LTN", name: "Luton"      },
                                { code: "LCY", name: "City"       },
                                { code: "OTHER", name: "Other"    },
                              ].map(a => (
                                <button
                                  key={a.code}
                                  type="button"
                                  onClick={() => field.onChange(a.code)}
                                  className={`px-2 py-2 rounded-lg text-xs font-semibold border transition-all ${
                                    field.value === a.code
                                      ? "bg-primary text-primary-foreground border-primary"
                                      : "border-border text-foreground hover:border-primary/50"
                                  }`}
                                  data-testid={`button-airport-${a.code}`}
                                >
                                  <div>{a.code}</div>
                                  <div className="text-[10px] font-normal opacity-80">{a.name}</div>
                                </button>
                              ))}
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />

                      {/* OTHER airport → manual location input.
                          Mirrors the typed value into pickup (Arrival) or
                          dropoff (Departure) so the custom location flows
                          through to the job sheet, invoice, and WhatsApp
                          messages without any further editing. */}
                      {bookingForm.watch("airport_code") === "OTHER" && (
                        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
                          <Label className="text-xs uppercase tracking-wider text-primary">
                            Custom location
                          </Label>
                          <Input
                            placeholder="e.g. Farnborough Airport · Private Terminal A"
                            value={
                              watchedDirection === "Departure"
                                ? (bookingForm.watch("dropoff") ?? "")
                                : (bookingForm.watch("pickup") ?? "")
                            }
                            onChange={e => {
                              const val = e.target.value;
                              if (watchedDirection === "Departure") {
                                bookingForm.setValue("dropoff", val);
                              } else {
                                bookingForm.setValue("pickup", val);
                              }
                            }}
                            data-testid="input-airport-custom"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            Type any private terminal, FBO, or non-standard pickup point. This appears on the job sheet, invoice, and WhatsApp briefings.
                          </p>
                        </div>
                      )}
                      <FlightLookupCard
                        flightNumber={watchedFlightNumber}
                        direction={watchedDirection}
                        date={(bookingForm.watch("date_time") ?? "").slice(0, 10)}
                        onAutoFill={(timeUk, origin, destination, terminal) => {
                            // The operator manually enters the date because clients
                            // pre-book. We only set the time portion (UK / GMT) on
                            // top of whatever date they've already picked. If they
                            // haven't picked a date yet, the time fill is skipped —
                            // they can hit Auto-fill again once the date is in.
                            const currentDt = bookingForm.getValues("date_time") ?? "";
                            const datePart = currentDt.slice(0, 10); // YYYY-MM-DD
                            if (datePart && /^\d{4}-\d{2}-\d{2}$/.test(datePart) && timeUk) {
                              bookingForm.setValue("date_time", `${datePart}T${timeUk}`);
                            }
                            // The airport is the pickup on Arrival, the drop-off on Departure.
                            // Append the terminal so the chauffeur knows exactly where to go.
                            const term = terminal ? ` Terminal ${terminal}` : "";
                            if (watchedDirection === "Arrival" && origin) {
                              bookingForm.setValue("pickup", `${origin}${term}`);
                            }
                            if (watchedDirection === "Departure" && destination) {
                            bookingForm.setValue("dropoff", `${destination}${term}`);
                          }
                        }}
                      />
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

                      {/* Airport × Vehicle pricing matrix + Additional Services.
                          Renders only for Airport Transfer once an airport is
                          selected. Picking a vehicle and toggling extras
                          auto-fills the Client Price below — operator can
                          still override manually. */}
                      <AirportTransferProductPicker
                        airportCode={bookingForm.watch("airport_code") as string | undefined}
                        vehicleProductId={(bookingForm.watch("vehicle_product_id" as any) as string) ?? ""}
                        transferExtras={(bookingForm.watch("transfer_extras" as any) as TransferExtra[]) ?? []}
                        onChange={({ vehicleProductId, vehicleName, transferExtras, totalPrice }) => {
                          bookingForm.setValue("vehicle_product_id" as any, vehicleProductId, { shouldDirty: true });
                          if (vehicleName) bookingForm.setValue("vehicle_type", vehicleName, { shouldDirty: true });
                          // Mirror the first selected Meet & Greet into the
                          // legacy single-tier column so existing reports /
                          // job sheet labels keep working.
                          const firstMg = transferExtras.find(e => /meet.?&?\s*greet/i.test(e.name));
                          bookingForm.setValue("meet_greet_product_id" as any, firstMg?.id ?? "", { shouldDirty: true });
                          bookingForm.setValue("transfer_extras" as any, transferExtras, { shouldDirty: true });
                          bookingForm.setValue("price", totalPrice, { shouldDirty: true });
                        }}
                      />
                    </>
                  )}

                  {isTourType && (() => {
                    const selectedTourId = bookingForm.watch("tour_product_id" as any) as string | undefined;
                    const selectedTour = tourList.find(t => t.id === selectedTourId);
                    const altOptions = selectedTour?.tour_alt_vehicles ?? [];
                    const selectedAltLabel = bookingForm.watch("tour_alt_label" as any) as string | undefined;
                    return (
                    <div className="space-y-3 p-3 rounded-xl border border-primary/20 bg-primary/5">
                      <p className="text-xs font-semibold text-primary uppercase tracking-wider">Tour Details</p>
                      <div className="grid grid-cols-2 gap-3">
                        <FormItem className="col-span-2">
                          <FormLabel>Tour</FormLabel>
                          <Select
                            value={selectedTourId ?? "__custom__"}
                            onValueChange={(v) => {
                              if (v === "__custom__") {
                                bookingForm.setValue("tour_product_id" as any, "", { shouldDirty: true });
                                bookingForm.setValue("tour_base_price" as any, 0, { shouldDirty: true });
                                bookingForm.setValue("tour_alt_label" as any, "", { shouldDirty: true });
                                bookingForm.setValue("tour_alt_uplift" as any, 0, { shouldDirty: true });
                                return;
                              }
                              const t = tourList.find(x => x.id === v);
                              if (!t) return;
                              bookingForm.setValue("tour_product_id" as any, t.id, { shouldDirty: true });
                              bookingForm.setValue("tour_name", t.name, { shouldDirty: true });
                              bookingForm.setValue("tour_base_price" as any, Number(t.unit_price ?? 0), { shouldDirty: true });
                              bookingForm.setValue("tour_alt_label" as any, "", { shouldDirty: true });
                              bookingForm.setValue("tour_alt_uplift" as any, 0, { shouldDirty: true });
                            }}
                          >
                            <SelectTrigger data-testid="select-tour-product"><SelectValue placeholder="Select a tour…" /></SelectTrigger>
                            <SelectContent>
                              {tourList.map(t => (
                                <SelectItem key={t.id} value={t.id} data-testid={`option-tour-${t.id}`}>
                                  {t.name}{t.unit_price ? ` — £${Number(t.unit_price).toLocaleString()}` : ""}
                                </SelectItem>
                              ))}
                              <SelectItem value="__custom__">— Custom (not in catalogue) —</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>

                        {altOptions.length > 0 && (
                          <FormItem className="col-span-2">
                            <FormLabel>Vehicle for this tour</FormLabel>
                            <Select
                              value={selectedAltLabel || "__std__"}
                              onValueChange={(v) => {
                                if (v === "__std__") {
                                  bookingForm.setValue("tour_alt_label" as any, "", { shouldDirty: true });
                                  bookingForm.setValue("tour_alt_uplift" as any, 0, { shouldDirty: true });
                                  return;
                                }
                                const opt = altOptions.find(o => o.label === v);
                                if (!opt) return;
                                bookingForm.setValue("tour_alt_label" as any, opt.label, { shouldDirty: true });
                                bookingForm.setValue("tour_alt_uplift" as any, Number(opt.uplift) || 0, { shouldDirty: true });
                              }}
                            >
                              <SelectTrigger data-testid="select-tour-alt-vehicle"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__std__">V Class (standard) — £{Number(tourBasePriceWatch || 0).toLocaleString()}</SelectItem>
                                {altOptions.map((o, i) => (
                                  <SelectItem key={i} value={o.label} data-testid={`option-alt-${i}`}>
                                    {o.label} — +£{Number(o.uplift || 0).toLocaleString()} (total £{(Number(tourBasePriceWatch || 0) + Number(o.uplift || 0)).toLocaleString()})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )}

                        <FormField control={bookingForm.control} name="tour_name" render={({ field }) => (
                          <FormItem className={selectedTourId ? "hidden" : "col-span-2"}>
                            <FormLabel>Tour Name (custom)</FormLabel>
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
                      {selectedTour && (
                        <div className="text-[11px] text-muted-foreground border-t border-primary/10 pt-2 flex items-center justify-between">
                          <span>
                            Base £{Number(tourBasePriceWatch || 0).toLocaleString()}
                            {Number(tourAltUpliftWatch) > 0 && (
                              <> + uplift £{Number(tourAltUpliftWatch).toLocaleString()}</>
                            )}
                          </span>
                          <span className="font-semibold text-foreground">
                            Tour total £{(Number(tourBasePriceWatch || 0) + Number(tourAltUpliftWatch || 0)).toLocaleString()}
                          </span>
                        </div>
                      )}
                    </div>
                    );
                  })()}

                  {isAsDirected && (() => {
                    const baseRate = Number((bookingForm.watch("base_daily_rate" as any) as any) || 0);
                    const subtotal = baseRate * adRentalDays;
                    return (
                    <div className="space-y-3 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
                      <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Chauffeuring Period</p>
                      <div className="grid grid-cols-2 gap-3">
                        <FormField control={bookingForm.control} name="check_in_date" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Start (date &amp; time)</FormLabel>
                            <FormControl><Input type="datetime-local" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={bookingForm.control} name="check_out_date" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Return (date)</FormLabel>
                            <FormControl>
                              <Input
                                type="date"
                                value={(field.value || "").slice(0, 10)}
                                onChange={(e) => field.onChange(e.target.value)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Total days</Label>
                        <div className="h-9 px-3 rounded-md border border-border bg-secondary/20 flex items-center font-semibold text-foreground">
                          {adRentalDays || "—"}
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground italic">
                        Hours / day and Overtime hrs are added on the booking detail page after creation.
                      </p>
                      {(baseRate > 0 || adRentalDays > 0) && (
                        <div className="rounded-md bg-background/40 border border-border p-2.5 space-y-1 text-xs">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{adRentalDays || 0} day{adRentalDays === 1 ? "" : "s"} × £{baseRate.toLocaleString()}/day</span>
                            <span className="font-medium">£{(baseRate * adRentalDays).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between pt-1 border-t border-border">
                            <span className="font-semibold text-foreground">Chauffeuring subtotal</span>
                            <span className="font-bold text-primary">£{Math.round(subtotal).toLocaleString()}</span>
                          </div>
                        </div>
                      )}
                    </div>
                    );
                  })()}

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

                      {/* Hotel Financials — auto-calculated from per-night inputs */}
                      <div className="mt-4 space-y-3 p-3 rounded-lg border border-primary/30 bg-primary/5">
                        <p className="text-xs font-semibold text-primary uppercase tracking-wider">Hotel Financials</p>

                        <div className="grid grid-cols-2 gap-3">
                          <FormField control={bookingForm.control} name="hotel_cost_per_night" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Cost per Night (£) <span className="text-xs text-muted-foreground font-normal">(what we pay)</span></FormLabel>
                              <FormControl><Input type="number" step="0.01" min="0" placeholder="0.00" {...field} value={field.value ?? ""} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={bookingForm.control} name="hotel_sold_per_night" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Sold to Client / Night (£)</FormLabel>
                              <FormControl><Input type="number" step="0.01" min="0" placeholder="0.00" {...field} value={field.value ?? ""} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Total Cost ({hotelNights} night{hotelNights !== 1 ? "s" : ""})</Label>
                            <div className="h-10 flex items-center px-3 border border-border rounded-md bg-muted/40 font-bold text-foreground">
                              £{hotelTotalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Total Charged to Client</Label>
                            <div className="h-10 flex items-center px-3 border border-primary/30 rounded-md bg-primary/10 font-bold text-primary">
                              £{hotelTotalRevenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </div>
                          </div>
                        </div>

                        <div className="border-t border-primary/20 pt-3 space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Commission / Night</Label>
                              <div className="h-10 flex items-center px-3 border border-emerald-500/40 rounded-md bg-emerald-500/10 font-bold text-emerald-400">
                                £{hotelCommissionPerNight.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              </div>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Total Commission Earned</Label>
                              <div className="h-10 flex items-center px-3 border border-emerald-500/40 rounded-md bg-emerald-500/10 font-bold text-emerald-400">
                                £{hotelTotalCommission.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              </div>
                            </div>
                          </div>
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

                  {/* Extras — transport only. Hidden for Airport Transfer:
                      AT has its own structured extras (child seat, M&G tier,
                      etc.) via the AirportTransferProductPicker above, so
                      this free-text field would be redundant + confusing. */}
                  {!isAccommodation && !isHotel && serviceType !== "Airport Transfer" && (
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

                  {/* Vehicle Preference — transport only. Hidden behind a
                      toggle since the structured vehicle picker handles the
                      common case. Auto-revealed when an existing value is
                      present (edit / draft restore). */}
                  {!isAccommodation && !isHotel && (
                    <FormField control={bookingForm.control} name="vehicle_preference" render={({ field }) => {
                      const hasValue = !!(field.value && String(field.value).trim());
                      const show = showVehiclePref || hasValue;
                      if (!show) {
                        return (
                          <FormItem>
                            <button
                              type="button"
                              onClick={() => setShowVehiclePref(true)}
                              className="text-xs text-primary hover:underline flex items-center gap-1"
                              data-testid="toggle-vehicle-preference"
                            >
                              <Plus className="w-3 h-3" /> Add vehicle preference
                              <span className="text-muted-foreground font-normal">— client request outside standard fleet</span>
                            </button>
                          </FormItem>
                        );
                      }
                      return (
                        <FormItem>
                          <div className="flex items-center justify-between">
                            <FormLabel>
                              Vehicle Preference
                              <span className="text-xs text-muted-foreground font-normal ml-1">(optional — client request)</span>
                            </FormLabel>
                            <button
                              type="button"
                              onClick={() => { field.onChange(""); setShowVehiclePref(false); }}
                              className="text-[11px] text-muted-foreground hover:text-foreground underline"
                              data-testid="hide-vehicle-preference"
                            >
                              Remove
                            </button>
                          </div>
                          <FormControl>
                            <Input placeholder="e.g. Range Rover, V-Class, Rolls Royce" {...field} data-testid="input-vehicle-preference" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      );
                    }} />
                  )}

                  <FormField control={bookingForm.control} name="special_requests" render={({ field }) => {
                    const len = (field.value ?? "").length;
                    const over = len > 500;
                    return (
                      <FormItem>
                        <div className="flex items-center justify-between">
                          <FormLabel>
                            {isAccommodation || isHotel ? "Note to Manager" : "Special Requests"}
                          </FormLabel>
                          <span className={`text-[11px] tabular-nums ${over ? "text-destructive font-bold" : len > 450 ? "text-amber-400" : "text-muted-foreground"}`}>
                            {len}/500
                          </span>
                        </div>
                        <FormControl>
                          <Textarea
                            placeholder={isAccommodation || isHotel
                              ? "Instructions or requests for the property manager..."
                              : "Client preferences, notes for driver..."}
                            className="resize-none" rows={3} maxLength={500}
                            {...field}
                            onChange={(e) => field.onChange(e.target.value.slice(0, 500))}
                            data-testid="textarea-special-requests"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    );
                  }} />
                </CardContent>
              </Card>

              {/* Products / Order Lines — HIDDEN per Financials Cleanup spec.
                  The picker is no longer shown on the new booking form, but
                  the data model is preserved so existing bookings still
                  display their order lines correctly elsewhere. Operators
                  enter Client Price directly in the Financials section below. */}
              {false && !isAccommodation && !isHotel && (
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
                  {/* For Hotel: price + commission are auto-calculated above. Show a read-only summary. */}
                  {isHotel ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Total Price (auto)</Label>
                        <div className="h-10 flex items-center px-3 border border-primary/30 rounded-md bg-primary/10 font-bold text-primary text-lg">
                          £{hotelTotalRevenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Commission Earned (auto)</Label>
                        <div className="h-10 flex items-center px-3 border border-emerald-500/40 rounded-md bg-emerald-500/10 font-bold text-emerald-400 text-lg">
                          £{hotelTotalCommission.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Consolidated Financials — single source of truth.
                          Replaces the old Price / TVL Commission / Driver Gets
                          row plus the standalone Cost Breakdown card. Margin is
                          auto-calculated and synced into tvl_commission on
                          every render via the effect below — DB schema
                          unchanged, booking detail / invoice screens untouched. */}
                      {isAsDirected ? (
                        // ── As Directed: per-day inputs + breakdown ──
                        // Operator enters daily rates; the underlying total
                        // fields (price, supplier_cost, driver_cost, fuel_cost)
                        // auto-fill via × rental_days (see useEffect above).
                        // The client invoice shows the total only — breakdown
                        // is internal admin reference.
                        <>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <Label>Client Price (£/day)</Label>
                              <Input
                                type="number" step="0.01" min="0"
                                placeholder="e.g. 400"
                                value={(bookingForm.watch("price_per_day" as any) as any) ?? ""}
                                onChange={e => bookingForm.setValue("price_per_day" as any, e.target.value === "" ? undefined : Number(e.target.value), { shouldDirty: true })}
                                className="text-lg font-bold"
                                data-testid="input-client-price-per-day"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Supplier Cost (£/day) <span className="text-xs text-muted-foreground font-normal">auto-filled from supplier product</span></Label>
                              <Input
                                type="number" step="0.01" min="0"
                                placeholder="e.g. 150"
                                value={(bookingForm.watch("supplier_cost_per_day" as any) as any) ?? ""}
                                onChange={e => bookingForm.setValue("supplier_cost_per_day" as any, e.target.value === "" ? undefined : Number(e.target.value), { shouldDirty: true })}
                                data-testid="input-supplier-cost-per-day"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Driver Rate (£/day)</Label>
                              <Input
                                type="number" step="0.01" min="0"
                                placeholder="e.g. 130"
                                value={(bookingForm.watch("driver_cost_per_day" as any) as any) ?? ""}
                                onChange={e => bookingForm.setValue("driver_cost_per_day" as any, e.target.value === "" ? undefined : Number(e.target.value), { shouldDirty: true })}
                                data-testid="input-driver-rate-per-day"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Fuel Cost (£/day)</Label>
                              <Input
                                type="number" step="0.01" min="0"
                                placeholder="e.g. 30"
                                value={(bookingForm.watch("fuel_cost_per_day" as any) as any) ?? ""}
                                onChange={e => bookingForm.setValue("fuel_cost_per_day" as any, e.target.value === "" ? undefined : Number(e.target.value), { shouldDirty: true })}
                                data-testid="input-fuel-rate-per-day"
                              />
                            </div>
                          </div>

                          {/* Full-duration breakdown — admin reference only.
                              Client invoice shows the total amount, not this
                              line-by-line breakdown. */}
                          {adRentalDays > 0 && (adPricePerDay || adSupplierPerDay || adDriverPerDay || adFuelPerDay) ? (
                            <div className="rounded-md border border-border bg-secondary/20 p-3 space-y-2">
                              <div className="flex items-center justify-between mb-1">
                                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Full Duration Breakdown</Label>
                                <span className="text-[10px] text-muted-foreground italic">Admin only — client sees total</span>
                              </div>
                              <div className="space-y-1 text-sm">
                                <div className="flex justify-between text-foreground">
                                  <span>Client Price · £{adPricePerDay.toLocaleString()}/day × {adRentalDays} days</span>
                                  <span className="font-semibold">£{(adPricePerDay * adRentalDays).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                                </div>
                                <div className="flex justify-between text-muted-foreground">
                                  <span>Supplier Cost · £{adSupplierPerDay.toLocaleString()}/day × {adRentalDays} days</span>
                                  <span>− £{(adSupplierPerDay * adRentalDays).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                                </div>
                                <div className="flex justify-between text-muted-foreground">
                                  <span>Driver Rate · £{adDriverPerDay.toLocaleString()}/day × {adRentalDays} days</span>
                                  <span>− £{(adDriverPerDay * adRentalDays).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                                </div>
                                <div className="flex justify-between text-muted-foreground">
                                  <span>Fuel Cost · £{adFuelPerDay.toLocaleString()}/day × {adRentalDays} days</span>
                                  <span>− £{(adFuelPerDay * adRentalDays).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                                </div>
                                <div className="flex justify-between pt-2 mt-1 border-t border-border font-bold text-foreground">
                                  <span>Total Client Invoice ({adRentalDays} {adRentalDays === 1 ? "day" : "days"})</span>
                                  <span className="text-primary text-base">£{(adPricePerDay * adRentalDays).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          <FormField control={bookingForm.control} name="price" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Client Price (£)</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.01"
                                  placeholder=""
                                  value={field.value ?? ""}
                                  onChange={e => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
                                  className="text-lg font-bold"
                                  data-testid="input-client-price"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <div className="space-y-2">
                            <Label>Supplier Cost (£)</Label>
                            <Input
                              type="number" step="0.01" min="0"
                              value={(bookingForm.watch("supplier_cost" as any) as any) ?? ""}
                              onChange={e => bookingForm.setValue("supplier_cost" as any, e.target.value === "" ? undefined : Number(e.target.value))}
                              data-testid="input-supplier-cost"
                            />
                          </div>
                          {/* Driver Rate / Fuel Cost — hidden for Airport Transfer.
                              AT pricing is fixed-price-per-zone (vehicle + extras
                              + meet & greet auto-summed into Client Price by the
                              picker). Supplier Cost stays for third-party luxury
                              vehicles (e.g. Rolls Royce Cullinan). */}
                          {serviceType !== "Airport Transfer" && (
                            <>
                              <div className="space-y-2">
                                <Label>Driver Rate (£)</Label>
                                <Input
                                  type="number" step="0.01" min="0"
                                  value={(bookingForm.watch("driver_cost" as any) as any) ?? ""}
                                  onChange={e => bookingForm.setValue("driver_cost" as any, e.target.value === "" ? undefined : Number(e.target.value))}
                                  data-testid="input-driver-rate"
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>Fuel Cost (£)</Label>
                                <Input
                                  type="number" step="0.01" min="0"
                                  value={(bookingForm.watch("fuel_cost" as any) as any) ?? ""}
                                  onChange={e => bookingForm.setValue("fuel_cost" as any, e.target.value === "" ? undefined : Number(e.target.value))}
                                  data-testid="input-fuel-cost"
                                />
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {(() => {
                        const isAT = serviceType === "Airport Transfer";

                        // ── Airport Transfer: MANUAL split commission ────────
                        // Two independent commissions, both manual:
                        //   1. Driver commission → tvl_commission column
                        //      (what driver owes TVL on cash; feeds the
                        //       Commissions page, driver profiles, settlement
                        //       statements, finance reports)
                        //   2. Supplier commission → supplier_commission column
                        //      (TVL markup on third-party services like
                        //       Heathrow Meet & Greet agents — supplier
                        //       charges X, we charge client X+commission)
                        // Supplier dropdown writes supplier_id so finance can
                        // group payouts per third-party supplier.
                        if (isAT) {
                          const dc = Number(bookingForm.watch("tvl_commission")) || 0;
                          const sc = Number(bookingForm.watch("supplier_commission" as any)) || 0;
                          const totalProfit = dc + sc;
                          const positive = totalProfit >= 0;
                          const supplierIdAt = String(bookingForm.watch("supplier_id" as any) ?? "");
                          return (
                            <div className="space-y-3">
                              {/* Driver commission */}
                              <div className="p-3 rounded-md border border-border bg-muted/30 space-y-2">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Driver Commission (manual)</Label>
                                    <p className="text-[10px] text-muted-foreground mt-0.5">
                                      What the driver owes TVL · feeds Commissions, driver profile &amp; settlement statements
                                    </p>
                                  </div>
                                  <Input
                                    type="number" step="0.01"
                                    placeholder="£0"
                                    value={(bookingForm.watch("tvl_commission") as any) ?? ""}
                                    onChange={e => bookingForm.setValue("tvl_commission", e.target.value === "" ? 0 : Number(e.target.value), { shouldDirty: true })}
                                    className="font-semibold w-32 text-right"
                                    data-testid="input-driver-commission-manual"
                                  />
                                </div>
                              </div>

                              {/* Third-party supplier (e.g. Heathrow Meet & Greet) */}
                              <div className="p-3 rounded-md border border-border bg-muted/30 space-y-3">
                                <div>
                                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Third-party Supplier <span className="normal-case text-[10px] text-muted-foreground/80">(optional — e.g. Heathrow Meet &amp; Greet agents)</span></Label>
                                  <p className="text-[10px] text-muted-foreground mt-0.5">
                                    Track the supplier you used + your markup commission. Feeds finance reports per supplier.
                                  </p>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <Label className="text-[11px] text-muted-foreground">Supplier</Label>
                                    <Select
                                      value={supplierIdAt || "none"}
                                      onValueChange={(v) => bookingForm.setValue("supplier_id" as any, v === "none" ? "" : v, { shouldDirty: true })}
                                    >
                                      <SelectTrigger data-testid="select-at-supplier"><SelectValue placeholder="Select supplier…" /></SelectTrigger>
                                      <SelectContent className="max-h-[55vh] overflow-y-auto">
                                        <SelectItem value="none">— None —</SelectItem>
                                        {supplierList.map((s: any) => (
                                          <SelectItem key={s.id} value={s.id}>
                                            {s.name}{s.city ? ` · ${s.city}` : ""}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-[11px] text-muted-foreground">Supplier Commission (£)</Label>
                                    <Input
                                      type="number" step="0.01" min="0"
                                      placeholder="TVL markup, e.g. 50"
                                      value={(bookingForm.watch("supplier_commission" as any) as any) ?? ""}
                                      onChange={e => bookingForm.setValue("supplier_commission" as any, e.target.value === "" ? undefined : Number(e.target.value), { shouldDirty: true })}
                                      data-testid="input-supplier-commission-manual"
                                    />
                                  </div>
                                </div>
                              </div>

                              {/* Total TVL profit (driver + supplier commission) */}
                              <div className="flex items-center justify-between p-3 rounded-md border border-primary/30 bg-primary/5">
                                <div>
                                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Total TVL Profit (auto)</Label>
                                  <p className="text-[10px] text-muted-foreground mt-0.5">Driver Commission + Supplier Commission</p>
                                </div>
                                <div className={`text-2xl font-bold ${positive ? "text-green-400" : "text-destructive"}`} data-testid="text-tvl-margin">
                                  £{totalProfit.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                </div>
                              </div>
                            </div>
                          );
                        }

                        // ── Other transport types: auto-calculated margin ───
                        const cp = Number(bookingForm.watch("price")) || 0;
                        const sc = Number(bookingForm.watch("supplier_cost" as any)) || 0;
                        const dr = Number(bookingForm.watch("driver_cost" as any)) || 0;
                        const fc = Number(bookingForm.watch("fuel_cost" as any)) || 0;
                        const margin = cp - sc - dr - fc;
                        const positive = margin >= 0;

                        // For As Directed, also show per-day breakdown so the
                        // operator can see daily commission alongside the full
                        // duration commission (e.g. 8-day rental).
                        if (isAsDirected && adRentalDays > 0) {
                          const perDay = margin / adRentalDays;
                          const perDayPositive = perDay >= 0;
                          return (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="p-3 rounded-md border border-border bg-muted/30">
                                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Daily Commission</Label>
                                <p className="text-[10px] text-muted-foreground mt-0.5">Per day · {adRentalDays} day{adRentalDays === 1 ? "" : "s"} total</p>
                                <div className={`text-2xl font-bold mt-1 ${perDayPositive ? "text-green-400" : "text-destructive"}`} data-testid="text-tvl-margin-daily">
                                  £{perDay.toLocaleString(undefined, { maximumFractionDigits: 2 })}<span className="text-xs font-normal text-muted-foreground">/day</span>
                                </div>
                              </div>
                              <div className="p-3 rounded-md border border-primary/30 bg-primary/5">
                                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Total TVL Margin ({adRentalDays} {adRentalDays === 1 ? "day" : "days"})</Label>
                                <p className="text-[10px] text-muted-foreground mt-0.5">Client Price − Supplier Cost − Driver Rate − Fuel Cost</p>
                                <div className={`text-2xl font-bold mt-1 ${positive ? "text-green-400" : "text-destructive"}`} data-testid="text-tvl-margin">
                                  £{margin.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                </div>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div className="flex items-center justify-between p-3 rounded-md border border-border bg-muted/30">
                            <div>
                              <Label className="text-xs uppercase tracking-wider text-muted-foreground">TVL Margin (auto)</Label>
                              <p className="text-[10px] text-muted-foreground mt-0.5">Client Price − Supplier Cost − Driver Rate − Fuel Cost</p>
                            </div>
                            <div className={`text-2xl font-bold ${positive ? "text-green-400" : "text-destructive"}`} data-testid="text-tvl-margin">
                              £{margin.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Feature 4 — Commission Split (referral partner).
                          Optional; does not change TVL Margin above. Persists
                          to bookings.referral_* (see migration-booking-referral-split.sql). */}
                      {(() => {
                        const cp = Number(bookingForm.watch("price")) || 0;
                        const sc = Number(bookingForm.watch("supplier_cost" as any)) || 0;
                        const dr = Number(bookingForm.watch("driver_cost" as any)) || 0;
                        const fc = Number(bookingForm.watch("fuel_cost" as any)) || 0;
                        const margin = cp - sc - dr - fc;
                        const partner = (bookingForm.watch("referral_partner_name") ?? "").trim();
                        const splitOn = showReferralSplit || partner.length > 0;
                        const ctype = (bookingForm.watch("referral_commission_type") ?? "percent") as "percent" | "amount";
                        const cval = Number(bookingForm.watch("referral_commission_value")) || 0;
                        const referralCut =
                          ctype === "percent"
                            ? Math.max(0, (margin * cval) / 100)
                            : Math.max(0, cval);
                        const tvlNetAfter = margin - referralCut;
                        return (
                          <div className="space-y-3 p-3 rounded-xl border border-blue-500/20 bg-blue-500/5">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-xs font-semibold text-blue-300 uppercase tracking-wider">Commission Split</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">Optional referral partner — does not change TVL Margin above</p>
                              </div>
                              <Switch
                                checked={splitOn}
                                onCheckedChange={(v) => {
                                  setShowReferralSplit(v);
                                  if (!v) {
                                    bookingForm.setValue("referral_partner_name", "");
                                    bookingForm.setValue("referral_commission_value", 0 as any);
                                  } else if (!bookingForm.getValues("referral_commission_type")) {
                                    bookingForm.setValue("referral_commission_type", "percent");
                                  }
                                }}
                                data-testid="switch-referral-split"
                              />
                            </div>
                            {splitOn && (
                              <>
                                <div className="grid grid-cols-3 gap-3">
                                  <FormField control={bookingForm.control} name="referral_partner_name" render={({ field }) => (
                                    <FormItem className="col-span-1">
                                      <FormLabel>Referral Partner</FormLabel>
                                      <FormControl><Input placeholder="e.g. Concierge X" {...field} data-testid="input-referral-name" /></FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )} />
                                  <FormField control={bookingForm.control} name="referral_commission_type" render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Type</FormLabel>
                                      <Select onValueChange={field.onChange} value={field.value || "percent"}>
                                        <FormControl><SelectTrigger data-testid="select-referral-type"><SelectValue /></SelectTrigger></FormControl>
                                        <SelectContent>
                                          <SelectItem value="percent">% of margin</SelectItem>
                                          <SelectItem value="amount">£ amount</SelectItem>
                                        </SelectContent>
                                      </Select>
                                      <FormMessage />
                                    </FormItem>
                                  )} />
                                  <FormField control={bookingForm.control} name="referral_commission_value" render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>{ctype === "percent" ? "%" : "£"}</FormLabel>
                                      <FormControl>
                                        <Input
                                          type="number"
                                          step={ctype === "percent" ? "0.1" : "0.01"}
                                          min="0"
                                          placeholder={ctype === "percent" ? "e.g. 10" : "e.g. 50"}
                                          {...field}
                                          data-testid="input-referral-value"
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )} />
                                </div>
                                <div className="flex items-center justify-between text-sm pt-1 border-t border-blue-500/20">
                                  <span className="text-muted-foreground">
                                    Referral cut:&nbsp;
                                    <span className="font-medium text-foreground">£{referralCut.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                                  </span>
                                  <span>
                                    <span className="text-muted-foreground mr-1.5">TVL Net after referral:</span>
                                    <span className={`font-bold ${tvlNetAfter >= 0 ? "text-green-400" : "text-destructive"}`} data-testid="text-tvl-net-after-referral">
                                      £{tvlNetAfter.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                    </span>
                                  </span>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })()}

                      {/* Third-party Commission — Apartment only (Hotel handled above) */}
                      {isAccommodation && (
                        <div className="space-y-3 p-3 rounded-xl border border-primary/20 bg-primary/5">
                          <p className="text-xs font-semibold text-primary uppercase tracking-wider">Third-party Commission</p>
                          <div className="grid grid-cols-2 gap-3">
                            <FormField control={bookingForm.control} name="commission_amount" render={({ field }) => (
                              <FormItem>
                                <FormLabel>Commission Earned (£)</FormLabel>
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
                    </>
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

                  {/* Driver & Vehicle — transport only, not for accommodation.
                      Hidden when the supplier provides the driver too — in that
                      case there is no TVL driver to assign. */}
                  {!isAccommodation && !isHotel && bookingForm.watch("as_directed_supplier_driver" as any) && (
                    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-primary">
                      Supplier is providing the driver — no TVL driver assignment needed.
                    </div>
                  )}
                  {!isAccommodation && !isHotel && !bookingForm.watch("as_directed_supplier_driver" as any) && (
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
                            <FormControl><SelectTrigger data-testid="select-assign-driver"><SelectValue placeholder="Unassigned" /></SelectTrigger></FormControl>
                            <SelectContent
                              className="max-h-[55vh] overflow-y-auto"
                              position="popper"
                              side="bottom"
                              sideOffset={4}
                              avoidCollisions={false}
                            >
                              <SelectItem value="unassigned">Unassigned</SelectItem>
                              {(() => {
                                const list = drivers ?? [];
                                const owners = list.filter((d: any) => d.own_vehicle !== false);
                                const hired = list.filter((d: any) => d.own_vehicle === false);
                                const renderItem = (driver: any) => (
                                  <SelectItem key={driver.id} value={driver.id}>
                                    {driver.staff_no ? `${driver.staff_no} · ` : ""}{driver.name}
                                    {driver.vehicle_model || driver.vehicle_type ? ` · ${driver.vehicle_model || driver.vehicle_type}` : ""}
                                    {driver.plate ? ` (${driver.plate})` : ""}
                                  </SelectItem>
                                );
                                return (
                                  <>
                                    {owners.length > 0 && (
                                      <SelectGroup>
                                        <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/80 px-2 py-1">
                                          Owns vehicle
                                        </SelectLabel>
                                        {owners.map(renderItem)}
                                      </SelectGroup>
                                    )}
                                    {hired.length > 0 && (
                                      <SelectGroup>
                                        <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/80 px-2 py-1 mt-1 border-t border-border">
                                          No own vehicle (uses TVL fleet)
                                        </SelectLabel>
                                        {hired.map(renderItem)}
                                      </SelectGroup>
                                    )}
                                  </>
                                );
                              })()}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />

                      {/* Hide the standalone Vehicle field once a driver is
                          assigned — the vehicle is implicit from the driver.
                          Also hide for As Directed bookings where the vehicle
                          is already chosen as a line item above. */}
                      {/* Hide the standalone Vehicle field for Car Rental
                          and As Directed — those flows use the Supplier
                          Product picker (specific car from supplier) instead
                          of a free-text vehicle. */}
                      {!isAsDirected && !isCarRental && (() => {
                        const did = bookingForm.watch("driver_id");
                        const hasDriver = !!did && did !== "unassigned";
                        if (hasDriver) return null;
                        return (
                          <FormField control={bookingForm.control} name="vehicle_type" render={({ field }) => {
                            const currentVal = field.value || "";
                            // Hide by default — product picker / airport matrix
                            // already set vehicle_type. Show the override input
                            // only when operator explicitly opens it OR when
                            // vehicle_type holds a value that DIDN'T come from
                            // the structured pickers (free-text override).
                            const show = showVehicleOverride;
                            if (!show) {
                              return (
                                <FormItem>
                                  <button
                                    type="button"
                                    onClick={() => setShowVehicleOverride(true)}
                                    className="text-xs text-primary hover:underline flex items-center gap-1"
                                    data-testid="toggle-vehicle-override"
                                  >
                                    <Plus className="w-3 h-3" /> Override vehicle
                                    {currentVal && (
                                      <span className="text-muted-foreground font-normal">— current: {currentVal}</span>
                                    )}
                                  </button>
                                </FormItem>
                              );
                            }
                            return (
                        <FormItem>
                          <div className="flex items-center justify-between">
                            <FormLabel>Vehicle <span className="text-xs text-muted-foreground font-normal">(override — pick a driver to auto-fill)</span></FormLabel>
                            <button
                              type="button"
                              onClick={() => setShowVehicleOverride(false)}
                              className="text-[11px] text-muted-foreground hover:text-foreground underline"
                              data-testid="hide-vehicle-override"
                            >
                              Hide
                            </button>
                          </div>
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
                            );
                          }} />
                        );
                      })()}

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
                                    {driver.staff_no ? `${driver.staff_no} · ` : ""}{driver.name} · {driver.vehicle_model || driver.vehicle_type}
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
                                    {driver.staff_no ? `${driver.staff_no} · ` : ""}{driver.name} · {driver.vehicle_model || driver.vehicle_type}
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

              {confirmedClient && !((confirmedClient as any).email ?? "").trim() && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-200 leading-relaxed">
                    <span className="font-semibold">No email on file for {confirmedClient.name}.</span>{" "}
                    The booking will still be created, but confirmation, receipt, and invoice emails will be skipped automatically. Add an email on the client profile to enable them.
                  </div>
                </div>
              )}

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
