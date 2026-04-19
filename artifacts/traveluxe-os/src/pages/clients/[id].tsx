import { useParams, useLocation } from "wouter";
import { useGetClient, getGetClientQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, Edit, ArrowLeft, Ban, Plus, CalendarRange } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";

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

  const waNumber = client.whatsapp.replace(/\D/g, '');

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <Button variant="ghost" onClick={() => setLocation("/clients")} className="mb-2 -ml-2">
        <ArrowLeft className="w-4 h-4 mr-2" /> Back
      </Button>

      {/* Client header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{client.name}</h1>
          <Badge variant="outline" className={getVipBadgeColor(client.vip_tier)}>
            {client.vip_tier}
          </Badge>
          {client.inactive && (
            <Badge variant="destructive">Inactive</Badge>
          )}
        </div>
        <p className="text-muted-foreground">{client.whatsapp}</p>
      </div>

      {/* PRIMARY ACTION — Book This Client */}
      <Link href={`/bookings/new?client_id=${client.id}`}>
        <div className="relative overflow-hidden rounded-2xl bg-primary p-5 cursor-pointer shadow-[0_0_20px_rgba(201,168,76,0.25)] hover:shadow-[0_0_35px_rgba(201,168,76,0.45)] transition-all active:scale-[0.99]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-primary-foreground/80 text-sm font-medium mb-0.5">Ready to go?</p>
              <p className="text-primary-foreground font-bold text-xl">Book {client.name.split(' ')[0]}</p>
            </div>
            <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center">
              <Plus className="w-7 h-7 text-primary-foreground" />
            </div>
          </div>
          <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full bg-white/10" />
        </div>
      </Link>

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-3">
        <a href={`https://wa.me/${waNumber}`} target="_blank" rel="noopener noreferrer" className="col-span-1">
          <Button className="w-full bg-green-900/20 text-green-500 hover:bg-green-900/40 border border-green-900/50">
            <MessageSquare className="w-4 h-4 mr-2" />
            WhatsApp
          </Button>
        </a>
        <Button variant="outline" className="col-span-1">
          <Edit className="w-4 h-4 mr-2" />
          Edit Client
        </Button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <div className="text-2xl font-bold text-foreground">{client.total_bookings || 0}</div>
          <div className="text-xs text-muted-foreground mt-1">Bookings</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <div className="text-2xl font-bold text-primary">£{(client.total_spent || 0).toLocaleString()}</div>
          <div className="text-xs text-muted-foreground mt-1">Total Spent</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <div className="text-sm font-bold text-foreground">{client.language_preference || '—'}</div>
          <div className="text-xs text-muted-foreground mt-1">Language</div>
        </div>
      </div>

      {/* Client info */}
      <Card className="border-primary/10 bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Client Details</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div>
              <span className="text-muted-foreground block mb-1 text-xs">Email</span>
              <span className="font-medium">{client.email || 'N/A'}</span>
            </div>
            <div>
              <span className="text-muted-foreground block mb-1 text-xs">Nationality</span>
              <span className="font-medium">{client.nationality || 'N/A'}</span>
            </div>
            <div>
              <span className="text-muted-foreground block mb-1 text-xs">Client Since</span>
              <span className="font-medium">{client.created_at ? format(new Date(client.created_at), 'PPP') : 'N/A'}</span>
            </div>
            <div>
              <span className="text-muted-foreground block mb-1 text-xs">Status</span>
              <span className={`font-medium ${client.inactive ? 'text-destructive' : 'text-green-400'}`}>
                {client.inactive ? 'Inactive' : 'Active'}
              </span>
            </div>
          </div>
          {client.notes && (
            <div className="pt-4 border-t border-border mt-4">
              <span className="text-muted-foreground block mb-1 text-xs">Notes</span>
              <p className="text-sm">{client.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent bookings */}
      <Card className="border-primary/10 bg-card">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent Bookings</CardTitle>
          <Link href={`/bookings/new?client_id=${client.id}`}>
            <Button size="sm" variant="outline" className="text-xs h-8">
              <Plus className="w-3 h-3 mr-1" /> New
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="pt-0">
          {client.bookings && client.bookings.length > 0 ? (
            <div className="space-y-3">
              {client.bookings.slice(0, 5).map(booking => (
                <Link key={booking.id} href={`/bookings/${booking.id}`}>
                  <div className="flex justify-between items-center p-3 rounded-xl border border-border bg-background/50 hover:border-primary/30 transition-colors cursor-pointer">
                    <div>
                      <div className="font-semibold text-sm">{booking.tvl_ref}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {booking.date_time ? format(new Date(booking.date_time), 'dd MMM yyyy · HH:mm') : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-sm">£{booking.price}</div>
                      <Badge variant="outline" className="text-[10px] mt-0.5">{booking.status}</Badge>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center py-8 text-center">
              <CalendarRange className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No booking history yet</p>
              <Link href={`/bookings/new?client_id=${client.id}`}>
                <Button size="sm" className="mt-4">
                  <Plus className="w-3 h-3 mr-1" /> Create First Booking
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Danger zone */}
      <div className="pt-2">
        <Button variant="outline" className="text-destructive hover:bg-destructive/10 border-destructive/30">
          <Ban className="w-4 h-4 mr-2" />
          {client.inactive ? 'Mark Active' : 'Flag Inactive'}
        </Button>
      </div>
    </div>
  );
}
