import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { format, parseISO, differenceInCalendarDays } from "date-fns";
import {
  Plus, ClipboardList, CalendarRange, AlertTriangle, Search,
  Plane, MapPin, Car as CarIcon, Building2, Hotel, Package,
  CheckSquare, X as XIcon, MessageCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useBulkSelect } from "@/hooks/use-bulk-select";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FilterDropdown, useFilterState } from "@/components/ui/filter-dropdown";
import { RecentActivityFeed } from "@/components/activity/RecentActivityFeed";
import { ActiveFilterChips, type ActiveFilter } from "@/components/ui/active-filter-chips";
import {
  useListRequests, PRIORITY_STYLES, STATUS_STYLES,
  type RequestStatus, type RequestPriority, type RequestServiceType,
  type ClientRequest,
} from "@/lib/requests-api";
import { getSlaState } from "@/lib/sla";
import { SlaPill, SlaLegend } from "@/components/sla-pill";

const STATUS_TABS: (RequestStatus | "All")[] = [
  "All", "New", "Following Up", "Ready to Book", "Converted", "Declined", "Expired", "Cancelled",
];
const PRIORITIES: (RequestPriority | "")[] = ["", "Urgent", "High", "Medium", "Low"];

const SERVICE_ICONS: Record<RequestServiceType, any> = {
  "Airport Transfer": Plane,
  "Tour": MapPin,
  "Car Rental": CarIcon,
  "Apartment": Building2,
  "Hotel": Hotel,
  "Other": Package,
};

export default function Requests() {
  const { user } = useAuth();
  const canBulkDelete = user?.role === "admin" || user?.role === "super_admin";
  const bulk = useBulkSelect();
  const queryClient = useQueryClient();
  // URL-backed filters so a refresh / shared link restores the same view.
  const [status, setStatus] = useFilterState<RequestStatus | "">("status", "");
  const [priority, setPriority] = useFilterState<RequestPriority | "">("priority", "");
  const [search, setSearch] = useFilterState("q", "");
  // Fix 3 — default Most Recent (created_at desc) across all list pages.
  const [sort, setSort] = useFilterState<"follow_up" | "created">("sort", "created");
  // reason — drills into a specific cancellation_reason bucket from the Lost Leads chart.
  // The sentinel "__none" means IS NULL or blank (shows as "Unspecified").
  const [reason, setReason] = useFilterState("reason", "");

  const handleBulkDelete = async () => {
    const ids = bulk.ids;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const results = await Promise.allSettled(
      ids.map(id => fetch(`/api/requests/${id}`, {
        method: "DELETE",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      }).then(r => { if (!r.ok) throw new Error(String(r.status)); }))
    );
    const ok = results.filter(r => r.status === "fulfilled").length;
    const fail = results.length - ok;
    if (fail === 0) toast.success(`${ok} request${ok === 1 ? "" : "s"} deleted`);
    else toast.error(`${ok} deleted, ${fail} failed`);
    queryClient.invalidateQueries();
    bulk.exitSelectMode();
  };

  const { data: requests, isLoading } = useListRequests({
    status: status || undefined,
    priority: priority || undefined,
    search: search || undefined,
    sort,
    cancellation_reason: reason || undefined,
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: requests?.length ?? 0 };
    (requests ?? []).forEach(r => { c[r.status] = (c[r.status] ?? 0) + 1; });
    return c;
  }, [requests]);

  const today = new Date(); today.setHours(0, 0, 0, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Client Requests</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Future opportunities, follow-ups & conversions
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          {canBulkDelete && (
            bulk.selectMode ? (
              <Button variant="outline" onClick={bulk.exitSelectMode} className="h-12 flex-1 sm:flex-initial" data-testid="button-cancel-select">
                <XIcon className="w-4 h-4 mr-2" /> Cancel
              </Button>
            ) : (
              <Button variant="outline" onClick={bulk.enterSelectMode} className="h-12 flex-1 sm:flex-initial" data-testid="button-select-mode">
                <CheckSquare className="w-4 h-4 mr-2" /> Select
              </Button>
            )
          )}
          {!bulk.selectMode && (
            <Link href="/requests/new" className="flex-1 sm:flex-initial">
              <Button className="w-full h-12 shadow-[0_0_10px_rgba(201,168,76,0.2)]">
                <Plus className="w-4 h-4 mr-2" />
                New Request
              </Button>
            </Link>
          )}
        </div>
      </div>

      <SlaLegend />

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterDropdown
            label="Status:"
            value={status === "" ? "All" : status}
            onChange={(v) => setStatus(v === "All" ? "" : (v as RequestStatus))}
            options={STATUS_TABS.map((t) => ({
              value: t,
              label: t,
              count: counts[t] ?? undefined,
            }))}
            widthClass="w-44"
            testId="filter-requests-status"
          />
          <FilterDropdown
            label="Priority:"
            value={priority === "" ? "any" : priority}
            onChange={(v) => setPriority(v === "any" ? "" : (v as RequestPriority))}
            options={[
              { value: "any", label: "Any priority" },
              ...PRIORITIES.filter((p) => p !== "").map((p) => ({ value: p as string, label: p as string })),
            ]}
            widthClass="w-40"
            testId="filter-requests-priority"
          />
          <FilterDropdown
            label="Sort:"
            value={sort}
            onChange={(v) => setSort(v as any)}
            options={[
              { value: "created", label: "Most Recent" },
              { value: "follow_up", label: "Follow-up date" },
            ]}
            widthClass="w-44"
            testId="filter-requests-sort"
          />
        </div>

        {(() => {
          const chips: ActiveFilter[] = [];
          if (status !== "") chips.push({ key: "status", label: "Status", value: status, onClear: () => setStatus("") });
          if (priority !== "") chips.push({ key: "priority", label: "Priority", value: priority, onClear: () => setPriority("") });
          if (reason !== "") chips.push({ key: "reason", label: "Reason", value: reason === "__none" ? "Unspecified" : reason, onClear: () => setReason("") });
          return <ActiveFilterChips filters={chips} onClearAll={() => { setStatus(""); setPriority(""); setReason(""); }} />;
        })()}

        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by client or notes…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          [...Array(6)].map((_, i) => <Skeleton key={i} className="h-56" />)
        ) : (requests ?? []).length === 0 ? (
          <div className="col-span-full py-16 text-center text-muted-foreground border border-dashed rounded-lg">
            <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No requests yet</p>
            <p className="text-xs mt-1">Capture client interest before it becomes a booking.</p>
          </div>
        ) : (
          (requests ?? []).map(r => (
            <RequestCard
              key={r.id}
              r={r}
              today={today}
              selectMode={bulk.selectMode}
              selected={bulk.isSelected(r.id)}
              onToggle={() => bulk.toggle(r.id)}
            />
          ))
        )}
      </div>

      <RecentActivityFeed entityType="request" title="Recent request activity" />

      <BulkActionBar
        count={bulk.count}
        noun="request"
        onClear={bulk.clear}
        onDelete={handleBulkDelete}
      />
    </div>
  );
}

