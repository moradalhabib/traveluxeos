import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Megaphone, Snowflake, Flame, Sparkles, Crown, Download,
  Filter, History, FileText, Users, Loader2, AlertCircle,
} from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────
async function authedFetch(path: string, init: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = new Headers(init.headers || {});
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}
function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
function gbp(n: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency", currency: "GBP", maximumFractionDigits: 0,
  }).format(n || 0);
}
function downloadCsv(filename: string, rows: { first_name: string; email: string }[]) {
  const escape = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const csv = [
    "First Name,Email",
    ...rows.map((r) => `${escape(r.first_name)},${escape(r.email)}`),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Types ──────────────────────────────────────────────────────────────────
type SegmentKey = "cold" | "warm" | "active" | "vip";

type Filters = {
  segment?: SegmentKey | null;
  last_booking_more_than_days?: number | null;
  last_booking_within_days?: number | null;
  last_booking_min_days?: number | null;
  last_booking_max_days?: number | null;
  vip_tier?: "Standard" | "VIP" | "VVIP" | "Platinum" | "Any" | null;
  nationality?: string | null;
  service_type?: string | null;
  min_total_spend?: number | null;
};

type PreviewClient = {
  id: string;
  name: string;
  nationality: string | null;
  vip_tier: string | null;
  last_booking_date: string | null;
  total_bookings: number;
  total_spent: number;
};

type Campaign = {
  id: string;
  campaign_name: string;
  description: string;
  client_count: number;
  operator_name: string;
  created_at: string;
};

// ── Main Page ──────────────────────────────────────────────────────────────
export default function MarketingHub() {
  const queryClient = useQueryClient();

  // 1. Segment counts
  const { data: segments, isLoading: segLoading } = useQuery<{
    cold: number; warm: number; active: number; vip: number; total_with_email: number;
  }>({
    queryKey: ["marketing", "segments"],
    queryFn: () => authedFetch("/api/marketing/segments"),
  });

  // 2. Nationality dropdown
  const { data: nationalities = [] } = useQuery<string[]>({
    queryKey: ["marketing", "nationalities"],
    queryFn: () => authedFetch("/api/marketing/nationalities"),
  });

  // 3. Campaign log
  const { data: campaigns = [] } = useQuery<Campaign[]>({
    queryKey: ["marketing", "campaigns"],
    queryFn: () => authedFetch("/api/marketing/campaigns"),
  });

  // ── Active filter state ───────────────────────────────────────────────
  const [filters, setFilters] = useState<Filters>({});
  const [lastBookingMode, setLastBookingMode] = useState<"any" | "more_than" | "within" | "between">("any");
  const [bMore, setBMore] = useState("");
  const [bWithin, setBWithin] = useState("");
  const [bMin, setBMin] = useState("");
  const [bMax, setBMax] = useState("");

  // Build effective filters whenever inputs change
  useEffect(() => {
    const next: Filters = {
      segment: filters.segment ?? null,
      vip_tier: filters.vip_tier ?? null,
      nationality: filters.nationality ?? null,
      service_type: filters.service_type ?? null,
      min_total_spend: filters.min_total_spend ?? null,
      last_booking_more_than_days: null,
      last_booking_within_days: null,
      last_booking_min_days: null,
      last_booking_max_days: null,
    };
    if (lastBookingMode === "more_than" && bMore) {
      next.last_booking_more_than_days = Number(bMore);
    } else if (lastBookingMode === "within" && bWithin) {
      next.last_booking_within_days = Number(bWithin);
    } else if (lastBookingMode === "between" && bMin && bMax) {
      next.last_booking_min_days = Number(bMin);
      next.last_booking_max_days = Number(bMax);
    }
    setFilters(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBookingMode, bMore, bWithin, bMin, bMax]);

  // 4. Live custom-filter count (debounced via queryKey)
  const filterKey = JSON.stringify(filters);
  const { data: previewLive, isFetching: previewFetching } = useQuery<{
    count: number; clients: PreviewClient[];
  }>({
    queryKey: ["marketing", "preview", filterKey],
    queryFn: () =>
      authedFetch("/api/marketing/preview", {
        method: "POST",
        body: JSON.stringify(filters),
      }),
  });

  // 5. Preview list dialog state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSegment, setPreviewSegment] = useState<SegmentKey | null>(null);
  const previewFilters: Filters = useMemo(
    () => (previewSegment ? { segment: previewSegment } : filters),
    [previewSegment, filters]
  );
  const { data: previewData } = useQuery<{ count: number; clients: PreviewClient[] }>({
    queryKey: ["marketing", "preview-dialog", JSON.stringify(previewFilters)],
    queryFn: () =>
      authedFetch("/api/marketing/preview", {
        method: "POST",
        body: JSON.stringify(previewFilters),
      }),
    enabled: previewOpen,
  });

  // 6. Export dialog state
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFilters, setExportFilters] = useState<Filters>({});
  const [exportCount, setExportCount] = useState(0);
  const [campaignName, setCampaignName] = useState("");

  const exportMutation = useMutation({
    mutationFn: async (payload: { campaign_name: string; filters: Filters }) => {
      const body = { ...payload.filters, campaign_name: payload.campaign_name };
      return authedFetch("/api/marketing/export", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: (res: { rows: { first_name: string; email: string }[]; count: number }) => {
      const today = new Date().toISOString().slice(0, 10);
      downloadCsv(`Traveluxe_Campaign_${today}.csv`, res.rows);
      setExportOpen(false);
      setCampaignName("");
      queryClient.invalidateQueries({ queryKey: ["marketing", "campaigns"] });
    },
  });

  function openExport(targetFilters: Filters, count: number) {
    setExportFilters(targetFilters);
    setExportCount(count);
    setCampaignName("");
    setExportOpen(true);
  }

  function openPreview(seg: SegmentKey | null) {
    setPreviewSegment(seg);
    setPreviewOpen(true);
  }

  // ── Segment cards data ────────────────────────────────────────────────
  const segmentCards: Array<{
    key: SegmentKey;
    icon: any;
    color: string;
    title: string;
    subtitle: string;
    desc: string;
    count: number;
  }> = [
    {
      key: "cold",
      icon: Snowflake,
      color: "text-sky-300",
      title: "Cold Clients",
      subtitle: "90+ days since last booking",
      desc: "Haven't heard from them in a while — perfect for a re-engagement campaign",
      count: segments?.cold ?? 0,
    },
    {
      key: "warm",
      icon: Flame,
      color: "text-amber-300",
      title: "Warm Clients",
      subtitle: "Booked 30–90 days ago",
      desc: "Still fresh — keep them engaged with new offers",
      count: segments?.warm ?? 0,
    },
    {
      key: "active",
      icon: Sparkles,
      color: "text-emerald-300",
      title: "Active Clients",
      subtitle: "Booked within last 30 days",
      desc: "Recently active — ideal for upsell or thank you messages",
      count: segments?.active ?? 0,
    },
    {
      key: "vip",
      icon: Crown,
      color: "text-primary",
      title: "VIP & VVIP Clients",
      subtitle: "Premium tier — any time",
      desc: "Your highest value clients — exclusive campaigns only",
      count: segments?.vip ?? 0,
    },
  ];

  return (
    <div className="space-y-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center">
          <Megaphone className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Marketing Hub</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Smart client segmentation. Export Mailchimp-ready lists in seconds.
            {segments && (
              <span className="ml-2 text-primary">
                · {segments.total_with_email} clients with email
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Section 1 — Smart Segments */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
            Smart Segments
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {segmentCards.map((s) => (
            <div
              key={s.key}
              className="bg-card border border-border rounded-xl p-5 hover:border-primary/40 transition-all flex flex-col"
            >
              <div className="flex items-start justify-between mb-3">
                <div className={`w-10 h-10 rounded-lg bg-secondary flex items-center justify-center ${s.color}`}>
                  <s.icon className="w-5 h-5" />
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-foreground">
                    {segLoading ? "—" : s.count}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    clients
                  </div>
                </div>
              </div>
              <h3 className="font-semibold text-foreground">{s.title}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{s.subtitle}</p>
              <p className="text-xs text-muted-foreground mt-3 flex-1">{s.desc}</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-4 w-full border-primary/30 text-primary hover:bg-primary/10"
                onClick={() => openPreview(s.key)}
                disabled={s.count === 0}
              >
                Preview & Export
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* Section 2 — Custom Filter Builder */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
            Custom Filter Builder
          </h2>
        </div>
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Last booking */}
            <div className="space-y-2">
              <Label>Last booking</Label>
              <Select
                value={lastBookingMode}
                onValueChange={(v: any) => setLastBookingMode(v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any time</SelectItem>
                  <SelectItem value="more_than">More than X days ago</SelectItem>
                  <SelectItem value="within">Within last X days</SelectItem>
                  <SelectItem value="between">Between X and Y days ago</SelectItem>
                </SelectContent>
              </Select>
              {lastBookingMode === "more_than" && (
                <Input
                  type="number" min="0" placeholder="e.g. 90"
                  value={bMore} onChange={(e) => setBMore(e.target.value)}
                />
              )}
              {lastBookingMode === "within" && (
                <Input
                  type="number" min="0" placeholder="e.g. 30"
                  value={bWithin} onChange={(e) => setBWithin(e.target.value)}
                />
              )}
              {lastBookingMode === "between" && (
                <div className="flex gap-2">
                  <Input type="number" min="0" placeholder="Min days"
                    value={bMin} onChange={(e) => setBMin(e.target.value)} />
                  <Input type="number" min="0" placeholder="Max days"
                    value={bMax} onChange={(e) => setBMax(e.target.value)} />
                </div>
              )}
            </div>

            {/* VIP Tier */}
            <div className="space-y-2">
              <Label>VIP Tier</Label>
              <Select
                value={filters.vip_tier ?? "Any"}
                onValueChange={(v: any) =>
                  setFilters({ ...filters, vip_tier: v === "Any" ? null : v })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Any">Any</SelectItem>
                  <SelectItem value="Standard">Standard</SelectItem>
                  <SelectItem value="VIP">VIP</SelectItem>
                  <SelectItem value="VVIP">VVIP</SelectItem>
                  <SelectItem value="Platinum">Platinum</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Nationality */}
            <div className="space-y-2">
              <Label>Nationality</Label>
              <Select
                value={filters.nationality ?? "__any__"}
                onValueChange={(v) =>
                  setFilters({ ...filters, nationality: v === "__any__" ? null : v })
                }
              >
                <SelectTrigger><SelectValue placeholder="Any nationality" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Any nationality</SelectItem>
                  {nationalities.map((n) => (
                    <SelectItem key={n} value={n}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Service type last used */}
            <div className="space-y-2">
              <Label>Service type last used</Label>
              <Select
                value={filters.service_type ?? "Any"}
                onValueChange={(v) =>
                  setFilters({ ...filters, service_type: v === "Any" ? null : v })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Any">Any</SelectItem>
                  <SelectItem value="Airport Transfer">Airport Transfer</SelectItem>
                  <SelectItem value="Tour">Tour</SelectItem>
                  <SelectItem value="Car Rental">Car Rental</SelectItem>
                  <SelectItem value="Apartment">Apartment</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Min total spend */}
            <div className="space-y-2">
              <Label>Minimum total spend (£)</Label>
              <Input
                type="number" min="0" placeholder="e.g. 1000"
                value={filters.min_total_spend ?? ""}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    min_total_spend: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </div>

            {/* Email always required */}
            <div className="space-y-2">
              <Label>Has email address</Label>
              <div className="h-10 px-3 flex items-center text-sm text-muted-foreground bg-secondary/30 border border-border rounded-md">
                Yes (always — clients without email excluded)
              </div>
            </div>
          </div>

          {/* Live count + actions */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-3 border-t border-border">
            <div className="flex items-center gap-3">
              {previewFetching ? (
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
              ) : (previewLive?.count ?? 0) === 0 ? (
                <AlertCircle className="w-4 h-4 text-amber-400" />
              ) : (
                <Users className="w-4 h-4 text-primary" />
              )}
              <span className="text-sm text-foreground">
                {previewFetching
                  ? "Calculating..."
                  : (previewLive?.count ?? 0) === 0
                  ? "No clients match these filters — try adjusting your criteria"
                  : `${previewLive?.count ?? 0} clients match this filter`}
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => openPreview(null)}
                disabled={(previewLive?.count ?? 0) === 0}
              >
                Preview List
              </Button>
              <Button
                onClick={() => openExport(filters, previewLive?.count ?? 0)}
                disabled={(previewLive?.count ?? 0) === 0}
              >
                <Download className="w-4 h-4 mr-2" />
                Export to CSV
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Section 4 — Campaign Log */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
            Campaign Log
          </h2>
          <span className="text-xs text-muted-foreground">
            ({campaigns.length} {campaigns.length === 1 ? "export" : "exports"})
          </span>
        </div>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {campaigns.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No campaigns exported yet. Your first export will appear here.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-3">Campaign</th>
                    <th className="text-left px-4 py-3">Filters</th>
                    <th className="text-right px-4 py-3">Clients</th>
                    <th className="text-left px-4 py-3">Exported by</th>
                    <th className="text-left px-4 py-3">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id} className="border-t border-border">
                      <td className="px-4 py-3 font-medium text-foreground">
                        {c.campaign_name}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {c.description}
                      </td>
                      <td className="px-4 py-3 text-right text-foreground tabular-nums">
                        {c.client_count}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{c.operator_name}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDateTime(c.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ── Preview List Dialog ──────────────────────────────────────────── */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Preview {previewSegment ? `· ${previewSegment.toUpperCase()}` : "· Custom filter"}
              <span className="ml-auto text-sm font-normal text-muted-foreground">
                {previewData?.count ?? 0} clients
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-auto flex-1 -mx-6 px-6">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-2 pr-4">Name</th>
                  <th className="text-left py-2 pr-4">Nationality</th>
                  <th className="text-left py-2 pr-4">Tier</th>
                  <th className="text-left py-2 pr-4">Last Booking</th>
                  <th className="text-right py-2 pr-4">Bookings</th>
                  <th className="text-right py-2">Total Spend</th>
                </tr>
              </thead>
              <tbody>
                {(previewData?.clients ?? []).map((c) => (
                  <tr key={c.id} className="border-b border-border/50">
                    <td className="py-2 pr-4 font-medium text-foreground">{c.name}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{c.nationality ?? "—"}</td>
                    <td className="py-2 pr-4">
                      {c.vip_tier && c.vip_tier !== "Standard" ? (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-primary/15 text-primary border border-primary/30">
                          {c.vip_tier}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Standard</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {formatDate(c.last_booking_date)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{c.total_bookings}</td>
                    <td className="py-2 text-right tabular-nums text-foreground">
                      {gbp(c.total_spent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-3 italic">
              Email addresses are hidden from preview for privacy. They are included in the CSV export.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Close</Button>
            <Button
              onClick={() => {
                setPreviewOpen(false);
                openExport(previewFilters, previewData?.count ?? 0);
              }}
              disabled={(previewData?.count ?? 0) === 0}
            >
              <Download className="w-4 h-4 mr-2" />
              Export These to CSV
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Export Confirmation Dialog ───────────────────────────────────── */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="w-5 h-5 text-primary" />
              Confirm Export
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-foreground">
              You are about to export{" "}
              <span className="font-bold text-primary">{exportCount}</span>{" "}
              client {exportCount === 1 ? "email" : "emails"}.
            </p>
            <div className="space-y-2">
              <Label htmlFor="campaign-name">Campaign name (required)</Label>
              <Input
                id="campaign-name"
                placeholder="e.g. Spring 2026 Re-engagement"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                This name links the export to your campaign log so you can track what was sent and when.
              </p>
            </div>
            <div className="bg-secondary/40 border border-border rounded-md p-3 text-xs text-muted-foreground">
              CSV columns: <span className="font-mono text-foreground">First Name</span>,{" "}
              <span className="font-mono text-foreground">Email</span>. Ready for direct
              upload to Mailchimp.
            </div>
            {exportMutation.isError && (
              <div className="text-sm text-destructive">
                Export failed: {(exportMutation.error as Error)?.message}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setExportOpen(false)}>Cancel</Button>
            <Button
              onClick={() =>
                exportMutation.mutate({
                  campaign_name: campaignName.trim(),
                  filters: exportFilters,
                })
              }
              disabled={!campaignName.trim() || exportMutation.isPending || exportCount === 0}
            >
              {exportMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Exporting...</>
              ) : (
                <>Confirm Export</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
