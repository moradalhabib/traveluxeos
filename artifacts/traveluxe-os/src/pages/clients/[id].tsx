import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useGetClient, getGetClientQueryKey, useListClients } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { MessageSquare, Edit, ArrowLeft, Ban, Plus, CalendarRange, Trash2, Crown, Sparkles, ShieldCheck, Lock, Star, PhoneCall, CheckCheck, RotateCcw, PhoneOff, ClipboardList, FileText } from "lucide-react";
import { format, differenceInMonths } from "date-fns";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NATIONALITIES, nationalityFlag } from "@/lib/nationalities";

const API_BASE = `${import.meta.env.VITE_API_URL ?? ""}/api`;

// ── Recognition tier (operator-only, never shown to client) ────────────────
type Tier = "Guest" | "Patron" | "Ambassador" | "Maison";

const TIER_CONFIG: Record<Tier, {
  label: string; minBookings: number; minSpend: number;
  color: string; bg: string; icon: typeof Crown;
  perks: string[];
}> = {
  Guest:      { label: "Guest",      minBookings: 0,  minSpend: 0,     color: "text-muted-foreground", bg: "bg-secondary border-border", icon: Star,
                perks: ["Standard service"] },
  Patron:     { label: "Patron",     minBookings: 5,  minSpend: 5000,  color: "text-blue-300",         bg: "bg-blue-500/10 border-blue-500/30", icon: ShieldCheck,
                perks: ["Priority dispatch", "Preferred-driver requests honoured"] },
  Ambassador: { label: "Ambassador", minBookings: 15, minSpend: 15000, color: "text-primary",          bg: "bg-primary/10 border-primary/30", icon: Sparkles,
                perks: ["All Patron perks", "Named dedicated driver", "Champagne in vehicle on request", "Courtesy flight-monitoring call"] },
  Maison:     { label: "Maison",     minBookings: 40, minSpend: 40000, color: "text-purple-300",       bg: "bg-purple-500/10 border-purple-500/30", icon: Crown,
                perks: ["All Ambassador perks", "24/7 concierge line", "Complimentary 4th hour on As-Directed", "Birthday & anniversary acknowledgement"] },
};
const TIER_ORDER: Tier[] = ["Guest", "Patron", "Ambassador", "Maison"];

function computeTier(bookings: number, spent: number): Tier {
  if (bookings >= TIER_CONFIG.Maison.minBookings || spent >= TIER_CONFIG.Maison.minSpend) return "Maison";
  if (bookings >= TIER_CONFIG.Ambassador.minBookings || spent >= TIER_CONFIG.Ambassador.minSpend) return "Ambassador";
  if (bookings >= TIER_CONFIG.Patron.minBookings || spent >= TIER_CONFIG.Patron.minSpend) return "Patron";
  return "Guest";
}

function nextTierProgress(bookings: number, spent: number, current: Tier) {
  const idx = TIER_ORDER.indexOf(current);
  if (idx === TIER_ORDER.length - 1) return null;
  const next = TIER_ORDER[idx + 1];
  const cfg = TIER_CONFIG[next];
  const bookingsNeeded = Math.max(0, cfg.minBookings - bookings);
  const spendNeeded = Math.max(0, cfg.minSpend - spent);
  // pick whichever path is closer
  const bookingsPct = cfg.minBookings > 0 ? Math.min(100, (bookings / cfg.minBookings) * 100) : 0;
  const spendPct = cfg.minSpend > 0 ? Math.min(100, (spent / cfg.minSpend) * 100) : 0;
  const closerPct = Math.max(bookingsPct, spendPct);
  return { next, bookingsNeeded, spendNeeded, pct: closerPct };
}

