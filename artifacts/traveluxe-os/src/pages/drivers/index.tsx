import { useListDrivers, getListDriversQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, MessageSquare, Star, Car, RefreshCw, Loader2, CheckSquare, X } from "lucide-react";
import { useBulkSelect } from "@/hooks/use-bulk-select";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Link } from "wouter";
import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

type StatusFilter = "All" | "Active" | "Inactive" | "Suspended";

const STATUS_FILTERS: StatusFilter[] = ["All", "Active", "Inactive", "Suspended"];

export default function Drivers() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isSuperAdmin = user?.role === "super_admin";
  const isAdmin = user?.role === "admin" || isSuperAdmin;
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const bulk = useBulkSelect();

  const handleBulkDelete = async () => {
    const ids = bulk.ids;
    const base = (import.meta as any).env?.VITE_API_URL ?? "";
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? "";
    const results = await Promise.allSettled(
      ids.map(id =>
        fetch(`${base}/api/drivers/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }).then(async r => {
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed");
        })
      )
    );
    const ok = results.filter(r => r.status === "fulfilled").length;
    const fail = results.length - ok;
    // Driver delete now unlinks bookings (driver_id → null) instead of refusing,
    // so refresh every cached query so dashboards reflect the new driver list.
    queryClient.invalidateQueries();
    bulk.exitSelectMode();
    if (fail === 0) {
      toast({ title: `Deleted ${ok} driver${ok === 1 ? "" : "s"}` });
    } else {
      const firstErr = results.find(r => r.status === "rejected") as PromiseRejectedResult | undefined;
      toast({
        title: `Deleted ${ok}, ${fail} failed`,
        description: firstErr?.reason?.message ?? "Some drivers could not be deleted (likely have active bookings).",
        variant: "destructive",
      });
    }
  };
  const { data: drivers, isLoading } = useListDrivers(
    {},
    { query: { enabled: true, queryKey: getListDriversQueryKey({}) } }
  );

  const handleReset = async () => {
    setResetting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in");
      const base = (import.meta as any).env?.VITE_API_URL ?? "";
      const res = await fetch(`${base}/api/drivers/reset-staff-numbers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(body?.error || "Reset failed");
      toast({
        title: "TVL numbers reset",
        description: `Cleared TVL staff numbers on ${body?.cleared ?? 0} driver(s). Bookings & commissions are untouched.`,
      });
      queryClient.invalidateQueries({ queryKey: getListDriversQueryKey({}) });
      setResetOpen(false);
    } catch (e: any) {
      toast({
        title: "Could not reset TVL numbers",
        description: e?.message ?? "Try again",
        variant: "destructive",
      });
    } finally {
      setResetting(false);
    }
  };

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
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Drivers</h1>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          {isSuperAdmin && (
            <Button
              variant="outline"
              className="w-full sm:w-auto h-12 border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => setResetOpen(true)}
              data-testid="button-reset-tvl-numbers"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Reset TVL Numbers
            </Button>
          )}
          {isAdmin && (
            bulk.selectMode ? (
              <Button
                variant="outline"
                className="w-full sm:w-auto h-12"
                onClick={bulk.exitSelectMode}
                data-testid="button-bulk-cancel"
              >
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
            ) : (
              <Button
                variant="outline"
                className="w-full sm:w-auto h-12"
                onClick={bulk.enterSelectMode}
                data-testid="button-bulk-select"
              >
                <CheckSquare className="w-4 h-4 mr-2" />
                Select
              </Button>
            )
          )}
          <Link href="/drivers/new">
            <Button className="w-full sm:w-auto h-12 shadow-[0_0_10px_rgba(201,168,76,0.2)]">
              <Plus className="w-4 h-4 mr-2" />
              Add Driver
            </Button>
          </Link>
        </div>
      </div>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent data-testid="dialog-reset-tvl">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all TVL Staff Numbers?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                This clears the <strong>TVL Staff Number</strong> on every driver so you can re-assign them
                cleanly (TVL 01, TVL 02, …) from each driver's profile.
              </span>
              <span className="block text-foreground">
                ✅ Bookings, commissions, ratings and job history are <strong>not</strong> affected — they link to drivers by ID, not by TVL number.
              </span>
              <span className="block text-destructive">
                This action is logged in the audit trail. Only Super Admin can do this.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting} data-testid="button-reset-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleReset(); }}
              disabled={resetting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-reset-confirm"
            >
              {resetting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Resetting…</> : "Yes, clear all TVL numbers"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="relative">
        <Search className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground" />
        <Input
          placeholder="Search drivers..."
          className="pl-10 h-12 text-lg border-primary/20 bg-card"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-search-drivers"
        />
      </div>

      <div className="flex flex-wrap gap-2" data-testid="status-filter-chips">
        {STATUS_FILTERS.map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            className={
              statusFilter === s && s === "Suspended"
                ? "bg-red-600 hover:bg-red-700 text-white border-red-700"
                : ""
            }
            onClick={() => setStatusFilter(s)}
            data-testid={`chip-status-${s.toLowerCase()}`}
          >
            {s}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
            <CardContent className="p-5 flex-1 flex flex-col">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-lg text-foreground">{driver.name}</h3>
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

              <div className="mt-auto grid grid-cols-2 gap-2 text-sm text-muted-foreground mb-4">
                <div>
                  <span className="block text-xs uppercase opacity-70">Total Jobs</span>
                  <span className="font-medium text-foreground">{driver.total_jobs || 0}</span>
                </div>
                <div>
                  <span className="block text-xs uppercase opacity-70">Rating</span>
                  <span className="font-medium text-primary flex items-center gap-1">
                    {driver.avg_rating?.toFixed(1) || "0.0"} <Star className="w-3 h-3 fill-primary" />
                  </span>
                </div>
              </div>

              {!bulk.selectMode && (
                <div className="flex gap-2 mt-auto pt-4 border-t border-border/50">
                  <Link href={`/drivers/${driver.id}`} className="flex-1">
                    <Button variant="outline" className="w-full h-10">View Profile</Button>
                  </Link>
                  {driver.whatsapp && (
                    <a
                      href={`https://wa.me/${driver.whatsapp.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1"
                    >
                      <Button variant="secondary" className="w-full h-10 bg-green-900/20 text-green-500 hover:bg-green-900/40 border border-green-900/50">
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
