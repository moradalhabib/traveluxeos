import { useState } from "react";
import { useListClients, getListClientsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, MessageSquare, CheckSquare, Square, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { FilterDropdown } from "@/components/ui/filter-dropdown";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useBulkSelect } from "@/hooks/use-bulk-select";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { supabase } from "@/lib/supabase";

export default function Clients() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isResidenceManager = user?.role === "residence_manager";
  const canBulkDelete = user?.role === "admin" || user?.role === "super_admin";
  const [search, setSearch] = useState("");
  // Operators want to instantly slice the directory by VIP tier so they
  // can find their high-value patrons without scrolling. The chip strip
  // below maps to the existing vip_tier query param the API already
  // supports — no backend changes needed.
  const [tierFilter, setTierFilter] = useState<string>("all");
  const bulk = useBulkSelect();

  const listParams = {
    search: search || undefined,
    vip_tier: tierFilter !== "all" ? tierFilter : undefined,
  };
  const { data: clientsRaw, isLoading } = useListClients(
    listParams,
    { query: { enabled: true, queryKey: getListClientsQueryKey(listParams) } }
  );

  // Fix 3 — default Most Recent first across all list pages.
  const clients = (clientsRaw ?? []).slice().sort((a: any, b: any) => {
    const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  });

  const TIER_FILTERS: { value: string; label: string }[] = [
    { value: "all",      label: "All" },
    { value: "Standard", label: "Standard" },
    { value: "VIP",      label: "VIP" },
    { value: "VVIP",     label: "VVIP" },
    { value: "Platinum", label: "Platinum" },
  ];

  const getVipBadgeColor = (tier: string) => {
    switch (tier) {
      case 'Platinum': return 'bg-gradient-to-r from-amber-500/30 to-yellow-300/30 text-amber-200 border-amber-400/70 shadow-[0_0_8px_rgba(251,191,36,0.35)]';
      case 'VVIP': return 'bg-purple-500/20 text-purple-400 border-purple-500/50';
      case 'VIP': return 'bg-primary/20 text-primary border-primary/50';
      default: return 'bg-secondary text-secondary-foreground border-border';
    }
  };

  // Bulk-delete fan-out — uses the existing single-delete endpoint per id
  // (DELETE /api/clients/:id). One bell notification per row would spam, so
  // we toast a single roll-up here.
  const handleBulkDelete = async () => {
    const ids = bulk.ids;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const results = await Promise.allSettled(
      ids.map(id => fetch(`/api/clients/${id}`, {
        method: "DELETE",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      }).then(r => { if (!r.ok) throw new Error(String(r.status)); }))
    );
    const ok = results.filter(r => r.status === "fulfilled").length;
    const fail = results.length - ok;
    toast({
      title: fail === 0 ? "Clients deleted" : `${ok} deleted, ${fail} failed`,
      description: fail === 0 ? `${ok} client${ok === 1 ? "" : "s"} permanently removed` : "Some deletions failed — check audit log",
      variant: fail === 0 ? undefined : "destructive",
    });
    // Client delete cascades to bookings/invoices/follow-ups on the
    // server, so refresh every query so dashboards/intel stay in sync.
    queryClient.invalidateQueries();
    bulk.exitSelectMode();
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
        <div className="flex gap-2 w-full sm:w-auto">
          {canBulkDelete && (
            bulk.selectMode ? (
              <Button
                variant="outline"
                onClick={bulk.exitSelectMode}
                className="h-12 flex-1 sm:flex-initial"
                data-testid="button-cancel-select"
              >
                <X className="w-4 h-4 mr-2" /> Cancel
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={bulk.enterSelectMode}
                className="h-12 flex-1 sm:flex-initial"
                data-testid="button-select-mode"
              >
                <CheckSquare className="w-4 h-4 mr-2" /> Select
              </Button>
            )
          )}
          {!isResidenceManager && !bulk.selectMode && (
            <Link href="/clients/new" className="flex-1 sm:flex-initial">
              <Button className="w-full h-12 shadow-[0_0_10px_rgba(201,168,76,0.2)]">
                <Plus className="w-4 h-4 mr-2" />
                Add Client
              </Button>
            </Link>
          )}
        </div>
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

      {/* VIP tier filter — compact dropdown matching the rest of the app. */}
      <FilterDropdown
        label="VIP Tier:"
        value={tierFilter}
        onChange={setTierFilter}
        options={TIER_FILTERS.map((t) => ({ value: t.value, label: t.label }))}
        testId="filter-clients-tier"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          [...Array(6)].map((_, i) => <Skeleton key={i} className="h-32" />)
        ) : clients?.map((client) => {
          const selected = bulk.isSelected(client.id);
          const cardInner = (
            <CardContent className="p-5 flex-1 flex flex-col">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-start gap-3 min-w-0">
                  {bulk.selectMode && (
                    <div className={`mt-1 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center ${selected ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
                      {selected && <CheckSquare className="w-3 h-3 text-primary-foreground" />}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h3 className="font-bold text-lg text-foreground truncate">{client.name}</h3>
                    <div className="text-sm text-muted-foreground mt-1">{client.whatsapp}</div>
                  </div>
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

              {!bulk.selectMode && (
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
              )}
            </CardContent>
          );

          if (bulk.selectMode) {
            return (
              <button
                key={client.id}
                type="button"
                onClick={() => bulk.toggle(client.id)}
                className="text-left"
                data-testid={`select-client-${client.id}`}
              >
                <Card className={`border-primary/10 transition-colors bg-card overflow-hidden flex flex-col ${selected ? "ring-2 ring-primary border-primary" : "hover:border-primary/30"}`}>
                  {cardInner}
                </Card>
              </button>
            );
          }

          return (
            <Card key={client.id} className="border-primary/10 hover:border-primary/30 transition-colors bg-card overflow-hidden flex flex-col">
              {cardInner}
            </Card>
          );
        })}
        {clients?.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground border border-dashed rounded-lg">
            No clients found matching your search.
          </div>
        )}
      </div>

      <BulkActionBar
        count={bulk.count}
        noun="client"
        onClear={bulk.clear}
        onDelete={handleBulkDelete}
      />
    </div>
  );
}