/**
 * Build a plain wa.me deep-link (no pre-filled message — operators
 * preferred to start the conversation from a clean WhatsApp chat for
 * the requests section). Strips non-digits because wa.me requires a
 * digits-only international format. Returns null when the sanitized
 * number is too short to be valid so callers can hide the action.
 */
function buildWhatsAppLink(r: ClientRequest): string | null {
  const phone = (r.client_whatsapp ?? "").replace(/[^0-9]/g, "");
  if (phone.length < 7) return null;
  return `https://wa.me/${phone}`;
}

/**
 * Format a WhatsApp number for on-card display. Keeps the leading "+" if
 * present in the stored value, otherwise prepends one (numbers in this
 * system are always international). Inserts a space after the country
 * code prefix so long numbers are easier to scan on a small card.
 */
function formatWhatsAppForDisplay(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length < 7) return raw;
  // Best-effort: assume the first 1–3 digits are the country code. We
  // can't know exactly without a libphonenumber dependency, so we just
  // put a space after the first 2 digits for readability — works well
  // for UK (44), Egypt (20), Saudi (966 → still readable as "96 6...").
  return `+${digits.slice(0, 2)} ${digits.slice(2)}`;
}

function RequestCard({ r, today, selectMode, selected, onToggle }: {
  r: ClientRequest; today: Date;
  selectMode: boolean; selected: boolean; onToggle: () => void;
}) {
  const [, setLocation] = useLocation();
  const Icon = SERVICE_ICONS[r.service_type] ?? Package;
  const followUp = parseISO(r.follow_up_date);
  const daysUntil = differenceInCalendarDays(followUp, today);
  const isOverdue = daysUntil < 0 && !["Converted","Declined","Expired"].includes(r.status);
  const isToday = daysUntil === 0;
  // SLA pill — only renders for actionable statuses (New / Following Up).
  // Terminal rows (Cancelled / Converted / Declined / Expired) get null.
  const sla = getSlaState({ createdAt: r.created_at, status: r.status });
  // null when number is missing/too-short — let the JSX fall through to the
  // "Add WhatsApp" hint so operators see why the action is unavailable.
  const whatsAppHref = buildWhatsAppLink(r);

  const inner = (
      <Card className={`border-primary/10 transition-colors bg-card overflow-hidden cursor-pointer ${isOverdue ? "border-red-500/40" : ""} ${
        selectMode
          ? (selected ? "ring-2 ring-primary border-primary" : "hover:border-primary/30")
          : "hover:border-primary/30"
      }`}>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              {selectMode ? (
                <div className={`w-10 h-10 rounded-lg border-2 flex items-center justify-center flex-shrink-0 ${selected ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
                  {selected && <CheckSquare className="w-5 h-5 text-primary-foreground" />}
                </div>
              ) : (
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              )}
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-base text-foreground truncate">
                  {(r as any).client_id ? (
                    <span
                      className="text-primary hover:underline cursor-pointer"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLocation(`/clients/${(r as any).client_id}`); }}
                    >
                      {r.client_name || "Unknown client"}
                    </span>
                  ) : (
                    <>{r.client_name || "Unknown client"}</>
                  )}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">{r.service_type}</p>
                {/*
                  Show the WhatsApp number directly under the client name so
                  operators can read it off the card without drilling in.
                  Tapping the number opens WhatsApp (no pre-filled message —
                  user prefers a clean chat for the requests workflow).
                */}
                {whatsAppHref && (
                  <a
                    href={whatsAppHref}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 mt-1 text-xs font-medium text-emerald-300 hover:text-emerald-200 hover:underline"
                    data-testid={`text-whatsapp-${r.id}`}
                  >
                    <MessageCircle className="w-3 h-3" />
                    {formatWhatsAppForDisplay(r.client_whatsapp)}
                  </a>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
              <Badge variant="outline" className={PRIORITY_STYLES[r.priority]}>
                {r.priority}
              </Badge>
              <SlaPill state={sla} testId={`sla-pill-request-${r.id}`} />
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <CalendarRange className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span className={isOverdue ? "text-red-400 font-medium" : isToday ? "text-amber-300 font-medium" : "text-muted-foreground"}>
              Follow-up: {format(followUp, "EEE, d MMM")}
              {isOverdue && (
                <span className="ml-2 inline-flex items-center text-xs">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  {Math.abs(daysUntil)}d overdue
                </span>
              )}
              {isToday && <span className="ml-2 text-xs">today</span>}
              {daysUntil > 0 && daysUntil <= 7 && (
                <span className="ml-2 text-xs opacity-70">in {daysUntil}d</span>
              )}
            </span>
          </div>

          {r.requested_date_time && (
            <p className="text-xs text-muted-foreground">
              Requested for: {format(parseISO(r.requested_date_time), "PPp")}
            </p>
          )}

          {r.notes && (
            <p className="text-xs text-muted-foreground line-clamp-2">{r.notes}</p>
          )}

          <div className="flex items-center justify-between pt-3 border-t border-border/40">
            <Badge variant="outline" className={STATUS_STYLES[r.status]}>
              {r.status}
            </Badge>
            <div className="flex items-center gap-2">
              {r.estimated_price != null && r.estimated_price > 0 && (
                <span className="text-sm font-semibold text-primary">
                  £{Number(r.estimated_price).toLocaleString()}
                </span>
              )}
              {/*
                The primary WhatsApp action lives next to the client name
                (it's the visible phone number itself). When no number is
                on file, surface a small hint button that jumps to the
                client profile so the operator can capture it. Rendered as
                a real <button> because the surrounding card is wrapped in
                a <Link> anchor and nesting anchors is invalid HTML.
              */}
              {!whatsAppHref && (r as any).client_id && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setLocation(`/clients/${(r as any).client_id}`);
                  }}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-xs font-medium bg-muted/40 text-muted-foreground border border-border/40 hover:bg-muted/60 active:bg-muted/80 transition-colors"
                  aria-label="No WhatsApp on file — open client profile to add one"
                  title="No WhatsApp on file — tap to add it on the client profile"
                  data-testid={`button-add-whatsapp-${r.id}`}
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  Add WhatsApp
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
  );

  if (selectMode) {
    return (
      <div onClick={onToggle} data-testid={`select-request-${r.id}`}>
        {inner}
      </div>
    );
  }
  return <Link href={`/requests/${r.id}`}>{inner}</Link>;
}