export default function ClientDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const id = params.id as string;
  const qc = useQueryClient();

  const { data: client, isLoading } = useGetClient(id, {
    query: { enabled: !!id, queryKey: getGetClientQueryKey(id) }
  });

  // Follow-up history state
  const [fuHistory, setFuHistory] = useState<any[]>([]);
  const [fuStats, setFuStats] = useState<{ total: number; return_booked: number } | null>(null);
  // Requests + Invoices for this client
  const [clientRequests, setClientRequests] = useState<any[]>([]);
  const [clientInvoices, setClientInvoices] = useState<any[]>([]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? "";
        const headers = { Authorization: `Bearer ${token}` };

        const [fuRes, reqRes, invRes] = await Promise.all([
          fetch(`${API_BASE}/follow-ups/client/${id}`, { headers }),
          fetch(`${API_BASE}/requests?client_id=${id}`, { headers }),
          fetch(`${API_BASE}/invoices`, { headers }),
        ]);

        if (fuRes.ok) {
          const json = await fuRes.json();
          setFuHistory(json.history ?? []);
          setFuStats(json.stats ?? null);
        }
        if (reqRes.ok) {
          const json = await reqRes.json();
          setClientRequests(Array.isArray(json) ? json : (json.requests ?? []));
        }
        if (invRes.ok) {
          const json = await invRes.json();
          const all = Array.isArray(json) ? json : (json.invoices ?? []);
          // We don't have client_id on invoices directly — match via booking_id later
          setClientInvoices(all);
        }
      } catch { /* ignore */ }
    })();
  }, [id]);

  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState("");
  const [editWhatsapp, setEditWhatsapp] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editNationality, setEditNationality] = useState("");
  const [editLanguage, setEditLanguage] = useState("");
  const [editVip, setEditVip] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editFavVehicle, setEditFavVehicle] = useState("");
  const [editServicePrefs, setEditServicePrefs] = useState("");
  const [editDietary, setEditDietary] = useState("");
  const [editPickups, setEditPickups] = useState("");

  // Delete dialog state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const openEdit = () => {
    if (!client) return;
    setEditName(client.name || "");
    setEditWhatsapp((client as any).whatsapp || "");
    setEditEmail((client as any).email || "");
    setEditNationality((client as any).nationality || "");
    setEditLanguage((client as any).language_preference || "");
    setEditVip((client as any).vip_tier || "Standard");
    setEditNotes((client as any).notes || "");
    setEditFavVehicle((client as any).favourite_vehicle_type || "");
    setEditServicePrefs((client as any).service_preferences || "");
    setEditDietary((client as any).dietary_notes || "");
    setEditPickups((client as any).usual_pickup_locations || "");
    setEditOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token;
      const res = await fetch(`/api/clients/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          name: editName,
          whatsapp: editWhatsapp,
          email: editEmail || undefined,
          nationality: editNationality || undefined,
          language_preference: editLanguage || undefined,
          vip_tier: editVip || "Standard",
          notes: editNotes || undefined,
          favourite_vehicle_type: editFavVehicle || null,
          service_preferences: editServicePrefs || null,
          dietary_notes: editDietary || null,
          usual_pickup_locations: editPickups || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      await qc.invalidateQueries({ queryKey: getGetClientQueryKey(id) });
      setEditOpen(false);
    } catch (e: any) {
      alert("Failed to save: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token;
      const res = await fetch(`/api/clients/${id}`, {
        method: "DELETE",
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      if (!res.ok) {
        const err = await res.json();
        setDeleteError(err.error || "Delete failed");
        return;
      }
      await qc.invalidateQueries({ queryKey: ["/api/clients"] });
      setLocation("/clients");
    } catch (e: any) {
      setDeleteError(e.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleInactive = async () => {
    if (!client) return;
    const { data: { session } } = await supabase.auth.getSession();
    const authToken = session?.access_token;
    const res = await fetch(`/api/clients/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ inactive: !(client as any).inactive }),
    });
    if (res.ok) {
      await qc.invalidateQueries({ queryKey: getGetClientQueryKey(id) });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[300px] w-full" />
      </div>
    );
  }

  if (!client) return <div>Client not found</div>;

  const getVipBadgeColor = (tier: string) => {
    switch (tier) {
      case 'Platinum': return 'bg-gradient-to-r from-amber-500/30 to-yellow-300/30 text-amber-200 border-amber-400/70 shadow-[0_0_8px_rgba(251,191,36,0.35)]';
      case 'VVIP': return 'bg-purple-500/20 text-purple-400 border-purple-500/50';
      case 'VIP': return 'bg-primary/20 text-primary border-primary/50';
      default: return 'bg-secondary text-secondary-foreground border-border';
    }
  };

  const waNumber = (client as any).whatsapp?.replace(/\D/g, '') || '';

  // ── Recognition tier (operator-only) ──────────────────────────────────
  const totalBookings = (client as any).total_bookings ?? 0;
  const totalSpent = (client as any).total_spent ?? 0;
  const tier: Tier = computeTier(totalBookings, totalSpent);
  const tierCfg = TIER_CONFIG[tier];
  const TierIcon = tierCfg.icon;
  const progress = nextTierProgress(totalBookings, totalSpent, tier);
  const clientSince = (client as any).created_at ? new Date((client as any).created_at) : null;
  const monthsActive = clientSince ? Math.max(0, differenceInMonths(new Date(), clientSince)) : 0;

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <Button variant="ghost" onClick={() => setLocation("/clients")} className="mb-2 -ml-2">
        <ArrowLeft className="w-4 h-4 mr-2" /> Back
      </Button>

      {/* Client header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{client.name}</h1>
          <Badge variant="outline" className={getVipBadgeColor((client as any).vip_tier)}>
            {(client as any).vip_tier}
          </Badge>
          {(client as any).inactive && <Badge variant="destructive">Inactive</Badge>}
        </div>
        <p className="text-muted-foreground">{(client as any).whatsapp}</p>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-3">
        <a href={`https://wa.me/${waNumber}`} target="_blank" rel="noopener noreferrer">
          <Button className="w-full bg-green-900/20 text-green-500 hover:bg-green-900/40 border border-green-900/50">
            <MessageSquare className="w-4 h-4 mr-2" />
            WhatsApp
          </Button>
        </a>
        <Button variant="outline" onClick={openEdit}>
          <Edit className="w-4 h-4 mr-2" />
          Edit Client
        </Button>
        <Button
          variant="outline"
          className="border-primary/30 text-primary hover:bg-primary/10"
          onClick={() => setLocation(`/bookings/new?client_id=${client.id}`)}
        >
          <Plus className="w-4 h-4 mr-2" />
          New Booking
        </Button>
        <Button
          variant="outline"
          className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
          onClick={() => setLocation(`/requests/new?client_id=${client.id}`)}
        >
          <ClipboardList className="w-4 h-4 mr-2" />
          Create Request
        </Button>
        <Button
          variant="outline"
          className="col-span-2 border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
          onClick={() => setLocation(`/follow-ups?new=1&client_id=${client.id}`)}
        >
          <PhoneCall className="w-4 h-4 mr-2" />
          Log Follow-up
        </Button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <div className="text-2xl font-bold text-foreground">{totalBookings}</div>
          <div className="text-xs text-muted-foreground mt-1">Bookings</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <div className="text-2xl font-bold text-primary">£{totalSpent.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground mt-1">Total Spent</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <div className="text-sm font-bold text-foreground">
            {clientSince ? `${monthsActive}mo` : '—'}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {clientSince ? `Since ${format(clientSince, 'MMM yyyy')}` : 'Client Since'}
          </div>
        </div>
      </div>

      {/* Lifetime stats — first booking, most recent, and average spend.
          Computed from the bookings array already included with the client. */}
      {(() => {
        const bks = ((client as any).bookings ?? []).filter((b: any) => b.date_time);
        if (bks.length === 0) return null;
        const sorted = [...bks].sort(
          (a: any, b: any) => new Date(a.date_time).getTime() - new Date(b.date_time).getTime(),
        );
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const totalPaid = bks.reduce((s: number, b: any) => s + (Number(b.price) || 0), 0);
        const avg = totalPaid / bks.length;
        return (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-border bg-card p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">First booking</div>
              <div className="text-sm font-semibold text-foreground">{format(new Date(first.date_time), "d MMM yy")}</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">Most recent</div>
              <div className="text-sm font-semibold text-foreground">{format(new Date(last.date_time), "d MMM yy")}</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">Avg spend</div>
              <div className="text-sm font-semibold text-primary">£{Math.round(avg).toLocaleString()}</div>
            </div>
          </div>
        );
      })()}

      {/* ── RECOGNITION TIER (Operator-only) ─────────────────────────── */}
      <Card className={`${tierCfg.bg} border`}>
        <CardContent className="p-4 space-y-3">
          {/* Operator-only banner */}
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/80 font-semibold">
            <Lock className="w-3 h-3" />
            Internal · Operator-only · Do not share with client
          </div>

          {/* Tier header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-2xl ${tierCfg.bg} border flex items-center justify-center`}>
                <TierIcon className={`w-6 h-6 ${tierCfg.color}`} />
              </div>
              <div>
                <div className={`text-lg font-bold ${tierCfg.color}`}>{tierCfg.label}</div>
                <div className="text-xs text-muted-foreground">
                  Recognition tier · auto-calculated
                </div>
              </div>
            </div>
          </div>

          {/* Progress to next */}
          {progress && (
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Progress to <span className={TIER_CONFIG[progress.next].color}>{progress.next}</span></span>
                <span className="font-medium text-foreground">
                  {progress.bookingsNeeded > 0 && progress.spendNeeded > 0
                    ? `${progress.bookingsNeeded} more bookings or £${progress.spendNeeded.toLocaleString()}`
                    : "Threshold met — promotes on next booking"}
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full ${tierCfg.color.replace('text-', 'bg-')}`}
                  style={{ width: `${progress.pct}%` }}
                />
              </div>
            </div>
          )}

          {/* Operator perks to offer */}
          <div className="pt-2 border-t border-border/50">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">
              Perks you can offer this client
            </div>
            <ul className="space-y-1">
              {tierCfg.perks.map((p, i) => (
                <li key={i} className="text-xs text-foreground flex items-start gap-1.5">
                  <span className={`mt-0.5 ${tierCfg.color}`}>·</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Service preferences (operator notes) */}
          {((client as any).service_preferences || (client as any).dietary_notes || (client as any).favourite_vehicle_type || (client as any).usual_pickup_locations) && (
            <div className="pt-2 border-t border-border/50 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Personal touches
              </div>
              {(client as any).favourite_vehicle_type && (
                <div className="text-xs"><span className="text-muted-foreground">Vehicle preference: </span><span className="text-foreground font-medium">{(client as any).favourite_vehicle_type}</span></div>
              )}
              {(client as any).service_preferences && (
                <div className="text-xs"><span className="text-muted-foreground">Service notes: </span><span className="text-foreground">{(client as any).service_preferences}</span></div>
              )}
              {(client as any).dietary_notes && (
                <div className="text-xs"><span className="text-muted-foreground">Dietary / refreshments: </span><span className="text-foreground">{(client as any).dietary_notes}</span></div>
              )}
              {(client as any).usual_pickup_locations && (
                <div className="text-xs"><span className="text-muted-foreground">Usual pickups: </span><span className="text-foreground">{(client as any).usual_pickup_locations}</span></div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Client info */}
      <Card className="border-primary/10 bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Client Details</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div>
              <span className="text-muted-foreground block mb-1 text-xs">Email</span>
              <span className="font-medium">{(client as any).email || 'N/A'}</span>
            </div>
            <div>
              <span className="text-muted-foreground block mb-1 text-xs">Nationality</span>
              <span className="font-medium">
                {(client as any).nationality
                  ? <><span className="mr-1.5">{nationalityFlag((client as any).nationality)}</span>{(client as any).nationality}</>
                  : 'N/A'}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block mb-1 text-xs">Client Since</span>
              <span className="font-medium">{(client as any).created_at ? format(new Date((client as any).created_at), 'PPP') : 'N/A'}</span>
            </div>
            <div>
              <span className="text-muted-foreground block mb-1 text-xs">Status</span>
              <span className={`font-medium ${(client as any).inactive ? 'text-destructive' : 'text-green-400'}`}>
                {(client as any).inactive ? 'Inactive' : 'Active'}
              </span>
            </div>
          </div>
          {(client as any).notes && (
            <div className="pt-4 border-t border-border mt-4">
              <span className="text-muted-foreground block mb-1 text-xs">Notes</span>
              <p className="text-sm">{(client as any).notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Full Booking History */}
      <Card className="border-primary/10 bg-card">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Booking History</CardTitle>
            {(client as any).bookings && (client as any).bookings.length > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {(client as any).bookings.length} total booking{(client as any).bookings.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <Link href={`/bookings/new?client_id=${client.id}`}>
            <Button size="sm" variant="outline" className="text-xs h-8">
              <Plus className="w-3 h-3 mr-1" /> New
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="pt-0">
          {(client as any).bookings && (client as any).bookings.length > 0 ? (
            <div className="space-y-2">
              {[...(client as any).bookings]
                .sort((a: any, b: any) => {
                  if (!a.date_time) return 1;
                  if (!b.date_time) return -1;
                  return new Date(b.date_time).getTime() - new Date(a.date_time).getTime();
                })
                .map((booking: any) => (
                  <div
                    key={booking.id}
                    className="flex items-center gap-3 p-3 rounded-xl border border-border bg-background/50 hover:border-primary/30 transition-colors"
                  >
                    <Link href={`/bookings/${booking.id}`} className="flex-1 min-w-0 cursor-pointer">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{booking.tvl_ref}</span>
                        {booking.service_type && (
                          <Badge variant="outline" className="text-[10px] shrink-0">{booking.service_type}</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {booking.date_time ? format(new Date(booking.date_time), 'dd MMM yyyy · HH:mm') : 'No date'}
                        {booking.vehicle_type ? ` · ${booking.vehicle_type}` : ''}
                      </div>
                    </Link>
                    <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                      <div className="font-semibold text-sm text-primary">£{(booking.price || 0).toLocaleString()}</div>
                      {booking.commission != null && Number(booking.commission) > 0 && (
                        <div className="text-[10px] text-muted-foreground">comm £{Number(booking.commission).toLocaleString()}</div>
                      )}
                      <Badge variant="outline" className={`text-[10px] ${
                        booking.status === 'Completed' ? 'text-green-400 border-green-400/30' :
                        booking.status === 'Cancelled' ? 'text-destructive border-destructive/30' :
                        'text-primary border-primary/30'
                      }`}>
                        {booking.status}
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[10px] border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 mt-1"
                        onClick={() => setLocation(`/bookings/new?clone_of=${booking.id}`)}
                        data-testid={`button-rebook-${booking.id}`}
                      >
                        <CalendarRange className="w-2.5 h-2.5 mr-1" /> Rebook
                      </Button>
                    </div>
                  </div>
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

      {/* Client Requests */}
      <Card className="border-primary/10 bg-card">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-amber-400" />
              Requests
            </CardTitle>
            {clientRequests.length > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {clientRequests.length} total · {clientRequests.filter(r => r.status === "Open" || r.status === "Pending").length} open
              </p>
            )}
          </div>
          <Link href={`/requests/new?client_id=${client.id}`}>
            <Button size="sm" variant="outline" className="text-xs h-8">
              <Plus className="w-3 h-3 mr-1" /> New Request
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="pt-0">
          {clientRequests.length > 0 ? (
            <div className="space-y-2">
              {clientRequests.slice(0, 8).map((req: any) => (
                <Link key={req.id} href={`/requests/${req.id}`}>
                  <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-background/50 hover:border-amber-500/40 transition-colors cursor-pointer">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm truncate">{req.summary || req.service_type || "Request"}</span>
                        {req.priority && (
                          <Badge variant="outline" className={`text-[10px] shrink-0 ${
                            req.priority === "High" ? "text-destructive border-destructive/30" :
                            req.priority === "Medium" ? "text-amber-400 border-amber-500/30" :
                            "text-muted-foreground border-border"
                          }`}>{req.priority}</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {req.created_at ? format(new Date(req.created_at), "dd MMM yyyy") : ""}
                        {req.service_type && req.summary ? ` · ${req.service_type}` : ""}
                      </div>
                    </div>
                    <Badge variant="outline" className={`text-[10px] flex-shrink-0 ${
                      req.status === "Converted" || req.status === "Booked" ? "text-green-400 border-green-400/30" :
                      req.status === "Lost" || req.status === "Cancelled" ? "text-destructive border-destructive/30" :
                      "text-amber-400 border-amber-500/30"
                    }`}>
                      {req.status || "Open"}
                    </Badge>
                  </div>
                </Link>
              ))}
              {clientRequests.length > 8 && (
                <Link href={`/requests?client_id=${client.id}`}>
                  <Button variant="ghost" size="sm" className="w-full text-xs">
                    View all {clientRequests.length} requests →
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center py-6 text-center">
              <ClipboardList className="w-8 h-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No requests for this client yet</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Client Invoices (matched via the client's bookings) */}
      {(() => {
        const bookingIds = new Set(((client as any).bookings ?? []).map((b: any) => b.id));
        const myInvoices = clientInvoices.filter((inv: any) => bookingIds.has(inv.booking_id));
        const bookingsById = new Map(((client as any).bookings ?? []).map((b: any) => [b.id, b]));
        return (
          <Card className="border-primary/10 bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                Invoices
              </CardTitle>
              {myInvoices.length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {myInvoices.length} invoice{myInvoices.length !== 1 ? "s" : ""}
                </p>
              )}
            </CardHeader>
            <CardContent className="pt-0">
              {myInvoices.length > 0 ? (
                <div className="space-y-2">
                  {myInvoices.slice(0, 10).map((inv: any) => {
                    const bk: any = bookingsById.get(inv.booking_id);
                    return (
                      <Link key={inv.id} href={`/invoices/${inv.id}`}>
                        <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-background/50 hover:border-primary/30 transition-colors cursor-pointer">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm">{inv.invoice_number || `INV-${(inv.id || "").slice(0, 6)}`}</span>
                              {bk?.tvl_ref && (
                                <Badge variant="outline" className="text-[10px] shrink-0 font-mono">{bk.tvl_ref}</Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {inv.created_at ? format(new Date(inv.created_at), "dd MMM yyyy") : ""}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="font-semibold text-sm text-primary">£{(bk?.price ?? 0).toLocaleString()}</div>
                            <Badge variant="outline" className={`text-[10px] mt-0.5 ${
                              inv.status === "Paid" ? "text-green-400 border-green-400/30" :
                              inv.status === "Sent" ? "text-blue-400 border-blue-400/30" :
                              "text-amber-400 border-amber-500/30"
                            }`}>
                              {inv.status || "Generated"}
                            </Badge>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center py-6 text-center">
                  <FileText className="w-8 h-8 text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground">No invoices yet — generated from a booking detail page.</p>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* Follow-Up History */}
      {(fuHistory.length > 0 || fuStats) && (
        <Card className="border-primary/10 bg-card">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <PhoneCall className="w-4 h-4 text-primary" />
                  Follow-Up History
                </CardTitle>
                {fuStats && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {fuStats.total} total · {fuStats.return_booked} return{fuStats.return_booked !== 1 ? "s" : ""} booked
                    {fuStats.total > 0 && (
                      <span className="text-primary ml-1">
                        ({Math.round((fuStats.return_booked / fuStats.total) * 100)}% conversion)
                      </span>
                    )}
                  </p>
                )}
              </div>
              <Link href="/follow-ups">
                <Button size="sm" variant="outline" className="text-xs h-8">View all</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {fuHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No follow-ups yet</p>
            ) : (
              <div className="space-y-2">
                {fuHistory.map((fu: any) => {
                  const statusIcons: Record<string, any> = {
                    done: <CheckCheck className="w-3.5 h-3.5 text-green-400" />,
                    booked_return: <RotateCcw className="w-3.5 h-3.5 text-blue-400" />,
                    no_response: <PhoneOff className="w-3.5 h-3.5 text-muted-foreground" />,
                    pending: <PhoneCall className="w-3.5 h-3.5 text-amber-400" />,
                  };
                  const statusColors: Record<string, string> = {
                    done: "text-green-400 border-green-500/30 bg-green-500/10",
                    booked_return: "text-blue-400 border-blue-500/30 bg-blue-500/10",
                    no_response: "text-muted-foreground border-border bg-secondary/30",
                    pending: "text-amber-400 border-amber-500/30 bg-amber-500/10",
                  };
                  return (
                    <div key={fu.id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-background/50">
                      <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                        {statusIcons[fu.status] ?? <PhoneCall className="w-3.5 h-3.5 text-muted-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link href={`/bookings/${fu.booking_id}`}>
                            <span className="text-xs font-semibold text-primary hover:underline cursor-pointer">
                              {fu.booking?.tvl_ref ?? "—"}
                            </span>
                          </Link>
                          <Badge variant="outline" className={`text-[10px] ${statusColors[fu.status] ?? ""}`}>
                            {fu.status === "done" ? "Done" : fu.status === "booked_return" ? "Return Booked" : fu.status === "no_response" ? "No Response" : "Pending"}
                          </Badge>
                        </div>
                        {fu.notes && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{fu.notes}</p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-[11px] text-muted-foreground">
                          {fu.booking?.date_time ? format(new Date(fu.booking.date_time), "dd MMM yy") : "—"}
                        </div>
                        {fu.completed_by_name && (
                          <div className="text-[10px] text-muted-foreground/60">{fu.completed_by_name}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Danger zone */}
      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={handleToggleInactive} className="text-amber-400 hover:bg-amber-400/10 border-amber-500/30">
          <Ban className="w-4 h-4 mr-2" />
          {(client as any).inactive ? 'Mark Active' : 'Flag Inactive'}
        </Button>
        <Button variant="outline" onClick={() => { setDeleteError(""); setDeleteOpen(true); }} className="text-destructive hover:bg-destructive/10 border-destructive/30">
          <Trash2 className="w-4 h-4 mr-2" />
          Delete Profile
        </Button>
      </div>

      {/* ── EDIT CLIENT DIALOG ── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Client</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Full Name *</p>
              <Input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Full name" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">WhatsApp / Mobile *</p>
              <Input value={editWhatsapp} onChange={e => setEditWhatsapp(e.target.value)} placeholder="+44..." />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Email</p>
              <Input value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="email@example.com" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Nationality</p>
                <Select value={editNationality || ""} onValueChange={setEditNationality}>
                  <SelectTrigger><SelectValue placeholder="Select nationality" /></SelectTrigger>
                  <SelectContent>
                    {NATIONALITIES.map((n) => (
                      <SelectItem key={n.value} value={n.value}>
                        <span className="mr-2">{n.flag}</span>{n.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Language</p>
                <Input value={editLanguage} onChange={e => setEditLanguage(e.target.value)} placeholder="e.g. English" />
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">VIP Tier</p>
              <select
                value={editVip}
                onChange={e => setEditVip(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="Standard">Standard</option>
                <option value="VIP">VIP</option>
                <option value="VVIP">VVIP</option>
                <option value="Platinum">Platinum</option>
              </select>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Notes</p>
              <textarea
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                rows={3}
                placeholder="Internal notes..."
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              />
            </div>

            {/* Operator-only personal touches */}
            <div className="pt-3 mt-3 border-t border-border space-y-3">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                <Lock className="w-3 h-3" />
                Personal touches (operator-only)
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Vehicle preference</p>
                <Input value={editFavVehicle} onChange={e => setEditFavVehicle(e.target.value)} placeholder="e.g. Mercedes V-Class, Range Rover" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Service notes</p>
                <textarea
                  value={editServicePrefs}
                  onChange={e => setEditServicePrefs(e.target.value)}
                  rows={2}
                  placeholder="e.g. prefers silent rides, classical music, extra phone charger"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Dietary / refreshments</p>
                <Input value={editDietary} onChange={e => setEditDietary(e.target.value)} placeholder="e.g. Pellegrino sparkling, no nuts" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Usual pickup locations</p>
                <Input value={editPickups} onChange={e => setEditPickups(e.target.value)} placeholder="e.g. Claridge's, Annabel's, Heathrow T5" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !editName || !editWhatsapp}>
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── DELETE CONFIRMATION DIALOG ── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Client Profile</DialogTitle></DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              This will permanently delete <span className="font-semibold text-foreground">{client.name}</span>'s profile.
              This action cannot be undone.
            </p>
            <p className="text-xs text-muted-foreground bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              Clients with active bookings cannot be deleted. Cancel all their bookings first.
            </p>
            {deleteError && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-lg p-3">{deleteError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Yes, Delete Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
