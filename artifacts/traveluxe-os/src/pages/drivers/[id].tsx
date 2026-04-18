import { useParams, useLocation } from "wouter";
import { useGetDriver, getGetDriverQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, Edit, ArrowLeft, Star, Calculator } from "lucide-react";
import { format } from "date-fns";

export default function DriverDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const id = params.id as string;

  const { data: driver, isLoading } = useGetDriver(id, {
    query: {
      enabled: !!id,
      queryKey: getGetDriverQueryKey(id)
    }
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[300px] w-full" />
      </div>
    );
  }

  if (!driver) {
    return <div>Driver not found</div>;
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Button variant="ghost" onClick={() => setLocation("/drivers")} className="mb-4">
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Drivers
      </Button>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{driver.name}</h1>
            <Badge variant="outline" className={driver.status === 'Active' ? 'bg-green-500/20 text-green-500 border-green-500/50' : 'bg-secondary text-secondary-foreground border-border'}>
              {driver.status}
            </Badge>
          </div>
          <p className="text-muted-foreground text-lg">{driver.whatsapp}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {driver.whatsapp && (
            <a href={`https://wa.me/${driver.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">
              <Button className="bg-green-900/20 text-green-500 hover:bg-green-900/40 border border-green-900/50">
                <MessageSquare className="w-4 h-4 mr-2" />
                WhatsApp
              </Button>
            </a>
          )}
          <Button variant="outline">
            <Edit className="w-4 h-4 mr-2" /> Edit
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-primary/10 bg-card md:col-span-2">
          <CardHeader>
            <CardTitle>Driver Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground block mb-1">Vehicle Type</span>
                <span className="font-medium">{driver.vehicle_type}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Vehicle Model</span>
                <span className="font-medium">{driver.vehicle_model || 'N/A'}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">License Plate</span>
                <span className="font-medium">{driver.plate || 'N/A'}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Total Jobs</span>
                <span className="font-medium">{driver.total_jobs || 0}</span>
              </div>
            </div>
            {driver.notes && (
              <div className="pt-4 border-t border-border mt-4">
                <span className="text-muted-foreground block mb-1 text-sm">Notes</span>
                <p className="text-sm">{driver.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-primary/10 bg-card">
          <CardHeader className="pb-2 text-center">
            <CardTitle className="text-muted-foreground text-sm font-normal">Average Rating</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <div className="text-5xl font-bold text-primary flex items-center justify-center gap-2 mb-2">
              {driver.avg_rating?.toFixed(1) || '0.0'} <Star className="w-8 h-8 fill-primary" />
            </div>
            <div className="text-xs text-muted-foreground">{driver.ratings?.length || 0} total ratings</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 mt-6">
        <Card className="border-primary/10 bg-card">
          <CardHeader>
            <CardTitle className="flex justify-between items-center">
              <span>Commission Ledger</span>
              <Calculator className="w-5 h-5 text-muted-foreground" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {driver.commission_ledger && driver.commission_ledger.length > 0 ? (
              <div className="space-y-4">
                {driver.commission_ledger.map((entry, idx) => (
                  <div key={idx} className="flex flex-col sm:flex-row sm:justify-between sm:items-center p-3 rounded-lg border border-border bg-background/50 gap-2">
                    <div>
                      <div className="font-medium font-mono text-xs text-muted-foreground">{entry.tvl_ref}</div>
                      <div className="text-sm">{entry.client_name || 'Booking'}</div>
                      <div className="text-xs text-muted-foreground">{entry.date ? format(new Date(entry.date), 'PP') : ''}</div>
                    </div>
                    <div className="text-right flex flex-row sm:flex-col justify-between sm:justify-start items-center sm:items-end gap-2">
                      <div className="text-sm">
                        <span className="text-muted-foreground">TVL: </span>
                        <span className="font-bold text-primary">£{entry.tvl_commission}</span>
                      </div>
                      <Badge variant="outline" className={entry.commission_status === 'Settled' || entry.payout_status === 'Paid' ? 'text-green-500' : 'text-amber-500'}>
                        {entry.payment_method === 'Cash' ? entry.commission_status : entry.payout_status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm border border-dashed rounded-lg">
                No commission history
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
