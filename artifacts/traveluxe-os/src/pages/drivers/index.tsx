import { useListDrivers, getListDriversQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, MessageSquare, Car, CheckSquare, X } from "lucide-react";
import { useBulkSelect } from "@/hooks/use-bulk-select";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { FilterDropdown, useFilterState } from "@/components/ui/filter-dropdown";
import { ActiveFilterChips, type ActiveFilter } from "@/components/ui/active-filter-chips";
import { Link } from "wouter";
import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

type StatusFilter = "All" | "Active" | "Inactive" | "Suspended";

const STATUS_FILTERS: StatusFilter[] = ["All", "Active", "Inactive", "Suspended"];

export default function Drivers() {
  // URL-backed filters so a refresh / shared link restores the same view.
  const [search, setSearch] = useFilterState("q", "");
  const [statusFilter, setStatusFilter] = useFilterState<StatusFilter>("status", "All");
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const bulk = useBulkSelect();

  const handleBulkDelete = async () => {
    const ids = bulk.ids;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? "";
    // Single server round-trip — server unlinks bookings, deletes ratings,
    // then deletes all drivers in one batched operation.
    const r = await fetch("/api/drivers/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ids }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      toast({ title: "Delete failed", description: body.error ?? "Unknown error", variant: "destructive" });
      return;
    }
    const { deleted = 0, failed = 0, missing = 0 } = body;
    const missedNote = missing > 0 ? ` (${missing} already gone)` : "";
    queryClient.invalidateQueries();
    bulk.exitSelectMode();
    if (failed === 0) {
      toast({ title: `Deleted ${deleted} driver${deleted === 1 ? "" : "s"}${missedNote}` });
    } else {
      toast({
        title: `Deleted ${deleted}, ${failed} failed${missedNote}`,
        description: body.error ?? "Some drivers could not be deleted.",
        variant: "destructive",
      });
    }
  };
  const { data: drivers, isLoading } = useListDrivers(
    {},
    { query: { enabled: true, queryKey: getListDriversQueryKey({}) } }
  );

  const filtered = useMemo(() => {
    const list = drivers ?? [];
    return list.filter((d: any) => {
      if (statusFilter !== "All" && d.status !== statusFilter) return false;
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        const haystack = [d.name, d.staff_no, d.whatsapp, d.vehicle_model, d.plate]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [drivers, search, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Drivers</h1>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          {isAdmin && (
            bulk.selectMode ? (
              <Button
                variant="outline"
                className="w-full sm:w-auto h-9"
                onClick={bulk.exitSelectMode}
                data-testid="button-bulk-cancel"
              >
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
            ) : (
              <Button
                variant="outline"
                className="w-full sm:w-auto h-9"
                onClick={bulk.enterSelectMode}
                data-testid="button-bulk-select"
              >
                <CheckSquare className="w-4 h-4 mr-2" />
                Select
              </Button>
            )
          )}
          <Link href="/drivers/new">
            <Button className="w-full sm:w-auto h-9 shadow-[0_0_10px_rgba(201,168,76,0.2)]">
              <Plus className="w-4 h-4 mr-2" />
              Add Driver
            </Button>
          </Link>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground" />
        <Input
          placeholder="Search drivers..."
          className="pl-10 h-9 border-primary/20 bg-card"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-search-drivers"
        />
      </div>

      <FilterDropdown
        label="Status:"
        value={statusFilter}
        onChange={(v) => setStatusFilter(v as StatusFilter)}
        options={STATUS_FILTERS.map((s) => ({ value: s, label: s }))}
        testId="filter-drivers-status"
      />

      {(() => {
        const chips: ActiveFilter[] = [];
        if (statusFilter !== "All") chips.push({ key: "status", label: "Status", value: statusFilter, onClear: () => setStatusFilter("All") });
        return <ActiveFilterChips filters={chips} onClearAll={() => setStatusFilter("All")} />;
      })()}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {isLoading ? (
          [...Array(6)].map((_, i) => <Skeleton key={i} className="h-32" />)
        ) : filtered?.map((driver: any) => {
          const sel = bulk.isSelected(driver.id);
          return (
          <Card
            key={driver.id}
            className={`relative border-primary/10 hover:border-primary/30 transition-colors bg-card overflow-hidden flex flex-col ${
              bulk.selectMode ? "cursor-pointer" : ""
            } ${sel ? "ring-2 ring-primary border-primary" : ""}`}
            onClick={bulk.selectMode ? () => bulk.toggle(driver.id) : undefined}
            data-testid={`driver-card-${driver.id}`}
          >
            {bulk.selectMode && (
              <div
                className={`absolute top-2 right-2 z-10 w-6 h-6 rounded-md border-2 flex items-center justify-center ${
                  sel ? "bg-primary border-primary" : "border-border bg-background"
                }`}
              >
                {sel && <CheckSquare className="w-4 h-4 text-primary-foreground" />}
              </div>
            )}
            <CardContent className="p-4 flex-1 flex flex-col">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-base text-foreground">{driver.name}</h3>
                    {driver.staff_no && (
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/30">
                        {driver.staff_no}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                    <Car className="w-3 h-3" />
                    {driver.own_vehicle === false
                      ? "No own vehicle"
                      : [driver.vehicle_year, driver.vehicle_model].filter(Boolean).join(" ") || "Vehicle TBC"}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={
                    driver.status === "Active"
                      ? "bg-green-500/20 text-green-500 border-green-500/50"
                      : driver.status === "Suspended"
                      ? "bg-red-600/20 text-red-500 border-red-600/60"
                      : "bg-secondary text-secondary-foreground"
                  }
                  data-testid={`badge-status-${driver.id}`}
                >
                  {driver.status === "Suspended" ? "⛔ Suspended" : driver.status}
                </Badge>
              </div>

              <div className="mt-auto text-sm text-muted-foreground mb-2">
                <span className="block text-xs uppercase opacity-70">Jobs</span>
                <span className="font-medium text-foreground">
                  {(driver as any).jobs_this_month ?? 0} this month
                </span>
                <span className="text-muted-foreground"> · {driver.total_jobs || 0} total</span>
              </div>

              {!bulk.selectMode && (
                <div className="flex gap-2 mt-auto pt-3 border-t border-border/50">
                  <Link href={`/drivers/${driver.id}`} className="flex-1">
                    <Button variant="outline" className="w-full h-8">View Profile</Button>
                  </Link>
                  {driver.whatsapp && (
                    <a
                      href={`https://wa.me/${driver.whatsapp.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1"
                    >
                      <Button variant="secondary" className="w-full h-8 bg-green-900/20 text-green-500 hover:bg-green-900/40 border border-green-900/50">
                        <MessageSquare className="w-4 h-4 mr-2" />
                        Chat
                      </Button>
                    </a>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          );
        })}
      </div>

      <BulkActionBar
        count={bulk.count}
        noun="driver"
        onClear={bulk.exitSelectMode}
        onDelete={handleBulkDelete}
        warning={`This permanently removes ${bulk.count} driver${bulk.count === 1 ? "" : "s"}. Drivers with active (non-cancelled) bookings will be skipped.`}
      />
    </div>
  );
}
