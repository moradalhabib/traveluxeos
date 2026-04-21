import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  PhoneCall, MessageCircle, CheckCheck, RotateCcw, PhoneOff, Clock,
  ChevronRight, AlertTriangle, X, ArrowLeft, TrendingUp, CalendarRange
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

const API_BASE = `${import.meta.env.VITE_API_URL ?? ""}/api`;

function whatsappLink(num?: string | null, name?: string | null) {
  if (!num) return null;
  const clean = num.replace(/[^0-9]/g, "");
  if (!clean) return null;
  const msg = `Hi ${name ?? "there"} 👋 hope your arrival went smoothly! This is Traveluxe checking in. When you're ready to plan your return transfer to the airport, we're here for you — just say the word 🙏 — Traveluxe London`;
  return `https://wa.me/${clean}?text=${encodeURIComponent(msg)}`;
}

function statusColor(s: string) {
  switch (s) {
    case "pending":       return "text-amber-400 border-amber-500/30 bg-amber-500/10";
    case "done":          return "text-green-400 border-green-500/30 bg-green-500/10";
    case "booked_return": return "text-blue-400 border-blue-500/30 bg-blue-500/10";
    case "no_response":   return "text-muted-foreground border-border bg-secondary/30";
    default:              return "text-muted-foreground border-border";
  }
}

function statusLabel(s: string) {
  switch (s) {
    case "pending":       return "Pending";
    case "done":          return "Done";
    case "booked_return": return "Return Booked";
    case "no_response":   return "No Response";
    default:              return s;
  }
}

const DONE_REASONS = [
  "Already arranged",
  "Extending stay",
  "Using another provider",
  "Client not contactable",
  "Other",
];

