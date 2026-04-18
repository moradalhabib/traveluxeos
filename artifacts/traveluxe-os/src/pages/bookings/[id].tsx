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
import { ArrowLeft, MessageSquare, Clock, XCircle, FileText, Star, Plane } from "lucide-react";
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
    query: {
      enabled: !!id,
      queryKey: getGetBookingQueryKey(id)
    }
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
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[300px] w-full" />
      </div>
    );
  }

  if (!booking) {
    return <div>Booking not found</div>;
  }

  const getStatusColor = (s: string) => {
    switch (s) {
      case 'Confirmed': return 'bg-blue-500/20 text-blue-500 border-blue-500/50';
      case 'Driver Assigned': return 'bg-primary/20 text-primary border-primary/50';
      case 'Active': return 'bg-green-500/20 text-green-500 border-green-500/50';
      case 'Completed': return 'bg-gray-500/20 text-gray-500 border-gray-500/50';
      case 'Cancelled': return 'bg-destructive/20 text-destructive border-destructive/50';
      case 'Invoiced': return 'bg-purple-500/20 text-purple-500 border-purple-500/50';
      default: return 'bg-secondary text-secondary-foreground border-border';
    }
  };

  const getVipBadgeColor = (tier?: string) => {
    switch (tier) {
      case 'VVIP': return 'bg-purple-500/20 text-purple-400 border-purple-500/50';
      case 'VIP': return 'bg-primary/20 text-primary border-primary/50';
      default: return 'bg-secondary text-secondary-foreground border-border';
    }
  };

  const handleUpdateStatus = (status: string) => {
    updateStatus.mutate({ id, data: { status } }, {
      onSuccess: () => {
        toast({ title: `Booking marked as ${status}` });
        refetch();
      }
    });
  };

  const handleCancel = () => {
    cancelBooking.mutate({ id, data: { reason: cancelReason, cancellation_fee: cancelFee } }, {
      onSuccess: () => {
        toast({ title: "Booking cancelled" });
        setIsCancelOpen(false);
        refetch();
      }
    });
  };

  const handleAddWaiting = () => {
    addWaiting.mutate({ id, data: { amount: waitingAmount } }, {
      onSuccess: () => {
        toast({ title: "Waiting time added" });
        setIsWaitingOpen(false);
        refetch();
      }
    });
  };

  const handleRate = () => {
    if (!booking.driver_id) return;
    rateDriver.mutate({ id: booking.driver_id, data: { booking_id: id, rating, note: ratingNote } }, {
      onSuccess: () => {
        toast({ title: "Driver rated" });
        setIsRateOpen(false);
      }
    });
  };

  const handleInvoice = () => {
    generateInvoice.mutate({ data: { booking_id: id } }, {
      onSuccess: () => {
        toast({ title: "Invoice generated" });
        refetch();
      }
    });
  };

  const flightStatusColor = (status?: string) => {
    switch(status?.toLowerCase()) {
      case 'landed': return 'text-blue-500';
      case 'delayed': return 'text-amber-500';
      case 'cancelled': return 'text-destructive';
      case 'on time': return 'text-green-500';
      default: return 'text-muted-foreground';
    }
  };

  // Messaging functions would be here... generating whatsapp links based on rules
  const messageClientUrl = `https://wa.me/something`;
  const messageDriverUrl = `https://wa.me/something`;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
        <Button variant="ghost" onClick={() => setLocation("/bookings")} className="self-start">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Bookings
        </Button>
        <div className="flex gap-2">
          <a href={messageClientUrl} target="_blank" rel="noopener noreferrer">
            <Button className="bg-green-900/20 text-green-500 hover:bg-green-900/40 border border-green-900/50">
              <MessageSquare className="w-4 h-4 mr-2" /> Message Client
            </Button>
          </a>
          <a href={messageDriverUrl} target="_blank" rel="noopener noreferrer">
            <Button className="bg-green-900/20 text-green-500 hover:bg-green-900/40 border border-green-900/50">
              <MessageSquare className="w-4 h-4 mr-2" /> Message Driver
            </Button>
          </a>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{booking.tvl_ref}</h1>
            <Badge variant="outline" className={getStatusColor(booking.status)}>
              {booking.status}
            </Badge>
            {booking.is_amended && (
              <Badge variant="outline" className="bg-amber-500/20 text-amber-500 border-amber-500/50">Amended</Badge>
            )}
          </div>
          <p className="text-muted-foreground text-lg">{booking.service_type} • {booking.date_time ? format(new Date(booking.date_time), 'PPp') : ''}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {booking.status !== 'Completed' && booking.status !== 'Cancelled' && (
            <>
              {booking.status !== 'Active' && (
                <Button variant="outline" onClick={() => handleUpdateStatus('Active')} className="text-green-500 hover:bg-green-500/10">
                  Mark Active
                </Button>
              )}
              <Button variant="outline" onClick={() => handleUpdateStatus('Completed')} className="text-gray-400 hover:bg-gray-500/10">
                Mark Completed
              </Button>
              
              <Dialog open={isWaitingOpen} onOpenChange={setIsWaitingOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="text-amber-500 hover:bg-amber-500/10">
                    <Clock className="w-4 h-4 mr-2" /> Add Waiting
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Add Waiting Time Charge</DialogTitle></DialogHeader>
                  <div className="py-4">
                    <Input type="number" placeholder="Amount in GBP" value={waitingAmount || ''} onChange={e => setWaitingAmount(Number(e.target.value))} />
                  </div>
                  <DialogFooter>
                    <Button onClick={handleAddWaiting}>Save Charge</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={isCancelOpen} onOpenChange={setIsCancelOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="text-destructive hover:bg-destructive/10">
                    <XCircle className="w-4 h-4 mr-2" /> Cancel
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Cancel Booking</DialogTitle></DialogHeader>
                  <div className="space-y-4 py-4">
                    <Textarea placeholder="Reason for cancellation" value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
                    <Input type="number" placeholder="Cancellation fee (if applicable)" value={cancelFee || ''} onChange={e => setCancelFee(Number(e.target.value))} />
                  </div>
                  <DialogFooter>
                    <Button variant="destructive" onClick={handleCancel}>Confirm Cancellation</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
          
          {booking.status === 'Completed' && (
            <>
              <Button variant="outline" onClick={handleInvoice}>
                <FileText className="w-4 h-4 mr-2" /> Generate Invoice
              </Button>
              <Dialog open={isRateOpen} onOpenChange={setIsRateOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="text-primary hover:bg-primary/10">
                    <Star className="w-4 h-4 mr-2" /> Rate Driver
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Rate Driver</DialogTitle></DialogHeader>
                  <div className="space-y-4 py-4">
                    <Input type="number" min="1" max="5" placeholder="Rating (1-5)" value={rating} onChange={e => setRating(Number(e.target.value))} />
                    <Textarea placeholder="Notes" value={ratingNote} onChange={e => setRatingNote(e.target.value)} />
                  </div>
                  <DialogFooter>
                    <Button onClick={handleRate}>Submit Rating</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {booking.flight_status && (
            <Card className="border-blue-500/30 bg-blue-500/5">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Plane className="w-5 h-5 text-blue-500" />
                  <div>
                    <div className="font-bold">{booking.flight_number}</div>
                    <div className="text-sm text-muted-foreground">{booking.flight_status.origin} → {booking.flight_status.destination}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`font-bold ${flightStatusColor(booking.flight_status.status)}`}>{booking.flight_status.status}</div>
                  {booking.flight_status.delay_minutes ? (
                    <div className="text-sm text-amber-500">Delayed {booking.flight_status.delay_minutes} mins</div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-primary/10 bg-card">
            <CardHeader><CardTitle>Client & Driver</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="text-sm text-muted-foreground uppercase mb-2">Client</div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-lg">{booking.client_name}</span>
                  {booking.client_vip_tier && (
                    <Badge variant="outline" className={getVipBadgeColor(booking.client_vip_tier)}>{booking.client_vip_tier}</Badge>
                  )}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground uppercase mb-2">Driver</div>
                {booking.driver_name ? (
                  <div>
                    <span className="font-bold text-lg block">{booking.driver_name}</span>
                    <span className="text-sm text-muted-foreground">{booking.driver_vehicle}</span>
                  </div>
                ) : (
                  <span className="text-destructive font-medium">Unassigned</span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/10 bg-card">
            <CardHeader><CardTitle>Journey Details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <div className="col-span-2 md:col-span-1">
                <span className="text-muted-foreground block mb-1">Pickup</span>
                <span className="font-medium">{booking.pickup || '-'}</span>
              </div>
              <div className="col-span-2 md:col-span-1">
                <span className="text-muted-foreground block mb-1">Dropoff / Destination</span>
                <span className="font-medium">{booking.dropoff || booking.destination || '-'}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Vehicle Requested</span>
                <span className="font-medium">{booking.vehicle_type || '-'}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Passengers / Luggage</span>
                <span className="font-medium">{booking.passengers || 0} / {booking.luggage || 0}</span>
              </div>
              {booking.nameboard && (
                <div className="col-span-2">
                  <span className="text-muted-foreground block mb-1">Nameboard</span>
                  <span className="font-medium">{booking.nameboard}</span>
                </div>
              )}
              {booking.special_requests && (
                <div className="col-span-2">
                  <span className="text-muted-foreground block mb-1">Special Requests</span>
                  <span className="font-medium">{booking.special_requests}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {booking.audit_log && booking.audit_log.length > 0 && (
            <Card className="border-primary/10 bg-card">
              <CardHeader><CardTitle>Audit Log</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {booking.audit_log.map(log => (
                  <div key={log.id} className="text-sm border-b border-border pb-2 last:border-0">
                    <span className="font-medium">{log.operator_name || 'System'}</span>
                    <span className="text-muted-foreground mx-2">{log.action}</span>
                    <span className="text-xs text-muted-foreground block mt-1">{format(new Date(log.created_at), 'PPp')}</span>
                    {log.detail && <span className="text-xs mt-1 block">{log.detail}</span>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="border-primary/10 bg-card">
            <CardHeader><CardTitle>Financials</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center pb-2 border-b border-border">
                <span className="text-muted-foreground">Total Fare</span>
                <span className="font-bold text-lg text-primary">£{(booking.price || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Additional Charges</span>
                <span className="font-medium">£{(booking.additional_charges || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">TVL Commission</span>
                <span className="font-medium">£{(booking.tvl_commission || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Driver Receives</span>
                <span className="font-medium">£{(booking.driver_receives || 0).toLocaleString()}</span>
              </div>
              
              <div className="pt-4 mt-4 border-t border-border space-y-3">
                <div>
                  <span className="text-xs text-muted-foreground uppercase block mb-1">Payment Status</span>
                  <Badge variant="outline" className={booking.payment_status === 'Paid' ? 'text-green-500' : 'text-amber-500'}>
                    {booking.payment_status}
                  </Badge>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground uppercase block mb-1">Payment Method</span>
                  <span className="text-sm font-medium">{booking.payment_method || '-'}</span>
                </div>
              </div>
            </CardContent>
          </Card>
          
          {booking.invoice && (
            <Card className="border-purple-500/30 bg-purple-500/5">
              <CardContent className="p-4 flex justify-between items-center">
                <div>
                  <div className="font-bold text-purple-400">Invoice {booking.invoice.invoice_number}</div>
                  <div className="text-xs text-muted-foreground">{booking.invoice.status}</div>
                </div>
                <Button variant="ghost" size="icon" className="text-purple-400 hover:text-purple-300 hover:bg-purple-500/20">
                  <FileText className="w-5 h-5" />
                </Button>
              </CardContent>
            </Card>
          )}

          {booking.notes && (
            <Card className="border-primary/10 bg-card">
              <CardHeader><CardTitle className="text-sm">Internal Notes</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm">{booking.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
