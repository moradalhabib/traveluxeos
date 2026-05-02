import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { supabase } from "@/lib/supabase";
import { useReopenFollowUp } from "@/lib/requests-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  PhoneCall, MessageCircle, CheckCheck, RotateCcw, PhoneOff, Clock,
  ChevronRight, AlertTriangle, X, ArrowLeft, TrendingUp, CalendarRange, Download, CheckSquare, Ban
} from "lucide-react";
import { useBulkSelect } from "@/hooks/use-bulk-select";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { FilterDropdown, useFilterState } from "@/components/ui/filter-dropdown";
import { ActiveFilterChips, type ActiveFilter } from "@/components/ui/active-filter-chips";
import { RecentActivityFeed } from "@/components/activity/RecentActivityFeed";
import { format, formatDistanceToNow } from "date-fns";
import { getVipPillClass } from "@/lib/vip";
import * as XLSX from "xlsx";

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
    case "cancelled":     return "text-rose-400 border-rose-500/30 bg-rose-500/10";
    default:              return "text-muted-foreground border-border";
  }
}

function statusLabel(s: string) {
  switch (s) {
    case "pending":       return "Pending";
    case "done":          return "Done";
    case "booked_return": return "Return Booked";
    case "no_response":   return "No Response";
    case "cancelled":     return "Cancelled";
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

// Cancellation reasons — kept consistent with the request-cancellation
// taxonomy so dashboard reporting can roll up "lost lead reasons" across
// requests and follow-ups in one query.
const CANCEL_REASONS = [
  "Client booked elsewhere",
  "Client changed plans",
  "Trip postponed",
  "Pricing too high",
  "No response after multiple attempts",
  "Service unavailable",
  "Duplicate follow-up",
  "Other",
];

export default function FollowUps() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const bulk = useBulkSelect();
  const reopen = useReopenFollowUp();

  // ── Filters ───────────────────────────────────────────────────────────────
  // URL-backed so a refresh / shared link restores the same view.
  const [statusFilter, setStatusFilter] = useFilterState("status", "pending");
  const [dateFilter, setDateFilter] = useFilterState("date", "all");
  const [search, setSearch] = useFilterState("q", "");
  // Fix 3 — Most Recent (created_at desc) is the default across all list pages.
  const [sort, setSort] = useFilterState("sort", "recent");

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
  // Cancel dialog mirrors the Done dialog — required reason + optional
  // free-text. The PATCH route refuses without a reason so this state is
  // always populated by the time submitCancel fires.
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<any>(null);
  const [cancelReason, setCancelReason] = useState(CANCEL_REASONS[0]);
  const [cancelNotes, setCancelNotes] = useState("");
  // Re-open confirm dialog for cancelled follow-ups. Single per-row prompt
  // — the server appends an audit line to notes referencing the original
  // cancellation reason so history is preserved.
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenTarget, setReopenTarget] = useState<any>(null);

  // The amber "X overdue · Y due today" banner is a read-only summary
  // driven by the API stats payload. Date filtering is done via the
  // dedicated Date FilterDropdown below.
  const filterActive = dateFilter === "today" || dateFilter === "overdue";

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

  // ── Bulk delete fan-out ───────────────────────────────────────────────────
  const handleBulkDelete = async () => {
    const ids = bulk.ids;
    const token = await getToken();
    const results = await Promise.allSettled(
      ids.map(id =>
        fetch(`${API_BASE}/follow-ups/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }).then(async r => {
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed");
        })
      )
    );
    const ok = results.filter(r => r.status === "fulfilled").length;
    const fail = results.length - ok;
    bulk.exitSelectMode();
    fetchData();
    // Refresh stats counters + every other page that derives from follow-ups.
    qc.invalidateQueries();
    if (fail === 0) {
      toast({ title: `Deleted ${ok} follow-up${ok === 1 ? "" : "s"}` });
    } else {
      toast({
        title: `Deleted ${ok}, ${fail} failed`,
        variant: "destructive",
      });
    }
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

  const openCancel = (fu: any) => {
    setCancelTarget(fu);
    setCancelReason(CANCEL_REASONS[0]);
    setCancelNotes("");
    setCancelOpen(true);
  };

  const submitCancel = async () => {
    if (!cancelTarget) return;
    const reason = `${cancelReason}${cancelNotes.trim() ? ` — ${cancelNotes.trim()}` : ""}`;
    // Append to existing notes rather than overwriting — operator notes
    // captured during the chase phase (price quotes, attempted dates,
    // etc.) are valuable context and must never be destroyed by the
    // cancel action. The cancellation_reason column is the source of
    // truth for reporting; the notes-trail is for human context.
    const existing = (cancelTarget.notes ?? "").toString().trim();
    const stamp = new Date().toLocaleString("en-GB", { timeZone: "Europe/London" });
    const appended = `Cancelled (${stamp}): ${reason}`;
    const mergedNotes = existing ? `${existing}\n\n${appended}` : appended;
    await patchFollowUp(cancelTarget.id, {
      status: "cancelled",
      cancellation_reason: reason,
      notes: mergedNotes,
    }, "Follow-up cancelled");
    setCancelOpen(false);
  };

  const openReopen = (fu: any) => {
    setReopenTarget(fu);
    setReopenOpen(true);
  };

  // Re-open uses the dedicated useReopenFollowUp hook so the mutation
  // is shaped the same as useReopenRequest. The hook handles the PATCH
  // + lost-lead-stats invalidation; the page still calls fetchData() to
  // refresh its (non-react-query) list and invalidates the dashboard
  // summary so the bell counters update. Server detects cancelled→pending
  // and appends the audit line server-side.
  const submitReopen = () => {
    if (!reopenTarget) return;
    setBusyId(reopenTarget.id);
    reopen.mutate(reopenTarget.id, {
      onSuccess: () => {
        toast({ title: "Follow-up re-opened" });
        fetchData();
        qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        setReopenOpen(false);
      },
      onError: (e: any) => {
        toast({ title: "Could not re-open", description: e?.message, variant: "destructive" });
      },
      onSettled: () => setBusyId(null),
    });
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

  // ── Excel export ──────────────────────────────────────────────────────────
  // Dumps the *currently filtered* follow-ups to a .xlsx file so operators
  // can review them offline. Includes the booking + client context inline
  // so each row stands alone.
  const handleExport = () => {
    if (followUps.length === 0) {
      toast({ title: "Nothing to export", description: "No follow-ups match the current filters." });
      return;
    }
    const rows = followUps.map((fu: any) => ({
      "Booking Ref":     fu.booking?.tvl_ref ?? "—",
      "Client":          fu.client?.name ?? "—",
      "VIP Tier":        fu.client?.vip_tier ?? "",
      "WhatsApp":        fu.client?.whatsapp ?? "",
      "Service":         fu.booking?.service_type ?? "",
      "Direction":       fu.booking?.direction ?? "",
      "Pickup":          fu.booking?.pickup ?? "",
      "Dropoff":         fu.booking?.dropoff ?? "",
      "Booking Date":    fu.booking?.date_time ? format(new Date(fu.booking.date_time), "yyyy-MM-dd HH:mm") : "",
      "Driver":          fu.driver?.name ?? "",
      "Status":          statusLabel(fu.status),
      "Due Date":        fu.due_date ?? "",
      "No-Response Count": fu.no_response_count ?? 0,
      "Notes":           fu.notes ?? "",
      "Completed At":    fu.completed_at ? format(new Date(fu.completed_at), "yyyy-MM-dd HH:mm") : "",
      "Created At":      fu.created_at ? format(new Date(fu.created_at), "yyyy-MM-dd HH:mm") : "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    // Auto-size columns based on the longest value in each
    const colWidths = Object.keys(rows[0] ?? {}).map((key) => ({
      wch: Math.min(40, Math.max(key.length, ...rows.map((r: any) => String(r[key] ?? "").length))) + 2,
    }));
    (ws as any)["!cols"] = colWidths;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Follow-Ups");
    const stamp = format(new Date(), "yyyy-MM-dd_HHmm");
    const suffix = statusFilter !== "all" ? `_${statusFilter}` : "";
    XLSX.writeFile(wb, `traveluxe_followups${suffix}_${stamp}.xlsx`);
    toast({ title: "Exported", description: `${rows.length} follow-up${rows.length === 1 ? "" : "s"} downloaded.` });
  };

  return (
    <div className="space-y-3 max-w-4xl mx-auto">
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
        <div className="flex items-center gap-2 flex-shrink-0">
          {isAdmin && (
            bulk.selectMode ? (
              <Button
                variant="outline"
                size="sm"
                onClick={bulk.exitSelectMode}
                className="gap-2"
                data-testid="button-bulk-cancel"
              >
                <X className="w-4 h-4" />
                <span className="hidden sm:inline">Cancel</span>
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={bulk.enterSelectMode}
                className="gap-2"
                data-testid="button-bulk-select"
              >
                <CheckSquare className="w-4 h-4" />
                <span className="hidden sm:inline">Select</span>
              </Button>
            )
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={loading || followUps.length === 0}
            className="gap-2"
            data-testid="button-export-followups"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>

      {/* Daily digest summary — informational; use the Date filter below */}
      {stats && stats.pending > 0 && (
        <div
          className={`w-full rounded-xl border px-3.5 py-3 flex items-center justify-between gap-3 ${
            filterActive
              ? "border-amber-500/60 bg-amber-500/15"
              : "border-amber-500/30 bg-amber-500/10"
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span className="text-sm text-amber-300 font-medium">
              {stats.overdue > 0 ? `${stats.overdue} overdue` : ""}{stats.overdue > 0 && todayPending > 0 ? " · " : ""}
              {todayPending > 0 ? `${todayPending} due today` : ""}
              {stats.overdue === 0 && todayPending === 0 ? `${stats.pending} pending follow-up${stats.pending !== 1 ? "s" : ""}` : ""}
            </span>
          </div>
          <span className="text-[11px] font-normal text-amber-300/70 hidden sm:inline">
            {filterActive ? "Filtered" : "Use the Date filter below"}
          </span>
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
        <div className="flex flex-wrap items-center gap-2">
          <FilterDropdown
            label="Status:"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "pending",       label: "Pending" },
              { value: "all",           label: "All" },
              { value: "done",          label: "Done" },
              { value: "booked_return", label: "Return Booked" },
              { value: "no_response",   label: "No Response" },
              { value: "cancelled",     label: "Cancelled" },
            ]}
            widthClass="w-40"
            testId="filter-followups-status"
          />
          <FilterDropdown
            label="Date:"
            value={dateFilter}
            onChange={setDateFilter}
            options={[
              { value: "all",       label: "All dates" },
              { value: "today",     label: "Today" },
              { value: "overdue",   label: "Overdue" },
              { value: "this_week", label: "This week" },
            ]}
            widthClass="w-36"
            testId="filter-followups-date"
          />
          <FilterDropdown
            label="Sort:"
            value={sort}
            onChange={setSort}
            options={[
              { value: "recent",       label: "Most Recent" },
              { value: "due_date",     label: "Due date" },
              { value: "client_name",  label: "Client" },
              { value: "arrival_date", label: "Arrival" },
            ]}
            widthClass="w-40"
            testId="filter-followups-sort"
          />
        </div>

        {(() => {
          const STATUS_LABELS: Record<string, string> = { pending: "Pending", all: "All", done: "Done", booked_return: "Return Booked", no_response: "No Response", cancelled: "Cancelled" };
          const DATE_LABELS: Record<string, string> = { all: "All dates", today: "Today", overdue: "Overdue", this_week: "This week" };
          const chips: ActiveFilter[] = [];
          if (statusFilter !== "pending") chips.push({ key: "status", label: "Status", value: STATUS_LABELS[statusFilter] ?? statusFilter, onClear: () => setStatusFilter("pending") });
          if (dateFilter !== "all") chips.push({ key: "date", label: "Date", value: DATE_LABELS[dateFilter] ?? dateFilter, onClear: () => setDateFilter("all") });
          return <ActiveFilterChips filters={chips} onClearAll={() => { setStatusFilter("pending"); setDateFilter("all"); }} />;
        })()}

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

            const sel = bulk.isSelected(fu.id);
            return (
              <Card
                key={fu.id}
                className={`relative border-border bg-card ${isOverdue(fu) ? "border-l-4 border-l-destructive" : isDueToday(fu) ? "border-l-4 border-l-amber-500" : ""} ${sel ? "ring-2 ring-primary" : ""} ${bulk.selectMode ? "cursor-pointer" : ""}`}
                data-testid={`followup-card-${fu.id}`}
              >
                {bulk.selectMode && (
                  <>
                    <button
                      type="button"
                      onClick={() => bulk.toggle(fu.id)}
                      className="absolute inset-0 z-20 w-full h-full"
                      aria-label="Toggle selection"
                      data-testid={`select-followup-${fu.id}`}
                    />
                    <div
                      className={`absolute top-2 right-2 z-30 w-6 h-6 rounded-md border-2 flex items-center justify-center pointer-events-none ${
                        sel ? "bg-primary border-primary" : "border-border bg-background"
                      }`}
                    >
                      {sel && <CheckSquare className="w-4 h-4 text-primary-foreground" />}
                    </div>
                  </>
                )}
                <CardContent className="p-3 space-y-2">
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
                          <span className={getVipPillClass(fu.client.vip_tier)}>
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

                      {/* Cancel — explicit lifecycle distinct from "No
                          Response" / "Done". Captures a structured reason
                          so finance can break down lost leads. */}
                      <Button size="sm" variant="outline" disabled={busy}
                        onClick={() => openCancel(fu)}
                        className="h-8 px-2.5 text-[11px] text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
                        data-testid={`button-cancel-followup-${fu.id}`}>
                        <Ban className="w-3 h-3 mr-1" />
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    /* Completed state — show outcome + view booking link.
                       Cancelled rows additionally surface a Re-open
                       affordance so operators can revive a lost lead
                       without going via the database, plus a single-line
                       audit attribution showing who pulled the trigger. */
                    <div className="pt-2 border-t border-border/50 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          {fu.completed_at
                            ? `${statusLabel(fu.status)} · ${format(new Date(fu.completed_at), "dd MMM yyyy")}`
                            : statusLabel(fu.status)}
                        </span>
                        <div className="flex items-center gap-2">
                          {fu.status === "cancelled" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => openReopen(fu)}
                              className="h-7 text-[11px] text-amber-300 border-amber-500/40 hover:bg-amber-500/10"
                              data-testid={`button-reopen-followup-${fu.id}`}
                            >
                              <RotateCcw className="w-3 h-3 mr-1" /> Re-open
                            </Button>
                          )}
                          <Link href={`/bookings/${fu.booking_id}`}>
                            <Button size="sm" variant="outline" className="h-7 text-[11px]">
                              View booking <ChevronRight className="w-3 h-3 ml-1" />
                            </Button>
                          </Link>
                        </div>
                      </div>
                      {/* Cancellation audit line — actor (with email tooltip),
                          timestamp (Europe/London), and the captured reason
                          on a single wrapping line. Mirrors the request
                          banner so two-admin teams can see at a glance who
                          pulled the trigger and why. */}
                      {fu.status === "cancelled" && (fu.cancelled_by_name || fu.cancelled_at || fu.cancellation_reason) && (
                        <p className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-1.5">
                          <span>{fu.cancelled_by_name ? "Cancelled by" : "Cancelled"}</span>
                          {fu.cancelled_by_name && (
                            fu.cancelled_by_email ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                    className="font-medium text-foreground/90 cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2"
                                    data-testid={`text-cancelled-by-${fu.id}`}
                                  >
                                    {fu.cancelled_by_name}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top">{fu.cancelled_by_email}</TooltipContent>
                              </Tooltip>
                            ) : (
                              <span
                                className="font-medium text-foreground/90"
                                data-testid={`text-cancelled-by-${fu.id}`}
                              >
                                {fu.cancelled_by_name}
                              </span>
                            )
                          )}
                          {fu.cancelled_at && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{format(new Date(fu.cancelled_at), "d MMM HH:mm")}</span>
                            </>
                          )}
                          {fu.cancellation_reason && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>Reason: <span className="text-foreground/80">{fu.cancellation_reason}</span></span>
                            </>
                          )}
                        </p>
                      )}
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
          <div className="space-y-3 py-2">
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

      {/* Cancel dialog — required reason + optional notes. Mirrors the
          Done dialog so operators see one consistent pattern. */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel Follow-Up</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">Why is this follow-up being cancelled?</label>
              <div className="grid grid-cols-1 gap-1.5">
                {CANCEL_REASONS.map(r => (
                  <button
                    key={r}
                    onClick={() => setCancelReason(r)}
                    className={`text-left text-sm px-3 py-2 rounded-lg border transition-colors ${cancelReason === r ? "bg-rose-500/10 border-rose-500/50 text-rose-300" : "border-border text-foreground hover:bg-secondary/30"}`}
                    data-testid={`cancel-reason-${r.replace(/\s+/g, "-").toLowerCase()}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">Additional notes (optional)</label>
              <textarea
                value={cancelNotes}
                onChange={e => setCancelNotes(e.target.value)}
                placeholder="Any extra context for the audit log…"
                rows={3}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-rose-500/30 resize-none"
                data-testid="input-cancel-notes"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Keep follow-up</Button>
            <Button onClick={submitCancel} className="bg-rose-500 hover:bg-rose-600 text-white" data-testid="button-confirm-cancel-followup">
              <Ban className="w-4 h-4 mr-1.5" /> Cancel follow-up
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Re-open confirm dialog — single deliberate prompt before flipping
          a cancelled follow-up back to pending. Cancellation history is
          preserved so the lost-lead rollup still reflects the original
          loss. */}
      <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Re-open this follow-up?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2 text-sm text-muted-foreground">
            <p>
              The follow-up will move back to <span className="font-semibold text-foreground">Pending</span> and reappear on the active list.
            </p>
            {reopenTarget?.cancellation_reason && (
              <p>
                Originally cancelled for: <span className="text-foreground">{reopenTarget.cancellation_reason}</span>
              </p>
            )}
            <p>
              The cancellation reason and timestamp stay on record, and an audit line is added to the notes so the history is preserved.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReopenOpen(false)}>Keep cancelled</Button>
            <Button
              onClick={submitReopen}
              disabled={reopen.isPending}
              className="bg-amber-500 hover:bg-amber-600 text-white"
              data-testid="button-confirm-reopen-followup"
            >
              <RotateCcw className="w-4 h-4 mr-1.5" /> Re-open
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RecentActivityFeed entityType="task" title="Recent follow-up activity" />

      <BulkActionBar
        count={bulk.count}
        noun="follow-up"
        onClear={bulk.exitSelectMode}
        onDelete={handleBulkDelete}
      />
    </div>
  );
}
