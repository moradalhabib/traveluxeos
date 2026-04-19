import { useParams, useLocation } from "wouter";
import {
  useGetBooking, getGetBookingQueryKey,
  useUpdateBookingStatus, useCancelBooking,
  useAddWaitingTime, useGenerateInvoice, useRateDriver
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, MessageSquare, Clock, XCircle, FileText, Star, Plane, MapPin, Car, Users, Package, ClipboardList, Gift, Map, Building2, CalendarRange } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";

export default function BookingDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const id = params.id as string;
  const { toast } = useToast();

  const { data: booking, isLoading, refetch } = useGetBooking(id, {
    query: { enabled: !!id, queryKey: getGetBookingQueryKey(id) }
  });

  const updateStatus = useUpdateBookingStatus();
  const cancelBooking = useCancelBooking();
  const addWaiting = useAddWaitingTime();
  const generateInvoice = useGenerateInvoice();
  const rateDriver = useRateDriver();

  const [cancelReason, setCancelReason] = useState("");
  const [cancelFee, setCancelFee] = useState(0);
  const [waitingAmount, setWaitingAmount] = useState(0);
  const [rating, setRating] = useState(5);
  const [ratingNote, setRatingNote] = useState("");
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [isWaitingOpen, setIsWaitingOpen] = useState(false);
  const [isRateOpen, setIsRateOpen] = useState(false);

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
      onSuccess: () => { toast({ title: `Booking marked as ${status}` }); refetch(); }
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

  // Build pre-filled WhatsApp messages
  const dateStr = booking.date_time ? format(new Date(booking.date_time), "EEEE d MMMM yyyy") : "TBC";
  const timeStr = booking.date_time ? format(new Date(booking.date_time), "HH:mm") : "TBC";
  const extras = (booking as any).extras;

  const buildClientMessage = () => {
    const lines: string[] = [
      `Dear ${booking.client_name},`,
      ``,
      `Your Traveluxe London booking is confirmed.`,
      ``,
      `Ref: *${booking.tvl_ref}*`,
      `Service: ${booking.service_type}`,
      `Date: ${dateStr}`,
      `Time: ${timeStr}`,
    ];
    if (booking.pickup) lines.push(`Pickup: ${booking.pickup}`);
    if (booking.dropoff || (booking as any).destination) lines.push(`Drop-off: ${booking.dropoff || (booking as any).destination}`);
    if ((booking as any).direction) lines.push(`Direction: ${(booking as any).direction}`);
    if (booking.flight_number) lines.push(`Flight: ${booking.flight_number}`);
    if (booking.nameboard) lines.push(``, `Your driver will be waiting with a name board: *"${booking.nameboard}"*`);
    if (booking.vehicle_type) lines.push(`Vehicle: ${booking.vehicle_type}`);
    if (extras) lines.push(`Extras: ${extras}`);
    if ((booking as any).tour_name) lines.push(`Tour: ${(booking as any).tour_name}`);
    if ((booking as any).meeting_point) lines.push(`Meeting point: ${(booking as any).meeting_point}`);
    if ((booking as any).property_name) lines.push(`Property: ${(booking as any).property_name}`);
    if ((booking as any).property_address) lines.push(`Address: ${(booking as any).property_address}`);
    if ((booking as any).check_in_date) lines.push(`Check-in: ${format(new Date((booking as any).check_in_date), "dd MMM yyyy HH:mm")}`);
    if ((booking as any).check_out_date) lines.push(`Check-out: ${format(new Date((booking as any).check_out_date), "dd MMM yyyy HH:mm")}`);
    if (booking.driver_name) lines.push(``, `Your driver: *${booking.driver_name}*`);
    lines.push(``, `Any questions? We are always here for you.`, `Traveluxe London — Mayfair`);
    return lines.join('\n');
  };

  const buildDriverMessage = () => {
    const lines: string[] = [
      `Hi ${booking.driver_name || 'Driver'},`,
      ``,
      `Please confirm receipt of your upcoming job:`,
      ``,
      `Ref: *${booking.tvl_ref}*`,
      `Service: ${booking.service_type}`,
      `Date: ${dateStr}`,
      `Time: ${timeStr}`,
    ];
    if ((booking as any).direction) lines.push(`Direction: ${(booking as any).direction}`);
    if (booking.flight_number) lines.push(`Flight: ${booking.flight_number}`);
    if (booking.pickup) lines.push(`Pickup: ${booking.pickup}`);
    if (booking.dropoff || (booking as any).destination) lines.push(`Drop-off: ${booking.dropoff || (booking as any).destination}`);
    if (booking.passengers) lines.push(`Passengers: ${booking.passengers}`);
    if (booking.luggage) lines.push(`Luggage: ${booking.luggage}`);
    if (booking.vehicle_type) lines.push(`Vehicle: ${booking.vehicle_type}`);
    if (booking.nameboard) lines.push(`Name Board: *"${booking.nameboard}"*`);
    if (extras) lines.push(`Extras: ${extras}`);
    if ((booking as any).special_requests) lines.push(`Notes: ${(booking as any).special_requests}`);
    if ((booking as any).tour_name) lines.push(`Tour: ${(booking as any).tour_name}`);
    if ((booking as any).meeting_point) lines.push(`Meeting point: ${(booking as any).meeting_point}`);
    if ((booking as any).itinerary) lines.push(`Itinerary:\n${(booking as any).itinerary}`);
    if ((booking as any).property_name) lines.push(`Property: ${(booking as any).property_name} — ${(booking as any).property_address || ""}`);
    lines.push(``, `Please confirm. Thank you.`, `Traveluxe London`);
    // Privacy: NEVER include client whatsapp
    return lines.join('\n');
  };

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
        <Button variant="ghost" size="icon" onClick={() => setLocation("/jobs")} className="-ml-2">
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

      {/* WHATSAPP BUTTONS — Large and prominent */}
      <div className="grid grid-cols-1 gap-3">
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
        <div className="flex gap-2 flex-wrap">
          {booking.status !== 'Active' && (
            <Button variant="outline" size="sm" onClick={() => handleUpdateStatus('Active')} className="text-green-400 hover:bg-green-500/10 border-green-500/30">
              Mark Active
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => handleUpdateStatus('Completed')} className="text-gray-400 hover:bg-gray-500/10">
            Mark Completed
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
      )}

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

      {/* Journey details */}
      <Card className="border-primary/10 bg-card">
        <CardHeader className="pb-2"><CardTitle className="text-base">Journey</CardTitle></CardHeader>
        <CardContent className="space-y-3">
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

          {/* Accommodation details */}
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

      {/* Financials */}
      <Card className="border-primary/10 bg-card">
        <CardHeader className="pb-2"><CardTitle className="text-base">Financials</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between items-center pb-2 border-b border-border">
            <span className="text-muted-foreground">Total Fare</span>
            <span className="font-bold text-xl text-primary">£{(booking.price || 0).toLocaleString()}</span>
          </div>
          {(booking.additional_charges || 0) > 0 && (
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Additional Charges</span>
              <span className="font-medium">£{(booking.additional_charges || 0).toLocaleString()}</span>
            </div>
          )}
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">TVL Commission</span>
            <span className="font-medium">£{(booking.tvl_commission || 0).toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Driver Receives</span>
            <span className="font-medium text-blue-400">£{(booking.driver_receives || 0).toLocaleString()}</span>
          </div>
          <div className="flex gap-3 pt-2">
            <Badge variant="outline" className={booking.payment_status === 'Paid' ? 'text-green-400 border-green-500/30' : 'text-amber-400 border-amber-500/30'}>
              {booking.payment_status}
            </Badge>
            {booking.payment_method && (
              <Badge variant="outline">{booking.payment_method}</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Invoice */}
      {booking.invoice && (
        <Card className="border-purple-500/30 bg-purple-500/5">
          <CardContent className="p-4 flex justify-between items-center">
            <div>
              <div className="font-bold text-purple-400">Invoice {booking.invoice.invoice_number}</div>
              <div className="text-xs text-muted-foreground">{booking.invoice.status}</div>
            </div>
            <Button variant="ghost" size="icon" className="text-purple-400">
              <FileText className="w-5 h-5" />
            </Button>
          </CardContent>
        </Card>
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
