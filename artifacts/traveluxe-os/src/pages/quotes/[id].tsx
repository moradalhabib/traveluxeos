import { useParams, useLocation } from "wouter";
import { useGetQuote, getGetQuoteQueryKey, useUpdateQuote, useConvertQuoteToBooking } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, MessageSquare, Check, X, FileText } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function QuoteDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const id = params.id as string;
  const { toast } = useToast();

  const { data: quote, isLoading } = useGetQuote(id, {
    query: {
      enabled: !!id,
      queryKey: getGetQuoteQueryKey(id)
    }
  });

  const updateQuote = useUpdateQuote();
  const convertQuote = useConvertQuoteToBooking();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[300px] w-full" />
      </div>
    );
  }

  if (!quote) {
    return <div>Quote not found</div>;
  }

  const getStatusColor = (s: string) => {
    switch (s) {
      case 'Accepted': return 'bg-green-500/20 text-green-500 border-green-500/50';
      case 'Declined': return 'bg-destructive/20 text-destructive border-destructive/50';
      case 'Sent': return 'bg-blue-500/20 text-blue-500 border-blue-500/50';
      case 'Expired': return 'bg-gray-500/20 text-gray-500 border-gray-500/50';
      default: return 'bg-amber-500/20 text-amber-500 border-amber-500/50'; // Pending
    }
  };

  const handleUpdateStatus = (status: string) => {
    updateQuote.mutate({ id, data: { ...quote, status } as any }, {
      onSuccess: () => {
        toast({ title: `Quote marked as ${status}` });
      }
    });
  };

  const handleConvert = () => {
    convertQuote.mutate({ id }, {
      onSuccess: (booking) => {
        toast({ title: "Quote converted to booking" });
        setLocation(`/bookings/${booking.id}`);
      }
    });
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Button variant="ghost" onClick={() => setLocation("/quotes")} className="mb-4">
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Quotes
      </Button>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Quote for {quote.client_name}</h1>
            <Badge variant="outline" className={getStatusColor(quote.status)}>
              {quote.status}
            </Badge>
          </div>
          <p className="text-muted-foreground text-lg">£{quote.price.toLocaleString()} • {quote.service_type}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {quote.status !== 'Accepted' && quote.status !== 'Declined' && (
            <>
              <Button variant="outline" onClick={() => handleUpdateStatus('Accepted')} className="text-green-500 hover:bg-green-500/10">
                <Check className="w-4 h-4 mr-2" /> Accept
              </Button>
              <Button variant="outline" onClick={() => handleUpdateStatus('Declined')} className="text-destructive hover:bg-destructive/10">
                <X className="w-4 h-4 mr-2" /> Decline
              </Button>
            </>
          )}
          {quote.status === 'Accepted' && (
            <Button onClick={handleConvert} className="bg-primary text-primary-foreground">
              <FileText className="w-4 h-4 mr-2" /> Convert to Booking
            </Button>
          )}
        </div>
      </div>

      <Card className="border-primary/10 bg-card">
        <CardHeader>
          <CardTitle>Quote Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground block mb-1">Service Type</span>
              <span className="font-medium">{quote.service_type}</span>
            </div>
            {quote.direction && (
              <div>
                <span className="text-muted-foreground block mb-1">Direction</span>
                <span className="font-medium">{quote.direction}</span>
              </div>
            )}
            <div>
              <span className="text-muted-foreground block mb-1">Date & Time</span>
              <span className="font-medium">{quote.date_time ? format(new Date(quote.date_time), 'PPp') : 'TBD'}</span>
            </div>
            <div>
              <span className="text-muted-foreground block mb-1">Passengers</span>
              <span className="font-medium">{quote.passengers || 1}</span>
            </div>
            {quote.vehicle_type && (
              <div>
                <span className="text-muted-foreground block mb-1">Vehicle Type</span>
                <span className="font-medium">{quote.vehicle_type}</span>
              </div>
            )}
            {quote.duration && (
              <div>
                <span className="text-muted-foreground block mb-1">Duration</span>
                <span className="font-medium">{quote.duration} hours</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm pt-4 border-t border-border">
            {quote.pickup && (
              <div>
                <span className="text-muted-foreground block mb-1">Pickup</span>
                <span className="font-medium">{quote.pickup}</span>
              </div>
            )}
            {quote.dropoff && (
              <div>
                <span className="text-muted-foreground block mb-1">Dropoff</span>
                <span className="font-medium">{quote.dropoff}</span>
              </div>
            )}
            {quote.destination && (
              <div>
                <span className="text-muted-foreground block mb-1">Destination</span>
                <span className="font-medium">{quote.destination}</span>
              </div>
            )}
          </div>

          {quote.notes && (
            <div className="pt-4 border-t border-border">
              <span className="text-muted-foreground block mb-1 text-sm">Notes</span>
              <p className="text-sm">{quote.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
