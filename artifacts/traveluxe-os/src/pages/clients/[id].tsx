import { useParams, useLocation } from "wouter";
import { useGetClient, getGetClientQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, Edit, ArrowLeft, Ban } from "lucide-react";
import { format } from "date-fns";

export default function ClientDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const id = params.id as string;

  const { data: client, isLoading } = useGetClient(id, {
    query: {
      enabled: !!id,
      queryKey: getGetClientQueryKey(id)
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

  if (!client) {
    return <div>Client not found</div>;
  }

  const getVipBadgeColor = (tier: string) => {
    switch (tier) {
      case 'VVIP': return 'bg-purple-500/20 text-purple-400 border-purple-500/50';
      case 'VIP': return 'bg-primary/20 text-primary border-primary/50';
      default: return 'bg-secondary text-secondary-foreground border-border';
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Button variant="ghost" onClick={() => setLocation("/clients")} className="mb-4">
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Clients
      </Button>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{client.name}</h1>
            <Badge variant="outline" className={getVipBadgeColor(client.vip_tier)}>
              {client.vip_tier}
            </Badge>
            {client.inactive && (
              <Badge variant="destructive">Inactive</Badge>
            )}
          </div>
          <p className="text-muted-foreground text-lg">{client.whatsapp}</p>
        </div>
        <div className="flex gap-2">
          <a href={`https://wa.me/${client.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">
            <Button className="bg-green-900/20 text-green-500 hover:bg-green-900/40 border border-green-900/50">
              <MessageSquare className="w-4 h-4 mr-2" />
              WhatsApp
            </Button>
          </a>
          <Button variant="outline">
            <Edit className="w-4 h-4 mr-2" />
            Edit
          </Button>
          <Button variant="outline" className="text-destructive hover:bg-destructive/10">
            <Ban className="w-4 h-4 mr-2" />
            {client.inactive ? 'Mark Active' : 'Flag Inactive'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-primary/10 bg-card">
          <CardHeader>
            <CardTitle>Client Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground block mb-1">Email</span>
                <span className="font-medium">{client.email || 'N/A'}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Nationality</span>
                <span className="font-medium">{client.nationality || 'N/A'}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Language</span>
                <span className="font-medium">{client.language_preference || 'N/A'}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Total Bookings</span>
                <span className="font-medium">{client.total_bookings || 0}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Total Spent</span>
                <span className="font-medium text-primary">£{(client.total_spent || 0).toLocaleString()}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Added On</span>
                <span className="font-medium">{client.created_at ? format(new Date(client.created_at), 'PPP') : 'N/A'}</span>
              </div>
            </div>
            {client.notes && (
              <div className="pt-4 border-t border-border mt-4">
                <span className="text-muted-foreground block mb-1 text-sm">Notes</span>
                <p className="text-sm">{client.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-primary/10 bg-card">
          <CardHeader>
            <CardTitle>Recent Bookings</CardTitle>
          </CardHeader>
          <CardContent>
            {client.bookings && client.bookings.length > 0 ? (
              <div className="space-y-4">
                {client.bookings.slice(0, 5).map(booking => (
                  <div key={booking.id} className="flex justify-between items-center p-3 rounded-lg border border-border bg-background/50">
                    <div>
                      <div className="font-medium">{booking.tvl_ref}</div>
                      <div className="text-xs text-muted-foreground">{booking.date_time ? format(new Date(booking.date_time), 'PPp') : ''}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">£{booking.price}</div>
                      <Badge variant="outline">{booking.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm border border-dashed rounded-lg">
                No booking history
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
