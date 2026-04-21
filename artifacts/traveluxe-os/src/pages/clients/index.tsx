import { useState } from "react";
import { useListClients, getListClientsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, MessageSquare } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";

export default function Clients() {
  const { user } = useAuth();
  const isResidenceManager = user?.role === "residence_manager";
  const [search, setSearch] = useState("");
  const { data: clients, isLoading } = useListClients(
    { search: search || undefined },
    { query: { enabled: true, queryKey: getListClientsQueryKey({ search: search || undefined }) } }
  );

  const getVipBadgeColor = (tier: string) => {
    switch (tier) {
      case 'Platinum': return 'bg-gradient-to-r from-amber-500/30 to-yellow-300/30 text-amber-200 border-amber-400/70 shadow-[0_0_8px_rgba(251,191,36,0.35)]';
      case 'VVIP': return 'bg-purple-500/20 text-purple-400 border-purple-500/50';
      case 'VIP': return 'bg-primary/20 text-primary border-primary/50';
      default: return 'bg-secondary text-secondary-foreground border-border';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Clients</h1>
          {isResidenceManager && (
            <p className="text-sm text-muted-foreground mt-0.5">View client information for apartment bookings</p>
          )}
        </div>
        {!isResidenceManager && (
          <Link href="/clients/new">
            <Button className="w-full sm:w-auto h-12 shadow-[0_0_10px_rgba(201,168,76,0.2)]">
              <Plus className="w-4 h-4 mr-2" />
              Add Client
            </Button>
          </Link>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground" />
        <Input 
          placeholder="Search clients by name, WhatsApp, or email..." 
          className="pl-10 h-12 text-lg border-primary/20 bg-card"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          [...Array(6)].map((_, i) => <Skeleton key={i} className="h-32" />)
        ) : clients?.map((client) => (
          <Card key={client.id} className="border-primary/10 hover:border-primary/30 transition-colors bg-card overflow-hidden flex flex-col">
            <CardContent className="p-5 flex-1 flex flex-col">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-bold text-lg text-foreground">{client.name}</h3>
                  <div className="text-sm text-muted-foreground mt-1">{client.whatsapp}</div>
                </div>
                <Badge variant="outline" className={getVipBadgeColor(client.vip_tier)}>
                  {client.vip_tier}
                </Badge>
              </div>
              
              <div className="mt-auto grid grid-cols-2 gap-2 text-sm text-muted-foreground mb-4">
                <div>
                  <span className="block text-xs uppercase opacity-70">Bookings</span>
                  <span className="font-medium text-foreground">{client.total_bookings || 0}</span>
                </div>
                <div>
                  <span className="block text-xs uppercase opacity-70">Spent</span>
                  <span className="font-medium text-foreground">£{(client.total_spent || 0).toLocaleString()}</span>
                </div>
              </div>
              
              <div className="flex gap-2 mt-auto pt-4 border-t border-border/50">
                <Link href={`/clients/${client.id}`} className="flex-1">
                  <Button variant="outline" className="w-full h-10">View Profile</Button>
                </Link>
                <a 
                  href={`https://wa.me/${client.whatsapp.replace(/\D/g, '')}`}
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex-1"
                >
                  <Button variant="secondary" className="w-full h-10 bg-green-900/20 text-green-500 hover:bg-green-900/40 border border-green-900/50">
                    <MessageSquare className="w-4 h-4 mr-2" />
                    WhatsApp
                  </Button>
                </a>
              </div>
            </CardContent>
          </Card>
        ))}
        {clients?.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground border border-dashed rounded-lg">
            No clients found matching your search.
          </div>
        )}
      </div>
    </div>
  );
}
