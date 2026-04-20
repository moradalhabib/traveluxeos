import { useParams, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBooking, getGetBookingQueryKey,
  useUpdateBookingStatus, useCancelBooking,
  useAddWaitingTime, useGenerateInvoice, useRateDriver,
  useUpdateBooking,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, MessageSquare, Clock, XCircle, FileText, Star, Plane, MapPin, Car, Users, Package, ClipboardList, Gift, Map, Building2, CalendarRange } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";

export default function BookingDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const id = params.id as string;
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const isResidenceManager = user?.role === "residence_manager";

  const { data: booking, isLoading, refetch } = useGetBooking(id, {
    query: { enabled: !!id, queryKey: getGetBookingQueryKey(id) }
  });

  const [orderLines, setOrderLines] = useState<any[]>([]);

  useEffect(() => {
    if (!id) return;
    supabase
      .from("booking_products")
      .select("*")
      .eq("booking_id", id)
      .order("created_at")
      .then(({ data }) => setOrderLines(data ?? []));
  }, [id]);

  const updateStatus = useUpdateBookingStatus();
  const cancelBooking = useCancelBooking();
  const addWaiting = useAddWaitingTime();
  const generateInvoice = useGenerateInvoice();
  const rateDriver = useRateDriver();
  const updateBooking = useUpdateBooking();

  const [cancelReason, setCancelReason] = useState("");
  const [cancelFee, setCancelFee] = useState(0);
  const [waitingAmount, setWaitingAmount] = useState(0);
  const [rating, setRating] = useState(5);
  const [ratingNote, setRatingNote] = useState("");
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [isWaitingOpen, setIsWaitingOpen] = useState(false);
  const [isRateOpen, setIsRateOpen] = useState(false);

  // Edit Booking dialog — works for ALL service types.
  // Clients change flight dates, swap vehicles, extend stays, adjust tour
  // itineraries — every one of those needs to be amendable from the job
  // sheet without recreating the booking. Fields shown are conditional on
  // the booking's service_type (see the dialog body below).
  // State is hydrated lazily from the booking when the dialog opens so we
  // never overwrite the operator's input mid-typing.
  const [isEditOpen, setIsEditOpen] = useState(false);
  // Accommodation fields
  const [editCheckIn, setEditCheckIn] = useState("");
  const [editCheckOut, setEditCheckOut] = useState("");
  const [editNights, setEditNights] = useState<number>(0);
  const [editCommission, setEditCommission] = useState<number>(0);
  const [editHotelName, setEditHotelName] = useState("");
  const [editRoomType, setEditRoomType] = useState("");
  const [editHotelBookingRef, setEditHotelBookingRef] = useState("");
  const [editNumGuests, setEditNumGuests] = useState<number>(0);
  // Transport / tour fields
  const [editDateTime, setEditDateTime] = useState("");
  const [editPickup, setEditPickup] = useState("");
  const [editDropoff, setEditDropoff] = useState("");
  const [editVehicle, setEditVehicle] = useState("");
  const [editFlight, setEditFlight] = useState("");
  const [editDirection, setEditDirection] = useState<"Arrival" | "Departure" | "">("");
  const [editPax, setEditPax] = useState<number>(0);
  const [editLuggage, setEditLuggage] = useState<number>(0);
  const [editDuration, setEditDuration] = useState<number>(0);
  const [editTourName, setEditTourName] = useState("");
  const [editMeetingPoint, setEditMeetingPoint] = useState("");
  // Common
  const [editPrice, setEditPrice] = useState<number>(0);
  const [editTvlCommission, setEditTvlCommission] = useState<number>(0);

  const openEdit = () => {
    if (!booking) return;
    const b = booking as any;
    // Hotel/Apartment
    setEditCheckIn(b.check_in_date ? String(b.check_in_date).slice(0, 10) : "");
    setEditCheckOut(b.check_out_date ? String(b.check_out_date).slice(0, 10) : "");
    setEditNights(Number(b.nights || b.num_nights || 0));
    setEditCommission(Number(b.commission_amount || 0));
    setEditHotelName(b.hotel_name || "");
    setEditRoomType(b.room_type || "");
    setEditHotelBookingRef(b.hotel_booking_ref || "");
    setEditNumGuests(Number(b.num_guests || 0));
    // Transport — datetime-local needs YYYY-MM-DDTHH:mm
    setEditDateTime(b.date_time ? String(b.date_time).slice(0, 16) : "");
    setEditPickup(b.pickup || "");
    setEditDropoff(b.dropoff || b.destination || "");
    setEditVehicle(b.vehicle_type || "");
    setEditFlight(b.flight_number || "");
    setEditDirection((b.direction as any) || "");
    setEditPax(Number(b.passengers || 0));
    setEditLuggage(Number(b.luggage || 0));
    setEditDuration(Number(b.duration || 0));
    setEditTourName(b.tour_name || "");
    setEditMeetingPoint(b.meeting_point || "");
    // Common
    setEditPrice(Number(b.price || 0));
    setEditTvlCommission(Number(b.tvl_commission || 0));
    setIsEditOpen(true);
  };

  // Recompute nights for accommodation when dates change
  useEffect(() => {
    if (editCheckIn && editCheckOut) {
      const a = new Date(editCheckIn);
      const c = new Date(editCheckOut);
      const diff = Math.max(0, Math.ceil((c.getTime() - a.getTime()) / 86400000));
      setEditNights(diff);
    }
  }, [editCheckIn, editCheckOut]);

  const handleEditSave = () => {
    if (!booking) return;
    const svcType = booking.service_type;
    const isHotel = svcType === "Hotel";
    const isApt = svcType === "Apartment";
    const isAccommodationEdit = isHotel || isApt;

    const payload: Record<string, any> = {
      price: Number.isFinite(editPrice) ? editPrice : undefined,
      is_amended: true,
    };

    if (isAccommodationEdit) {
      // Hotel/Apartment: dates + commission. NO transport fields.
      payload.check_in_date = editCheckIn || undefined;
      payload.check_out_date = editCheckOut || undefined;
      payload.commission_amount = Number.isFinite(editCommission) ? editCommission : undefined;
      if (isHotel) payload.num_nights = editNights || undefined;
      else payload.nights = editNights || undefined;
      // Keep date_time aligned with check-in for sorting
      payload.date_time = editCheckIn ? `${editCheckIn}T12:00:00` : undefined;
      // Hotel-specific details
      if (isHotel) {
        payload.hotel_name = editHotelName || undefined;
        payload.room_type = editRoomType || undefined;
        payload.hotel_booking_ref = editHotelBookingRef || undefined;
        payload.num_guests = editNumGuests || undefined;
      }
    } else {
      // Transport / Tour / As Directed.
      payload.date_time = editDateTime || undefined;
      payload.pickup = editPickup || undefined;
      payload.dropoff = editDropoff || undefined;
      payload.vehicle_type = editVehicle || undefined;
      payload.passengers = Number.isFinite(editPax) ? editPax : undefined;
      payload.luggage = Number.isFinite(editLuggage) ? editLuggage : undefined;
      payload.tvl_commission = Number.isFinite(editTvlCommission) ? editTvlCommission : undefined;
      if (svcType === "Airport Transfer") {
        payload.flight_number = editFlight ? editFlight.toUpperCase() : undefined;
        payload.direction = editDirection || undefined;
      }
      if (svcType === "Tour") {
        payload.tour_name = editTourName || undefined;
        payload.meeting_point = editMeetingPoint || undefined;
        payload.duration = editDuration || undefined;
      }
      if (svcType === "As Directed") {
        payload.duration = editDuration || undefined;
      }
    }

    updateBooking.mutate({ id, data: payload as any }, {
      onSuccess: () => {
        toast({ title: "Booking updated" });
        setIsEditOpen(false);
        refetch();
      },
      onError: (e: any) =>
        toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[300px] w-full" />
      </div>
    );
  }

  if (!booking) return <div className="p-6 text-muted-foreground">Booking not found</div>;

  const getStatusColor = (s: string) => {
    switch (s) {
      case 'Confirmed': return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
      case 'Driver Assigned': return 'bg-primary/20 text-primary border-primary/50';
      case 'Active': return 'bg-green-500/20 text-green-400 border-green-500/50';
      case 'Completed': return 'bg-gray-500/20 text-gray-400 border-gray-500/50';
      case 'Cancelled': return 'bg-destructive/20 text-destructive border-destructive/50';
      case 'Invoiced': return 'bg-purple-500/20 text-purple-400 border-purple-500/50';
      default: return 'bg-secondary text-secondary-foreground border-border';
    }
  };

  const getVipBadgeColor = (tier?: string) => {
    if (tier === 'VVIP') return 'bg-purple-500/20 text-purple-400 border-purple-500/50';
    if (tier === 'VIP') return 'bg-primary/20 text-primary border-primary/50';
    return 'bg-secondary text-secondary-foreground border-border';
  };

  const handleUpdateStatus = (status: string) => {
    updateStatus.mutate({ id, data: { status } }, {
      onSuccess: () => {
        toast({ title: `Booking marked as ${status}` });
        refetch();
        // Auto-generate invoice when booking is confirmed or completed
        if ((status === "Confirmed" || status === "Completed") && !booking?.invoice) {
          generateInvoice.mutate({ data: { booking_id: id } }, {
            onSuccess: (inv) => toast({ title: `Invoice ${(inv as any).invoice_number} auto-generated` }),
          });
        }
      }
    });
  };

  const handleCancel = () => {
    cancelBooking.mutate({ id, data: { reason: cancelReason, cancellation_fee: cancelFee } }, {
      onSuccess: () => { toast({ title: "Booking cancelled" }); setIsCancelOpen(false); refetch(); }
    });
  };

  const handleAddWaiting = () => {
    addWaiting.mutate({ id, data: { amount: waitingAmount } }, {
      onSuccess: () => { toast({ title: "Waiting time added" }); setIsWaitingOpen(false); refetch(); }
    });
  };

  const handleRate = () => {
    if (!booking.driver_id) return;
    rateDriver.mutate({ id: booking.driver_id, data: { booking_id: id, rating, note: ratingNote } }, {
      onSuccess: () => { toast({ title: "Driver rated" }); setIsRateOpen(false); }
    });
  };

  const handleInvoice = () => {
    generateInvoice.mutate({ data: { booking_id: id } }, {
      onSuccess: () => { toast({ title: "Invoice generated" }); refetch(); }
    });
  };

  const flightStatusColor = (status?: string) => {
    switch (status?.toLowerCase()) {
      case 'landed': return 'text-blue-400';
      case 'delayed': return 'text-amber-400';
      case 'cancelled': return 'text-destructive';
      case 'on time': return 'text-green-400';
      default: return 'text-muted-foreground';
    }
  };

  // Header date strings.
  // For Hotel/Apartment we prefer the check-in date — Date & Time isn't
  // captured for accommodation bookings (only check-in / check-out).
  const headerDateSrc =
    (booking.service_type === "Hotel" || booking.service_type === "Apartment")
      ? ((booking as any).check_in_date || booking.date_time)
      : booking.date_time;
  const dateStr = headerDateSrc ? format(new Date(headerDateSrc), "EEEE d MMMM yyyy") : "TBC";
  const timeStr =
    (booking.service_type === "Hotel" || booking.service_type === "Apartment")
      ? ((booking as any).check_out_date
          ? `→ ${format(new Date((booking as any).check_out_date), "d MMM yyyy")}`
          : "")
      : (booking.date_time ? format(new Date(booking.date_time), "HH:mm") : "TBC");
  const extras = (booking as any).extras;

  // Service-type-specific message templates.
  // CRITICAL: each booking is for ONE service type only. Hotel/Apartment
  // bookings have NO driver, NO vehicle, NO name board. If the client also
  // wants an airport transfer it is created as a SEPARATE Airport Transfer
  // booking — never mix transport fields into accommodation messages.
  const svc = booking.service_type;
  const isTransport = svc === "Airport Transfer" || svc === "Tour" || svc === "As Directed";
  const isAccommodation = svc === "Hotel" || svc === "Apartment";
  const fmtDT = (s: string | null | undefined) =>
    s ? format(new Date(s), "EEE d MMM yyyy 'at' HH:mm") : "";

  const buildClientMessage = () => {
    const lines: string[] = [
      `Dear ${booking.client_name},`,
      ``,
      `Your Traveluxe London booking is confirmed.`,
      ``,
      `Ref: *${booking.tvl_ref}*`,
      `Service: ${svc}`,
    ];

    if (svc === "Airport Transfer") {
      lines.push(`Date: ${dateStr}`, `Time: ${timeStr}`);
      if ((booking as any).direction) lines.push(`Direction: ${(booking as any).direction}`);
      if (booking.flight_number) lines.push(`Flight: ${booking.flight_number}`);
      if (booking.pickup) lines.push(`Pickup: ${booking.pickup}`);
      if (booking.dropoff || (booking as any).destination) lines.push(`Drop-off: ${booking.dropoff || (booking as any).destination}`);
      if (booking.passengers) lines.push(`Passengers: ${booking.passengers}`);
      if (booking.luggage) lines.push(`Luggage: ${booking.luggage}`);
      if (booking.vehicle_type) lines.push(`Vehicle: ${booking.vehicle_type}`);
      if (booking.nameboard) lines.push(``, `Your driver will be waiting with a name board: *"${booking.nameboard}"*`);
      if (booking.driver_name) lines.push(`Your driver: *${booking.driver_name}*${(booking as any).driver_staff_no ? ` (Staff ${(booking as any).driver_staff_no})` : ''}`);
    } else if (svc === "Tour") {
      lines.push(`Date: ${dateStr}`, `Time: ${timeStr}`);
      if ((booking as any).tour_name) lines.push(`Tour: ${(booking as any).tour_name}`);
      if ((booking as any).meeting_point) lines.push(`Meeting point: ${(booking as any).meeting_point}`);
      if (booking.pickup) lines.push(`Pickup: ${booking.pickup}`);
      if ((booking as any).destination) lines.push(`Destination: ${(booking as any).destination}`);
      if ((booking as any).itinerary) lines.push(``, `Itinerary:`, `${(booking as any).itinerary}`);
      if (booking.passengers) lines.push(`Passengers: ${booking.passengers}`);
      if (booking.vehicle_type) lines.push(`Vehicle: ${booking.vehicle_type}`);
      if (booking.driver_name) lines.push(`Your driver: *${booking.driver_name}*${(booking as any).driver_staff_no ? ` (Staff ${(booking as any).driver_staff_no})` : ""}`);
    } else if (svc === "As Directed") {
      lines.push(`Date: ${dateStr}`, `Start time: ${timeStr}`);
      if (booking.pickup) lines.push(`Pickup: ${booking.pickup}`);
      if ((booking as any).duration) lines.push(`Duration: ${(booking as any).duration}`);
      if (booking.passengers) lines.push(`Passengers: ${booking.passengers}`);
      if (booking.vehicle_type) lines.push(`Vehicle: ${booking.vehicle_type}`);
      if (booking.driver_name) lines.push(`Your chauffeur: *${booking.driver_name}*${(booking as any).driver_staff_no ? ` (Staff ${(booking as any).driver_staff_no})` : ""}`);
    } else if (svc === "Hotel") {
      // NO driver, NO vehicle, NO name board for hotel bookings.
      if ((booking as any).hotel_name) lines.push(`Hotel: ${(booking as any).hotel_name}`);
      // Hotel booking reference is critical — show it prominently right after the hotel name.
      if ((booking as any).hotel_booking_ref) lines.push(`*Hotel Booking Reference: ${(booking as any).hotel_booking_ref}*`);
      if ((booking as any).room_type) lines.push(`Room: ${(booking as any).room_type}`);
      if ((booking as any).check_in_date) lines.push(`Check-in: ${fmtDT((booking as any).check_in_date)}`);
      if ((booking as any).check_out_date) lines.push(`Check-out: ${fmtDT((booking as any).check_out_date)}`);
      if ((booking as any).num_nights) lines.push(`Nights: ${(booking as any).num_nights}`);
      if ((booking as any).num_guests) lines.push(`Guests: ${(booking as any).num_guests}`);
      if ((booking as any).breakfast_included) lines.push(`Breakfast: Included`);
      lines.push(``, `Please present this booking reference at the hotel front desk on arrival.`);
    } else if (svc === "Apartment") {
      // NO driver, NO vehicle, NO name board for apartment bookings.
      if ((booking as any).property_name) lines.push(`Property: ${(booking as any).property_name}`);
      if ((booking as any).property_address) lines.push(`Address: ${(booking as any).property_address}`);
      if ((booking as any).check_in_date) lines.push(`Check-in: ${fmtDT((booking as any).check_in_date)}`);
      if ((booking as any).check_out_date) lines.push(`Check-out: ${fmtDT((booking as any).check_out_date)}`);
      if ((booking as any).nights) lines.push(`Nights: ${(booking as any).nights}`);
      if ((booking as any).property_contact) lines.push(`Contact: ${(booking as any).property_contact}`);
    } else {
      // Fallback for unknown types — keep it minimal and safe.
      lines.push(`Date: ${dateStr}`, `Time: ${timeStr}`);
    }

    if (extras) lines.push(``, `Extras: ${extras}`);
    lines.push(``, `Any questions? We are always here for you.`, `Traveluxe London — Mayfair`);
    return lines.join('\n');
  };

  const buildDriverMessage = () => {
    // Driver messages only make sense for transport service types.
    // For Hotel/Apartment we still produce a brief notice in case a driver
    // was somehow assigned, but no transport fields will be invented.
    const driverStaffNo = (booking as any).driver_staff_no;
    const driverGreeting = booking.driver_name
      ? `Hi ${booking.driver_name}${driverStaffNo ? ` (${driverStaffNo})` : ''},`
      : `Hi Driver,`;
    const lines: string[] = [
      driverGreeting,
      ``,
      `Please confirm receipt of your upcoming job:`,
      ``,
      `Ref: *${booking.tvl_ref}*`,
      `Service: ${svc}`,
    ];
    if (driverStaffNo) lines.push(`Assigned to: *${driverStaffNo}*`);

    if (svc === "Airport Transfer") {
      lines.push(`Date: ${dateStr}`, `Time: ${timeStr}`);
      if ((booking as any).direction) lines.push(`Direction: ${(booking as any).direction}`);
      if (booking.flight_number) lines.push(`Flight: ${booking.flight_number}`);
      if (booking.pickup) lines.push(`Pickup: ${booking.pickup}`);
      if (booking.dropoff || (booking as any).destination) lines.push(`Drop-off: ${booking.dropoff || (booking as any).destination}`);
      if (booking.passengers) lines.push(`Passengers: ${booking.passengers}`);
      if (booking.luggage) lines.push(`Luggage: ${booking.luggage}`);
      if (booking.vehicle_type) lines.push(`Vehicle: ${booking.vehicle_type}`);
      if (booking.nameboard) lines.push(`Name Board: *"${booking.nameboard}"*`);
    } else if (svc === "Tour") {
      lines.push(`Date: ${dateStr}`, `Time: ${timeStr}`);
      if ((booking as any).tour_name) lines.push(`Tour: ${(booking as any).tour_name}`);
      if ((booking as any).meeting_point) lines.push(`Meeting point: ${(booking as any).meeting_point}`);
      if (booking.pickup) lines.push(`Pickup: ${booking.pickup}`);
      if ((booking as any).destination) lines.push(`Destination: ${(booking as any).destination}`);
      if ((booking as any).itinerary) lines.push(`Itinerary:\n${(booking as any).itinerary}`);
      if (booking.passengers) lines.push(`Passengers: ${booking.passengers}`);
      if (booking.vehicle_type) lines.push(`Vehicle: ${booking.vehicle_type}`);
    } else if (svc === "As Directed") {
      lines.push(`Date: ${dateStr}`, `Start time: ${timeStr}`);
      if (booking.pickup) lines.push(`Pickup: ${booking.pickup}`);
      if ((booking as any).duration) lines.push(`Duration: ${(booking as any).duration}`);
      if (booking.passengers) lines.push(`Passengers: ${booking.passengers}`);
      if (booking.vehicle_type) lines.push(`Vehicle: ${booking.vehicle_type}`);
    } else {
      lines.push(`Date: ${dateStr}`);
    }

    if (extras) lines.push(`Extras: ${extras}`);
    if ((booking as any).special_requests) lines.push(`Notes: ${(booking as any).special_requests}`);
    lines.push(``, `Please confirm. Thank you.`, `Traveluxe London`);
    // Privacy: NEVER include client whatsapp
    return lines.join('\n');
  };
  // suppress unused-var warning for helper flags
  void isTransport; void isAccommodation;

  const clientWa = (booking as any).client_whatsapp?.replace(/\D/g, '') || '';
  const driverWa = (booking as any).driver_whatsapp?.replace(/\D/g, '') || '';

  const clientMsgUrl = `https://wa.me/${clientWa}?text=${encodeURIComponent(buildClientMessage())}`;
  const driverMsgUrl = driverWa
    ? `https://wa.me/${driverWa}?text=${encodeURIComponent(buildDriverMessage())}`
    : null;

  return (
    <div className="space-y-5 max-w-3xl mx-auto pb-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            if (window.history.length > 1) window.history.back();
            else setLocation("/jobs");
          }}
          className="-ml-2"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold tracking-tight font-mono">{booking.tvl_ref}</h1>
            <Badge variant="outline" className={getStatusColor(booking.status)}>{booking.status}</Badge>
            {booking.is_amended && (
              <Badge variant="outline" className="bg-amber-500/20 text-amber-400 border-amber-500/50">Amended</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{booking.service_type} · {dateStr} · {timeStr}</p>
        </div>
      </div>

      {/* WHATSAPP BUTTONS — Large and prominent.
          Hidden until the booking is officially Confirmed.
          Quote = awaiting confirmation (request, not booking) — no client/driver
          message should ever be sent in that state. Cancelled also blocks. */}
      {(() => {
        const blockedStatuses = ['Quote', 'Cancelled'];
        const isAwaitingConfirmation = blockedStatuses.includes(booking.status);
        if (isAwaitingConfirmation) {
          return (
            <div className="rounded-2xl border border-amber-700/40 bg-amber-900/10 p-4 flex items-start gap-3">
              <Clock className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-amber-400 text-sm">
                  {booking.status === 'Cancelled' ? 'Booking cancelled' : 'Awaiting confirmation'}
                </p>
                <p className="text-xs text-amber-600/80 mt-0.5">
                  {booking.status === 'Cancelled'
                    ? 'No messages can be sent for a cancelled booking.'
                    : 'This is a request — confirm the booking before sending any WhatsApp message to the client or driver.'}
                </p>
                {booking.status === 'Quote' && (
                  <Button
                    size="sm"
                    onClick={() => handleUpdateStatus('Confirmed')}
                    className="mt-3 bg-amber-500 hover:bg-amber-600 text-black font-semibold"
                  >
                    Confirm Booking
                  </Button>
                )}
              </div>
            </div>
          );
        }
        return null;
      })()}

      <div className={`grid grid-cols-1 gap-3 ${['Quote','Cancelled'].includes(booking.status) ? 'hidden' : ''}`}>
        {clientWa ? (
          <a href={clientMsgUrl} target="_blank" rel="noopener noreferrer">
            <div className="flex items-center gap-4 p-4 rounded-2xl bg-green-900/20 border border-green-700/40 hover:bg-green-900/30 hover:border-green-600/60 transition-all cursor-pointer">
              <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center flex-shrink-0">
                <MessageSquare className="w-6 h-6 text-green-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-green-400 text-base">Message Client</p>
                <p className="text-xs text-green-600 truncate">{booking.client_name} — booking confirmation pre-filled</p>
              </div>
            </div>
          </a>
        ) : (
          <div className="flex items-center gap-4 p-4 rounded-2xl bg-muted/20 border border-border opacity-50">
            <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
              <MessageSquare className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-muted-foreground">Message Client</p>
              <p className="text-xs text-muted-foreground">No WhatsApp number on file</p>
            </div>
          </div>
        )}

        {driverMsgUrl ? (
          <a href={driverMsgUrl} target="_blank" rel="noopener noreferrer">
            <div className="flex items-center gap-4 p-4 rounded-2xl bg-blue-900/20 border border-blue-700/40 hover:bg-blue-900/30 hover:border-blue-600/60 transition-all cursor-pointer">
              <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <Car className="w-6 h-6 text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-blue-400 text-base">Message Driver</p>
                <p className="text-xs text-blue-600 truncate">{booking.driver_name} — job sheet pre-filled (no client number)</p>
              </div>
            </div>
          </a>
        ) : (
          <div className="flex items-center gap-4 p-4 rounded-2xl bg-muted/20 border border-border opacity-50">
            <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
              <Car className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-muted-foreground">Message Driver</p>
              <p className="text-xs text-muted-foreground">{booking.driver_name ? "No driver WhatsApp on file" : "No driver assigned yet"}</p>
            </div>
          </div>
        )}
      </div>

      {/* Status actions */}
      {booking.status !== 'Completed' && booking.status !== 'Cancelled' && (
        <div className="flex flex-col gap-2">
          {booking.status !== 'Active' && (
            <p className="text-xs text-muted-foreground italic">
              💡 The system auto-activates this booking at its scheduled start time. Use <em>Mark Active</em> only to override.
            </p>
          )}
        <div className="flex gap-2 flex-wrap">
          {booking.status !== 'Active' && (
            <Button variant="outline" size="sm" onClick={() => handleUpdateStatus('Active')} className="text-green-400 hover:bg-green-500/10 border-green-500/30">
              Mark Active
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => handleUpdateStatus('Completed')} className="text-gray-400 hover:bg-gray-500/10">
            Mark Completed
          </Button>
          {/* Edit available for every service type — clients change flight
              dates, swap vehicles, extend stays, and tweak tour itineraries. */}
          <Button variant="outline" size="sm" onClick={openEdit} className="text-primary hover:bg-primary/10 border-primary/30">
            <CalendarRange className="w-3.5 h-3.5 mr-1.5" />
            {svc === "Apartment" ? "Extend / Edit" : "Edit Booking"}
          </Button>
          <Dialog open={isWaitingOpen} onOpenChange={setIsWaitingOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-amber-400 hover:bg-amber-500/10 border-amber-500/30">
                <Clock className="w-3.5 h-3.5 mr-1.5" /> Add Waiting
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Waiting Time Charge</DialogTitle></DialogHeader>
              <div className="py-4">
                <Input type="number" placeholder="Amount in GBP" value={waitingAmount || ''} onChange={e => setWaitingAmount(Number(e.target.value))} />
              </div>
              <DialogFooter><Button onClick={handleAddWaiting}>Save Charge</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={isCancelOpen} onOpenChange={setIsCancelOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10 border-destructive/30">
                <XCircle className="w-3.5 h-3.5 mr-1.5" /> Cancel
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Cancel Booking</DialogTitle></DialogHeader>
              <div className="space-y-4 py-4">
                <Textarea placeholder="Reason for cancellation" value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
                <Input type="number" placeholder="Cancellation fee (if applicable)" value={cancelFee || ''} onChange={e => setCancelFee(Number(e.target.value))} />
              </div>
              <DialogFooter><Button variant="destructive" onClick={handleCancel}>Confirm Cancellation</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        </div>
      )}

      {/* Edit Booking dialog — works for every service type.
          Mounted outside the conditional status-actions block so it can be
          opened from either Confirmed or Active states without being torn
          down between renders. The fields shown are conditional on the
          booking's service_type so each amendment matches its service. */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {svc === "Apartment" ? "Extend / Edit Booking" : `Edit ${svc} Booking`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {/* Hotel + Apartment: dates + hotel-specific details */}
            {(svc === "Hotel" || svc === "Apartment") && (
              <>
                {svc === "Hotel" && (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Hotel Name</p>
                      <Input value={editHotelName} onChange={e => setEditHotelName(e.target.value)} placeholder="e.g. The Lanesborough" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Hotel Booking Reference</p>
                      <Input value={editHotelBookingRef} onChange={e => setEditHotelBookingRef(e.target.value)} placeholder="External booking ref" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Room Type</p>
                        <Input value={editRoomType} onChange={e => setEditRoomType(e.target.value)} placeholder="e.g. Deluxe Suite" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Number of Guests</p>
                        <Input type="number" min={1} value={editNumGuests || ""} onChange={e => setEditNumGuests(Number(e.target.value))} />
                      </div>
                    </div>
                  </>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Check-in</p>
                    <Input type="date" value={editCheckIn} onChange={e => setEditCheckIn(e.target.value)} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Check-out</p>
                    <Input type="date" value={editCheckOut} onChange={e => setEditCheckOut(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Nights (auto)</p>
                    <Input type="number" value={editNights || ""} onChange={e => setEditNights(Number(e.target.value))} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Total Charged (£)</p>
                    <Input type="number" value={editPrice || ""} onChange={e => setEditPrice(Number(e.target.value))} />
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Commission Earned (£)</p>
                  <Input type="number" value={editCommission || ""} onChange={e => setEditCommission(Number(e.target.value))} />
                </div>
              </>
            )}

            {/* Transport, Tour, As Directed: full operational fields */}
            {(svc === "Airport Transfer" || svc === "Tour" || svc === "As Directed") && (
              <>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Date &amp; Time</p>
                  <Input type="datetime-local" value={editDateTime} onChange={e => setEditDateTime(e.target.value)} />
                </div>

                {svc === "Airport Transfer" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Direction</p>
                      <select
                        value={editDirection}
                        onChange={e => setEditDirection(e.target.value as any)}
                        className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="">—</option>
                        <option value="Arrival">Arrival</option>
                        <option value="Departure">Departure</option>
                      </select>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Flight No.</p>
                      <Input value={editFlight} onChange={e => setEditFlight(e.target.value.toUpperCase())} placeholder="BA123" />
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-xs text-muted-foreground mb-1">Pickup</p>
                  <Input value={editPickup} onChange={e => setEditPickup(e.target.value)} placeholder="Pickup address" />
                </div>
                {svc !== "As Directed" && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      {svc === "Tour" ? "Drop-off / End point" : "Drop-off"}
                    </p>
                    <Input value={editDropoff} onChange={e => setEditDropoff(e.target.value)} placeholder="Drop-off address" />
                  </div>
                )}

                {svc === "Tour" && (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Tour Name</p>
                      <Input value={editTourName} onChange={e => setEditTourName(e.target.value)} />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Meeting Point</p>
                      <Input value={editMeetingPoint} onChange={e => setEditMeetingPoint(e.target.value)} />
                    </div>
                  </>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Vehicle</p>
                    <Input value={editVehicle} onChange={e => setEditVehicle(e.target.value)} placeholder="Mercedes E-Class" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      {svc === "Tour" || svc === "As Directed" ? "Duration (hrs)" : "Pax"}
                    </p>
                    {svc === "Tour" || svc === "As Directed" ? (
                      <Input type="number" value={editDuration || ""} onChange={e => setEditDuration(Number(e.target.value))} />
                    ) : (
                      <Input type="number" value={editPax || ""} onChange={e => setEditPax(Number(e.target.value))} />
                    )}
                  </div>
                </div>

                {svc === "Airport Transfer" && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Luggage</p>
                    <Input type="number" value={editLuggage || ""} onChange={e => setEditLuggage(Number(e.target.value))} />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Total Fare (£)</p>
                    <Input type="number" value={editPrice || ""} onChange={e => setEditPrice(Number(e.target.value))} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">TVL Commission (£)</p>
                    <Input type="number" value={editTvlCommission || ""} onChange={e => setEditTvlCommission(Number(e.target.value))} />
                  </div>
                </div>
              </>
            )}

            <p className="text-xs text-muted-foreground pt-1">
              The booking will be marked <strong>Amended</strong> and the audit log
              will record the change.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={updateBooking.isPending}>
              {updateBooking.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {booking.status === 'Completed' && (
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleInvoice}>
            <FileText className="w-3.5 h-3.5 mr-1.5" /> Generate Invoice
          </Button>
          <Dialog open={isRateOpen} onOpenChange={setIsRateOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-primary hover:bg-primary/10 border-primary/30">
                <Star className="w-3.5 h-3.5 mr-1.5" /> Rate Driver
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Rate Driver</DialogTitle></DialogHeader>
              <div className="space-y-4 py-4">
                <Input type="number" min="1" max="5" placeholder="Rating (1-5)" value={rating} onChange={e => setRating(Number(e.target.value))} />
                <Textarea placeholder="Notes" value={ratingNote} onChange={e => setRatingNote(e.target.value)} />
              </div>
              <DialogFooter><Button onClick={handleRate}>Submit Rating</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* Flight live status */}
      {booking.flight_status && (
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Plane className="w-5 h-5 text-blue-400" />
              <div>
                <div className="font-bold">{booking.flight_number}</div>
                <div className="text-sm text-muted-foreground">{booking.flight_status.origin} → {booking.flight_status.destination}</div>
              </div>
            </div>
            <div className="text-right">
              <div className={`font-bold ${flightStatusColor(booking.flight_status.status)}`}>{booking.flight_status.status}</div>
              {booking.flight_status.delay_minutes ? (
                <div className="text-sm text-amber-400">Delayed {booking.flight_status.delay_minutes} mins</div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Client + Driver */}
      <Card className="border-primary/10 bg-card">
        <CardContent className="p-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase mb-2 font-medium">Client</p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold">{booking.client_name}</span>
              {booking.client_vip_tier && booking.client_vip_tier !== 'Standard' && (
                <Badge variant="outline" className={getVipBadgeColor(booking.client_vip_tier)}>{booking.client_vip_tier}</Badge>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase mb-2 font-medium">Driver</p>
            {booking.driver_name ? (
              <>
                <span className="font-bold block">{booking.driver_name}</span>
                <span className="text-xs text-muted-foreground">{booking.driver_vehicle}</span>
              </>
            ) : (
              <span className="text-destructive font-medium text-sm">Unassigned</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Journey / Property card.
          For Hotel and Apartment bookings the title becomes "Property Details"
          and the transport-only rows (Pickup, Drop-off, Vehicle, Pax/Luggage,
          Flight, Meet & Greet Board) are hidden — those fields do not apply
          to accommodation and would otherwise leak placeholder data into the
          job sheet. */}
      {(() => {
        const accommodation = svc === "Hotel" || svc === "Apartment";
        return (
      <Card className="border-primary/10 bg-card">
        <CardHeader className="pb-2"><CardTitle className="text-base">{accommodation ? "Property Details" : "Journey"}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!accommodation && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" /> Pickup</p>
                <p className="font-medium">{booking.pickup || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" /> Drop-off</p>
                <p className="font-medium">{booking.dropoff || (booking as any).destination || '—'}</p>
              </div>
              {booking.vehicle_type && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Car className="w-3 h-3" /> Vehicle</p>
                  <p className="font-medium">{booking.vehicle_type}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Users className="w-3 h-3" /> Pax / Luggage</p>
                <p className="font-medium">{booking.passengers || 0} pax · {booking.luggage || 0} bags</p>
              </div>
              {booking.flight_number && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Plane className="w-3 h-3" /> Flight</p>
                  <p className="font-medium">{booking.flight_number} · {(booking as any).direction}</p>
                </div>
              )}
              {booking.nameboard && (
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground mb-1">Meet &amp; Greet Board</p>
                  <p className="font-bold text-primary text-lg">"{booking.nameboard}"</p>
                </div>
              )}
            </div>
          )}

          {extras && (
            <div className="pt-3 border-t border-border">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Gift className="w-3 h-3" /> Extras</p>
              <p className="font-medium">{extras}</p>
            </div>
          )}

          {(booking as any).special_requests && (
            <div className="pt-3 border-t border-border">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><ClipboardList className="w-3 h-3" /> Special Requests</p>
              <p className="font-medium">{(booking as any).special_requests}</p>
            </div>
          )}

          {/* Tour details */}
          {(booking as any).tour_name && (
            <div className="pt-3 border-t border-border space-y-2">
              <p className="text-xs text-muted-foreground uppercase font-semibold flex items-center gap-1"><Map className="w-3 h-3" /> Tour</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground mb-1">Tour Name</p>
                  <p className="font-semibold text-foreground">{(booking as any).tour_name}</p>
                </div>
                {(booking as any).meeting_point && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Meeting Point</p>
                    <p className="font-medium">{(booking as any).meeting_point}</p>
                  </div>
                )}
                {(booking as any).duration && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Duration</p>
                    <p className="font-medium">{(booking as any).duration} hrs</p>
                  </div>
                )}
                {(booking as any).guide_included && (
                  <div>
                    <Badge variant="outline" className="text-primary border-primary/30 text-xs">Guide Included</Badge>
                  </div>
                )}
                {(booking as any).itinerary && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground mb-1">Itinerary</p>
                    <p className="text-sm whitespace-pre-line">{(booking as any).itinerary}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Hotel details */}
          {svc === "Hotel" && (
            <div className="pt-3 border-t border-border space-y-2">
              <p className="text-xs text-muted-foreground uppercase font-semibold flex items-center gap-1"><Building2 className="w-3 h-3" /> Hotel</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {(booking as any).hotel_name && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground mb-1">Hotel Name</p>
                    <p className="font-semibold text-foreground">{(booking as any).hotel_name}</p>
                  </div>
                )}
                {(booking as any).hotel_booking_ref && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground mb-1">Hotel Booking Reference</p>
                    <p className="font-bold text-primary">{(booking as any).hotel_booking_ref}</p>
                  </div>
                )}
                {(booking as any).room_type && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Room Type</p>
                    <p className="font-medium">{(booking as any).room_type}</p>
                  </div>
                )}
                {(booking as any).num_guests && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Users className="w-3 h-3" /> Guests</p>
                    <p className="font-medium">{(booking as any).num_guests} guest{(booking as any).num_guests !== 1 ? "s" : ""}</p>
                  </div>
                )}
                {(booking as any).check_in_date && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><CalendarRange className="w-3 h-3" /> Check-in</p>
                    <p className="font-medium">{format(new Date((booking as any).check_in_date), "dd MMM yyyy")}</p>
                  </div>
                )}
                {(booking as any).check_out_date && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><CalendarRange className="w-3 h-3" /> Check-out</p>
                    <p className="font-medium">{format(new Date((booking as any).check_out_date), "dd MMM yyyy")}</p>
                  </div>
                )}
                {(booking as any).num_nights && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Nights</p>
                    <p className="font-medium">{(booking as any).num_nights} night{(booking as any).num_nights !== 1 ? "s" : ""}</p>
                  </div>
                )}
                {(booking as any).breakfast_included && (
                  <div>
                    <Badge variant="outline" className="text-primary border-primary/30 text-xs">Breakfast Included</Badge>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Accommodation details (Apartment) */}
          {(booking as any).property_name && (
            <div className="pt-3 border-t border-border space-y-2">
              <p className="text-xs text-muted-foreground uppercase font-semibold flex items-center gap-1"><Building2 className="w-3 h-3" /> Accommodation</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground mb-1">Property</p>
                  <p className="font-semibold text-foreground">{(booking as any).property_name}</p>
                  {(booking as any).property_address && <p className="text-xs text-muted-foreground mt-0.5">{(booking as any).property_address}</p>}
                </div>
                {(booking as any).check_in_date && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><CalendarRange className="w-3 h-3" /> Check-in</p>
                    <p className="font-medium">{format(new Date((booking as any).check_in_date), "dd MMM yyyy HH:mm")}</p>
                  </div>
                )}
                {(booking as any).check_out_date && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><CalendarRange className="w-3 h-3" /> Check-out</p>
                    <p className="font-medium">{format(new Date((booking as any).check_out_date), "dd MMM yyyy HH:mm")}</p>
                  </div>
                )}
                {(booking as any).nights && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Nights</p>
                    <p className="font-medium">{(booking as any).nights} night{(booking as any).nights !== 1 ? "s" : ""}</p>
                  </div>
                )}
                {(booking as any).property_contact && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Property Contact</p>
                    <p className="font-medium">{(booking as any).property_contact}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
        );
      })()}

      {/* Order Lines */}
      {orderLines.length > 0 && (
        <Card className="border-primary/10 bg-card">
          <CardHeader className="pb-2"><CardTitle className="text-base">Order Lines</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <div className="divide-y divide-border">
              {orderLines.map((line: any) => (
                <div key={line.id} className="flex items-center justify-between py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground">{line.name}</div>
                    <div className="text-xs text-muted-foreground">
                      £{(line.unit_price ?? 0).toLocaleString()} × {line.quantity}
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-foreground ml-4">
                    £{(line.total ?? line.unit_price * line.quantity ?? 0).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center pt-3 border-t border-border mt-1">
              <span className="text-sm text-muted-foreground">Products Subtotal</span>
              <span className="font-bold text-primary">
                £{orderLines.reduce((s: number, l: any) => s + (l.total ?? l.unit_price * l.quantity ?? 0), 0).toLocaleString()}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Financials — hidden from Residence Managers.
          Accommodation bookings (Hotel/Apartment) have NO driver, so the
          "Driver Receives" line is suppressed. Hotel commission is shown
          as "Commission Earned" (positive — money in) instead of the
          transport-style "TVL Commission". */}
      {!isResidenceManager && (
        <Card className="border-primary/10 bg-card">
          <CardHeader className="pb-2"><CardTitle className="text-base">Financials</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center pb-2 border-b border-border">
              <span className="text-muted-foreground">
                {svc === "Hotel" || svc === "Apartment" ? "Total Charged to Client" : "Total Fare"}
              </span>
              <span className="font-bold text-xl text-primary">£{(booking.price || 0).toLocaleString()}</span>
            </div>
            {(booking.additional_charges || 0) > 0 && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Additional Charges</span>
                <span className="font-medium">£{(booking.additional_charges || 0).toLocaleString()}</span>
              </div>
            )}
            {svc === "Hotel" || svc === "Apartment" ? (
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Commission Earned</span>
                <span className="font-medium text-green-400">
                  £{((booking as any).commission_amount || 0).toLocaleString()}
                </span>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">TVL Commission</span>
                  <span className="font-medium">£{(booking.tvl_commission || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Driver Receives</span>
                  <span className="font-medium text-blue-400">£{(booking.driver_receives || 0).toLocaleString()}</span>
                </div>
              </>
            )}
            <div className="flex items-center gap-3 pt-2 border-t border-border">
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1">Payment Status</p>
                <select
                  value={booking.payment_status || "Unpaid"}
                  onChange={e => updateBooking.mutate({ id, data: { payment_status: e.target.value } as any }, {
                    onSuccess: () => qc.invalidateQueries({ queryKey: getGetBookingQueryKey(id) }),
                  })}
                  className={`h-9 rounded-md border px-3 text-sm bg-background w-full ${
                    booking.payment_status === 'Paid'
                      ? 'text-green-400 border-green-500/40'
                      : booking.payment_status === 'Partial'
                        ? 'text-blue-400 border-blue-500/40'
                        : 'text-amber-400 border-amber-500/40'
                  }`}
                >
                  <option value="Unpaid">Unpaid</option>
                  <option value="Partial">Partial</option>
                  <option value="Paid">Paid</option>
                </select>
              </div>
              {booking.payment_method && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Method</p>
                  <Badge variant="outline" className="h-9 px-3 flex items-center">{booking.payment_method}</Badge>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invoice — hidden from Residence Managers */}
      {!isResidenceManager && (
        booking.invoice ? (
          <Card className="border-purple-500/30 bg-purple-500/5">
            <CardContent className="p-4 flex justify-between items-center">
              <div>
                <div className="font-bold text-purple-400">Invoice {booking.invoice.invoice_number}</div>
                <div className="text-xs text-muted-foreground">{booking.invoice.status}</div>
              </div>
              <Link href={`/invoices/${booking.invoice.id}`}>
                <Button variant="ghost" size="icon" className="text-purple-400">
                  <FileText className="w-5 h-5" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : booking.status !== 'Cancelled' ? (
          <Card className="border-border bg-card">
            <CardContent className="p-4 flex justify-between items-center">
              <div>
                <div className="font-semibold text-sm text-foreground">No Invoice Yet</div>
                <div className="text-xs text-muted-foreground">Generate an invoice for this booking</div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="text-purple-400 border-purple-500/30 hover:bg-purple-500/10"
                disabled={generateInvoice.isPending}
                onClick={() => generateInvoice.mutate({ data: { booking_id: id } }, {
                  onSuccess: () => qc.invalidateQueries({ queryKey: getGetBookingQueryKey(id) }),
                })}
              >
                <FileText className="w-4 h-4 mr-2" />
                {generateInvoice.isPending ? "Generating…" : "Generate Invoice"}
              </Button>
            </CardContent>
          </Card>
        ) : null
      )}

      {/* Internal notes */}
      {booking.notes && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Internal Notes</CardTitle></CardHeader>
          <CardContent><p className="text-sm">{booking.notes}</p></CardContent>
        </Card>
      )}

      {/* Audit log */}
      {booking.audit_log && booking.audit_log.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Audit Log</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {booking.audit_log.map((log: any) => (
              <div key={log.id} className="text-xs border-b border-border pb-2 last:border-0">
                <span className="font-medium text-foreground">{log.operator_name || 'System'}</span>
                <span className="text-muted-foreground mx-2">{log.action}</span>
                <span className="text-muted-foreground block mt-0.5">{format(new Date(log.created_at), 'PPp')}</span>
                {log.detail && <span className="text-muted-foreground mt-0.5 block">{log.detail}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