export default function FollowUps() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  // ── Filters ───────────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState("pending");
  const [dateFilter, setDateFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("due_date");

  // ── Data ──────────────────────────────────────────────────────────────────
  const [followUps, setFollowUps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [busyId, setBusyId] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);
  const [doneTarget, setDoneTarget] = useState<any>(null);
  const [doneReason, setDoneReason] = useState(DONE_REASONS[0]);
  const [doneNotes, setDoneNotes] = useState("");
  const [snoozeOpen, setSnoozeOpen] = useState<Record<string, boolean>>({});
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    try {
      return localStorage.getItem("tvl_followup_banner_" + new Date().toDateString()) === "1";
    } catch { return false; }
  });

  const dismissBanner = () => {
    setBannerDismissed(true);
    try { localStorage.setItem("tvl_followup_banner_" + new Date().toDateString(), "1"); } catch {}
  };

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      if (dateFilter && dateFilter !== "all") params.set("date", dateFilter);
      if (search) params.set("search", search);
      if (sort) params.set("sort", sort);

      const [fuRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/follow-ups?${params}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/follow-ups/stats`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (fuRes.ok) setFollowUps(await fuRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [statusFilter, dateFilter, search, sort]);

  useEffect(() => {
    const t = setTimeout(fetchData, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchData]);

  // ── Token helper ──────────────────────────────────────────────────────────
  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? "";
  };

  // ── Patch a follow-up ─────────────────────────────────────────────────────
  const patchFollowUp = async (id: string, body: object, successMsg: string) => {
    setBusyId(id);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/follow-ups/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      toast({ title: successMsg });
      fetchData();
      qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    } catch (e: any) {
      toast({ title: "Could not update", description: e.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleNoResponse = (fu: any) => patchFollowUp(fu.id, { status: "no_response" },
    (fu.no_response_count ?? 0) >= 2 ? "Archived after 3 attempts" : "Snoozed 1 day — will resurface tomorrow");

  const handleSnooze = (fu: any, days: number) => {
    setSnoozeOpen(prev => ({ ...prev, [fu.id]: false }));
    const d = new Date();
    d.setDate(d.getDate() + days);
    patchFollowUp(fu.id, { status: "snooze", due_date: d.toISOString().split("T")[0] },
      `Snoozed ${days} day${days > 1 ? "s" : ""}`);
  };

  const openDone = (fu: any) => {
    setDoneTarget(fu);
    setDoneReason(DONE_REASONS[0]);
    setDoneNotes("");
    setDoneOpen(true);
  };

  const submitDone = async () => {
    if (!doneTarget) return;
    await patchFollowUp(doneTarget.id,
      { status: "done", notes: `Reason: ${doneReason}${doneNotes ? `\n${doneNotes}` : ""}` },
      "Follow-up marked done");
    setDoneOpen(false);
  };

  const handleBookReturn = async (fu: any) => {
    setBusyId(fu.id);
    try {
      const token = await getToken();
      const retRes = await fetch(`${API_BASE}/bookings/${fu.booking_id}/return`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: "{}",
      });
      const retJson = await retRes.json();
      if (!retRes.ok) throw new Error(retJson.error || "Failed to create return booking");

      await fetch(`${API_BASE}/follow-ups/${fu.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "booked_return", notes: `Return booking: ${retJson.tvl_ref}` }),
      });

      toast({ title: "Return booked", description: `${retJson.tvl_ref} created — set departure date next.` });
      qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      navigate(`/bookings/${retJson.id}`);
    } catch (e: any) {
      toast({ title: "Could not create return", description: e.message, variant: "destructive" });
      setBusyId(null);
    }
  };

  // ── Due date helper ───────────────────────────────────────────────────────
  const dueLabel = (due: string | null) => {
    if (!due) return { text: "No due date", cls: "text-muted-foreground" };
    const d = new Date(due + "T00:00:00");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
    if (diff < 0) return { text: `Overdue by ${Math.abs(diff)}d`, cls: "text-destructive font-semibold" };
    if (diff === 0) return { text: "Due today", cls: "text-amber-400 font-semibold" };
    if (diff === 1) return { text: "Due tomorrow", cls: "text-amber-300" };
    return { text: `Due ${format(d, "dd MMM")}`, cls: "text-muted-foreground" };
  };

  const isOverdue = (fu: any) => fu.status === "pending" && fu.due_date && new Date(fu.due_date + "T00:00:00") < new Date(new Date().setHours(0, 0, 0, 0));
  const isDueToday = (fu: any) => fu.status === "pending" && fu.due_date === new Date().toISOString().split("T")[0];

  const todayPending = followUps.filter(f => isDueToday(f)).length;
  const overduePending = followUps.filter(f => isOverdue(f)).length;

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <PhoneCall className="w-6 h-6 text-primary" />
            Follow-Ups
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Arrival clients to check in with and convert to return bookings
          </p>
        </div>
      </div>

      {/* Daily digest banner */}
      {!bannerDismissed && stats && stats.pending > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span className="text-sm text-amber-300 font-medium">
              {stats.overdue > 0 ? `${stats.overdue} overdue` : ""}{stats.overdue > 0 && todayPending > 0 ? " · " : ""}
              {todayPending > 0 ? `${todayPending} due today` : ""}
              {stats.overdue === 0 && todayPending === 0 ? `${stats.pending} pending follow-up${stats.pending !== 1 ? "s" : ""}` : ""}
            </span>
          </div>
          <button onClick={dismissBanner} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Stats strip */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border bg-card p-3 text-center">
            <div className={`text-xl font-bold ${stats.pending > 0 ? "text-amber-400" : "text-foreground"}`}>{stats.pending}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Pending</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-3 text-center">
            <div className={`text-xl font-bold ${stats.overdue > 0 ? "text-destructive" : "text-foreground"}`}>{stats.overdue}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Overdue</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-3 text-center">
            <div className="text-xl font-bold text-green-400">{stats.completed_this_week}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Done this week</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-3 text-center">
            <div className="text-xl font-bold text-primary">{stats.conversion_rate}%</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Conversion rate</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="space-y-2.5">
        {/* Status filter */}
        <div className="flex gap-1.5 flex-wrap">
          {[
            { v: "pending",       label: "Pending" },
            { v: "all",           label: "All" },
            { v: "done",          label: "Done" },
            { v: "booked_return", label: "Return Booked" },
            { v: "no_response",   label: "No Response" },
          ].map(({ v, label }) => (
            <Button
              key={v}
              size="sm"
              variant={statusFilter === v ? "default" : "outline"}
              className="h-8 text-xs"
              onClick={() => setStatusFilter(v)}
            >
              {label}
            </Button>
          ))}
        </div>

        {/* Date + sort filters */}
        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="text-[11px] text-muted-foreground">Date:</span>
          {[
            { v: "all",       label: "All" },
            { v: "today",     label: "Today" },
            { v: "overdue",   label: "Overdue" },
            { v: "this_week", label: "This week" },
          ].map(({ v, label }) => (
            <Button
              key={v}
              size="sm"
              variant={dateFilter === v ? "default" : "outline"}
              className="h-7 text-[11px]"
              onClick={() => setDateFilter(v)}
            >
              {label}
            </Button>
          ))}
          <div className="flex gap-1.5 ml-auto items-center">
            <span className="text-[11px] text-muted-foreground">Sort:</span>
            {[
              { v: "due_date",     label: "Due date" },
              { v: "client_name",  label: "Client" },
              { v: "arrival_date", label: "Arrival" },
            ].map(({ v, label }) => (
              <Button
                key={v}
                size="sm"
                variant={sort === v ? "default" : "outline"}
                className="h-7 text-[11px]"
                onClick={() => setSort(v)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>

        {/* Search */}
        <Input
          placeholder="Search by client name or booking ref…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-9 text-sm"
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}
        </div>
      ) : followUps.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center border border-dashed border-border rounded-2xl">
          <CheckCheck className="w-10 h-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-foreground">All clear</p>
          <p className="text-xs text-muted-foreground mt-1">No follow-ups match these filters</p>
        </div>
      ) : (
        <div className="space-y-3">
          {followUps.map(fu => {
            const due = dueLabel(fu.due_date);
            const wa = whatsappLink(fu.client?.whatsapp, fu.client?.name);
            const busy = busyId === fu.id;
            const isPending = fu.status === "pending";

            return (
              <Card
                key={fu.id}
                className={`border-border bg-card ${isOverdue(fu) ? "border-l-4 border-l-destructive" : isDueToday(fu) ? "border-l-4 border-l-amber-500" : ""}`}
              >
                <CardContent className="p-4 space-y-3">
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/bookings/${fu.booking_id}`}>
                          <span className="text-sm font-bold text-primary hover:underline cursor-pointer">
                            {fu.booking?.tvl_ref ?? "—"}
                          </span>
                        </Link>
                        {fu.client?.name && (
                          fu.client?.id ? (
                            <Link href={`/clients/${fu.client.id}`}>
                              <span className="text-sm font-semibold text-primary hover:underline cursor-pointer">{fu.client.name}</span>
                            </Link>
                          ) : (
                            <span className="text-sm font-semibold text-foreground">{fu.client.name}</span>
                          )
                        )}
                        {fu.client?.vip_tier && fu.client.vip_tier !== "Standard" && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/15 text-primary uppercase font-semibold tracking-wider">
                            {fu.client.vip_tier}
                          </span>
                        )}
                        <Badge variant="outline" className={`text-[10px] ${statusColor(fu.status)}`}>
                          {statusLabel(fu.status)}
                        </Badge>
                      </div>

                      {/* Meta row */}
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-[11px] text-muted-foreground">
                        {fu.booking?.date_time && (
                          <span>
                            Arrived {format(new Date(fu.booking.date_time), "dd MMM HH:mm")}
                            {fu.days_since_arrival != null && fu.days_since_arrival > 0
                              ? ` · ${fu.days_since_arrival}d ago`
                              : " · today"}
                          </span>
                        )}
                        {fu.driver?.name && <span>Driver: {fu.driver.name}</span>}
                        {fu.operator_name && <span>Operator: {fu.operator_name}</span>}
                      </div>

                      {(fu.booking?.pickup || fu.booking?.dropoff) && (
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          {fu.booking.pickup} → {fu.booking.dropoff}
                        </div>
                      )}

                      {fu.notes && (
                        <div className="text-[11px] text-muted-foreground/70 mt-1 italic truncate">
                          {fu.notes}
                        </div>
                      )}
                    </div>

                    {/* Due date pill */}
                    <div className="text-right flex-shrink-0 space-y-1">
                      <div className={`text-[11px] ${due.cls}`}>{due.text}</div>
                      {fu.no_response_count > 0 && (
                        <div className="text-[10px] text-muted-foreground/60">
                          {fu.no_response_count} attempt{fu.no_response_count > 1 ? "s" : ""}
                        </div>
                      )}
                      {fu.completed_at && (
                        <div className="text-[10px] text-muted-foreground/60">
                          {formatDistanceToNow(new Date(fu.completed_at), { addSuffix: true })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action row */}
                  {isPending ? (
                    <div className="flex gap-2 pt-2 border-t border-border/50 flex-wrap">
                      {/* WhatsApp */}
                      {wa && (
                        <a href={wa} target="_blank" rel="noreferrer">
                          <Button size="sm" variant="outline" disabled={busy}
                            className="h-8 px-2.5 text-[11px] border-green-600/40 text-green-400 hover:bg-green-500/10">
                            <MessageCircle className="w-3 h-3 mr-1" /> WhatsApp
                          </Button>
                        </a>
                      )}

                      {/* Done */}
                      <Button size="sm" variant="outline" disabled={busy}
                        onClick={() => openDone(fu)}
                        className="h-8 px-2.5 text-[11px] text-green-400 border-green-500/30 hover:bg-green-500/10">
                        <CheckCheck className="w-3 h-3 mr-1" />
                        Done
                      </Button>

                      {/* Booked Return */}
                      <Button size="sm" variant="outline" disabled={busy}
                        onClick={() => handleBookReturn(fu)}
                        className="h-8 px-2.5 text-[11px] text-blue-400 border-blue-500/30 hover:bg-blue-500/10">
                        <RotateCcw className="w-3 h-3 mr-1" />
                        {busy ? "Creating…" : "Book Return"}
                      </Button>

                      {/* No Response */}
                      <Button size="sm" variant="outline" disabled={busy}
                        onClick={() => handleNoResponse(fu)}
                        className="h-8 px-2.5 text-[11px] text-muted-foreground border-border hover:bg-secondary/30">
                        <PhoneOff className="w-3 h-3 mr-1" />
                        No Response
                      </Button>

                      {/* Snooze */}
                      <div className="relative">
                        <Button size="sm" variant="outline" disabled={busy}
                          onClick={() => setSnoozeOpen(prev => ({ ...prev, [fu.id]: !prev[fu.id] }))}
                          className="h-8 px-2.5 text-[11px] text-muted-foreground border-border hover:bg-secondary/30">
                          <Clock className="w-3 h-3 mr-1" /> Snooze
                        </Button>
                        {snoozeOpen[fu.id] && (
                          <div className="absolute bottom-full left-0 mb-1.5 z-20 bg-card border border-border rounded-xl p-2 shadow-xl space-y-1 w-36">
                            {[
                              { label: "1 day", days: 1 },
                              { label: "3 days", days: 3 },
                              { label: "1 week", days: 7 },
                            ].map(({ label, days }) => (
                              <button
                                key={days}
                                onClick={() => handleSnooze(fu, days)}
                                className="w-full text-left px-3 py-1.5 text-xs rounded-lg hover:bg-secondary/50 text-foreground transition-colors"
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* Completed state — show outcome + view booking link */
                    <div className="flex items-center justify-between pt-2 border-t border-border/50 gap-2">
                      <span className="text-[11px] text-muted-foreground">
                        {fu.completed_at
                          ? `${statusLabel(fu.status)} · ${format(new Date(fu.completed_at), "dd MMM yyyy")}`
                          : statusLabel(fu.status)}
                      </span>
                      <Link href={`/bookings/${fu.booking_id}`}>
                        <Button size="sm" variant="outline" className="h-7 text-[11px]">
                          View booking <ChevronRight className="w-3 h-3 ml-1" />
                        </Button>
                      </Link>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Done dialog */}
      <Dialog open={doneOpen} onOpenChange={setDoneOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark Follow-Up Done</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">Outcome</label>
              <div className="grid grid-cols-1 gap-1.5">
                {DONE_REASONS.map(r => (
                  <button
                    key={r}
                    onClick={() => setDoneReason(r)}
                    className={`text-left text-sm px-3 py-2 rounded-lg border transition-colors ${doneReason === r ? "bg-primary/10 border-primary/50 text-primary" : "border-border text-foreground hover:bg-secondary/30"}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">Notes (optional)</label>
              <textarea
                value={doneNotes}
                onChange={e => setDoneNotes(e.target.value)}
                placeholder="Any additional context…"
                rows={3}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDoneOpen(false)}>Cancel</Button>
            <Button onClick={submitDone}>
              <CheckCheck className="w-4 h-4 mr-1.5" /> Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
