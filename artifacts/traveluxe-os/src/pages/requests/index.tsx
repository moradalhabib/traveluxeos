import { useMemo, useState } from "react";
import { Link } from "wouter";
import { format, parseISO, differenceInCalendarDays } from "date-fns";
import {
  Plus, ClipboardList, CalendarRange, AlertTriangle, Search,
  Plane, MapPin, Car as CarIcon, Building2, Hotel, Package
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useListRequests, PRIORITY_STYLES, STATUS_STYLES,
  type RequestStatus, type RequestPriority, type RequestServiceType,
  type ClientRequest,
} from "@/lib/requests-api";

const STATUS_TABS: (RequestStatus | "All")[] = [
  "All", "New", "Following Up", "Ready to Book", "Converted", "Declined", "Expired",
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
  const [status, setStatus] = useState<RequestStatus | "">("");
  const [priority, setPriority] = useState<RequestPriority | "">("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"follow_up" | "created">("follow_up");

  const { data: requests, isLoading } = useListRequests({
    status: status || undefined,
    priority: priority || undefined,
    search: search || undefined,
    sort,
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
        <Link href="/requests/new">
          <Button className="w-full sm:w-auto h-12 shadow-[0_0_10px_rgba(201,168,76,0.2)]">
            <Plus className="w-4 h-4 mr-2" />
            New Request
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {STATUS_TABS.map(t => (
            <Button
              key={t}
              size="sm"
              variant={ (t === "All" && status === "") || status === t ? "default" : "outline"}
              onClick={() => setStatus(t === "All" ? "" : (t as RequestStatus))}
              className="whitespace-nowrap"
            >
              {t}
              {counts[t] != null && counts[t] > 0 && (
                <span className="ml-2 text-xs opacity-80">{counts[t]}</span>
              )}
            </Button>
          ))}
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex gap-2 flex-wrap">
            {PRIORITIES.map(p => (
              <Button
                key={p || "any"}
                size="sm"
                variant={priority === p ? "default" : "outline"}
                onClick={() => setPriority(p)}
                className="whitespace-nowrap"
              >
                {p || "Any priority"}
              </Button>
            ))}
          </div>

          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by client or notes…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <select
            value={sort}
            onChange={e => setSort(e.target.value as any)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="follow_up">Sort: Follow-up date</option>
            <option value="created">Sort: Recently created</option>
          </select>
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
          (requests ?? []).map(r => <RequestCard key={r.id} r={r} today={today} />)
        )}
      </div>
    </div>
  );
}

function RequestCard({ r, today }: { r: ClientRequest; today: Date }) {
  const Icon = SERVICE_ICONS[r.service_type] ?? Package;
  const followUp = parseISO(r.follow_up_date);
  const daysUntil = differenceInCalendarDays(followUp, today);
  const isOverdue = daysUntil < 0 && !["Converted","Declined","Expired"].includes(r.status);
  const isToday = daysUntil === 0;

  return (
    <Link href={`/requests/${r.id}`}>
      <Card className={`border-primary/10 hover:border-primary/30 transition-colors bg-card overflow-hidden cursor-pointer ${isOverdue ? "border-red-500/40" : ""}`}>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-base text-foreground truncate">
                  {r.client_name || "Unknown client"}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">{r.service_type}</p>
              </div>
            </div>
            <Badge variant="outline" className={PRIORITY_STYLES[r.priority]}>
              {r.priority}
            </Badge>
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
            {r.estimated_price != null && r.estimated_price > 0 && (
              <span className="text-sm font-semibold text-primary">
                £{Number(r.estimated_price).toLocaleString()}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
