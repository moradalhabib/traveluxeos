import { useState, useMemo } from "react";
import {
  useListInvoices, getListInvoicesQueryKey,
  useGenerateInvoice, useListBookings, getListBookingsQueryKey,
  useDeleteInvoice,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FilterDropdown, useFilterState } from "@/components/ui/filter-dropdown";
import { ActiveFilterChips, type ActiveFilter } from "@/components/ui/active-filter-chips";
// `Select` is still used by the "Generate invoice" dialog further down the
// page; the inline status filter has been replaced with FilterDropdown so the
// header chrome matches every other list page.
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Link } from "wouter";
import { format, isToday, isTomorrow } from "date-fns";
import { AlertTriangle, FileText, Plus, Receipt, Search, X, Trash2, CheckSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useBulkSelect } from "@/hooks/use-bulk-select";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { supabase } from "@/lib/supabase";

export default function Invoices() {
  const [generateOpen, setGenerateOpen] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState("");
  // URL-backed so a refresh / shared link restores the same view.
  const [searchQuery, setSearchQuery] = useFilterState("q", "");
  const [statusFilter, setStatusFilter] = useFilterState("status", "all");
  const [sourceFilter, setSourceFilter] = useFilterState<"new" | "imported" | "all">("source", "new");
  // When true, show only invoices that are unpaid (Generated/Sent/Overdue)
  // for bookings completed > 48h ago — these are the operator's overdue items.
  // Toggled by tapping the amber banner; cleared by the X button.
  const [overdueFlag, setOverdueFlag] = useFilterState<"0" | "1">("overdue", "0");
  const overdueOnly = overdueFlag === "1";
  const setOverdueOnly = (v: boolean) => setOverdueFlag(v ? "1" : "0");
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canDeleteInvoices = user?.role === "admin" || user?.role === "super_admin";
  const bulk = useBulkSelect();

  const handleBulkDelete = async () => {
    const ids = bulk.ids;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    // ?silent=1 suppresses the per-row staff broadcast; we emit ONE
    // aggregated notification at the end so the bell doesn't show 10
    // duplicate "Invoice Deleted" entries for a single bulk action.
    const results = await Promise.allSettled(
      ids.map(id => fetch(`/api/invoices/${id}?silent=1`, {
        method: "DELETE",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      }).then(r => { if (!r.ok) throw new Error(String(r.status)); }))
    );
    const ok = results.filter(r => r.status === "fulfilled").length;
    const fail = results.length - ok;
    if (ok > 0) {
      fetch("/api/notifications/broadcast-staff", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          type: "booking_cancelled",
          title: "Invoices Deleted",
          message: `${ok} invoice${ok === 1 ? "" : "s"} permanently removed in a bulk action`,
          link: "/invoices",
          severity: "warning",
        }),
      }).catch(() => {});
    }
    toast({
      title: fail === 0 ? "Invoices deleted" : `${ok} deleted, ${fail} failed`,
      description: fail === 0 ? `${ok} invoice${ok === 1 ? "" : "s"} permanently removed` : "Some deletions failed",
      variant: fail === 0 ? undefined : "destructive",
    });
    // Invalidate everything so dashboards/stats/analytics re-derive.
    queryClient.invalidateQueries();
    bulk.exitSelectMode();
  };

  const deleteInvoiceMut = useDeleteInvoice({
    mutation: {
      onSuccess: (data: any) => {
        toast({ title: "Invoice deleted", description: data?.invoice_number ? `${data.invoice_number} permanently removed` : "Removed" });
        queryClient.invalidateQueries({
          predicate: (q) => Array.isArray(q.queryKey) && typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/invoices"),
        });
      },
      onError: (err: any) => {
        toast({ title: "Delete failed", description: err?.response?.data?.error ?? err?.message ?? "Unknown error", variant: "destructive" });
      },
    },
  });

  const { data: invoices, isLoading, refetch } = useListInvoices(
    { query: { enabled: true, queryKey: getListInvoicesQueryKey() } }
  );

  const { data: bookings } = useListBookings(
    {},
    { query: { enabled: true, queryKey: getListBookingsQueryKey({}) } }
  );

  const generate = useGenerateInvoice();

  // Build a lookup: booking_id → booking details
  const bookingMap = useMemo(() => {
    const map: Record<string, any> = {};
    (bookings ?? []).forEach(b => { map[b.id] = b; });
    return map;
  }, [bookings]);

  const handleGenerate = () => {
    if (!selectedBookingId) return;
    generate.mutate(
      { data: { booking_id: selectedBookingId } },
      {
        onSuccess: (inv) => {
          toast({ title: `Invoice ${inv.invoice_number} generated` });
          setGenerateOpen(false);
          setSelectedBookingId("");
          refetch();
        },
        onError: () => {
          toast({ title: "Failed to generate invoice", variant: "destructive" });
        }
      }
    );
  };

  const getStatusColor = (s: string) => {
    switch (s) {
      case "Sent": return "bg-blue-500/20 text-blue-400 border-blue-500/50";
      case "Paid": return "bg-green-500/20 text-green-400 border-green-500/50";
      case "Overdue": return "bg-destructive/20 text-destructive border-destructive/50";
      default: return "bg-amber-500/20 text-amber-400 border-amber-500/50";
    }
  };

  const bookingsWithoutInvoice = (bookings ?? []).filter(b =>
    b.status !== "Cancelled" &&
    !(invoices ?? []).some(inv => inv.booking_id === b.id)
  );

  // Detect Odoo-imported invoices (number contains "/", e.g. INV/2026/00001)
  // vs new app-generated ones (e.g. INV-0003).
  const isImported = (num?: string | null) => !!num && num.includes("/");

  const newCount = (invoices ?? []).filter(inv => !isImported(inv.invoice_number)).length;
  const importedCount = (invoices ?? []).filter(inv => isImported(inv.invoice_number)).length;

  // Predicate: invoice is unpaid AND linked booking was Completed >48h ago.
  // We deliberately compute this on the client from existing list data so no
  // new endpoint or background job is required — and crucially, no email is
  // ever sent. This drives both the banner count and the overdue filter.
  const cutoff48h = useMemo(() => Date.now() - 48 * 60 * 60 * 1000, []);
  const isOverdueUnpaid = (inv: any) => {
    if (!["Generated", "Sent", "Overdue"].includes(inv.status)) return false;
    const bk = bookingMap[inv.booking_id];
    if (!bk || bk.status !== "Completed") return false;
    const completedAt = bk.completed_at ? new Date(bk.completed_at).getTime() : NaN;
    if (!Number.isFinite(completedAt)) return false;
    return completedAt < cutoff48h;
  };

  const overdueUnpaid = useMemo(
    () => (invoices ?? []).filter(isOverdueUnpaid),
    [invoices, bookingMap, cutoff48h]
  );

  // Filter invoices
  const filteredInvoices = useMemo(() => {
    let list = invoices ?? [];
    if (overdueOnly) {
      list = list.filter(isOverdueUnpaid);
    }
    if (sourceFilter === "new") list = list.filter(inv => !isImported(inv.invoice_number));
    else if (sourceFilter === "imported") list = list.filter(inv => isImported(inv.invoice_number));
    if (statusFilter !== "all") {
      list = list.filter(inv => inv.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(inv => {
        const bk = bookingMap[inv.booking_id];
        return (
          inv.invoice_number?.toLowerCase().includes(q) ||
          bk?.tvl_ref?.toLowerCase().includes(q) ||
          bk?.client_name?.toLowerCase().includes(q) ||
          inv.status?.toLowerCase().includes(q)
        );
      });
    }
    // Sort by booking date ascending (soonest upcoming first).
    // Falls back to invoice generated_at when no booking date is available.
    const ts = (v: any) => (v ? new Date(v).getTime() : 0);
    return [...list].sort((a, b) => {
      const bkA = bookingMap[(a as any).booking_id];
      const bkB = bookingMap[(b as any).booking_id];
      const dateA = ts(bkA?.date_time ?? (a as any).generated_at ?? (a as any).created_at);
      const dateB = ts(bkB?.date_time ?? (b as any).generated_at ?? (b as any).created_at);
      return dateA - dateB;
    });
  }, [invoices, searchQuery, statusFilter, sourceFilter, bookingMap, overdueOnly, cutoff48h]);

  const statuses = ["Generated", "Sent", "Paid", "Overdue"];

  // Group invoices by their linked booking's date for date-section headings.
  // Sorted ascending so the oldest unpaid invoices float to the top — perfect
  // for spotting overdue items at a glance. Invoices whose booking has no
  // date_time fall into a "Date TBC" group at the very end.
  const groupedByDate = useMemo(() => {
    const groups = new Map<string, { label: string; sortKey: string; items: typeof filteredInvoices }>();
    const undated: typeof filteredInvoices = [];
    for (const inv of filteredInvoices) {
      const bk = bookingMap[(inv as any).booking_id];
      const dateValue = bk?.date_time ?? (inv as any).generated_at ?? (inv as any).created_at;
      if (!dateValue) { undated.push(inv); continue; }
      const d = new Date(dateValue);
      const sortKey = format(d, "yyyy-MM-dd");
      const label = isToday(d) ? `Today · ${format(d, "EEE d MMMM yyyy")}`
        : isTomorrow(d) ? `Tomorrow · ${format(d, "EEE d MMMM yyyy")}`
        : format(d, "EEEE d MMMM yyyy");
      if (!groups.has(sortKey)) groups.set(sortKey, { label, sortKey, items: [] });
      groups.get(sortKey)!.items.push(inv);
    }
    const sorted = [...groups.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    if (undated.length > 0) sorted.push({ label: "Date TBC", sortKey: "zzz", items: undated });
    return sorted;
  }, [filteredInvoices, bookingMap]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Invoices</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filteredInvoices.length} of {invoices?.length || 0} invoices
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          {canDeleteInvoices && (
            bulk.selectMode ? (
              <Button variant="outline" onClick={bulk.exitSelectMode} className="h-12 flex-1 sm:flex-initial" data-testid="button-cancel-select">
                <X className="w-4 h-4 mr-2" /> Cancel
              </Button>
            ) : (
              <Button variant="outline" onClick={bulk.enterSelectMode} className="h-12 flex-1 sm:flex-initial" data-testid="button-select-mode">
                <CheckSquare className="w-4 h-4 mr-2" /> Select
              </Button>
            )
          )}
          {!bulk.selectMode && (
            <Button
              className="h-12 flex-1 sm:flex-initial shadow-[0_0_10px_rgba(201,168,76,0.2)]"
              onClick={() => setGenerateOpen(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Generate Invoice
            </Button>
          )}
        </div>
      </div>

      {/* Overdue-unpaid in-app reminder. The amber banner is now read-only —
          it always shows the count when there are 48h+ unpaid invoices, and
          the actual filter sits in the dedicated dropdown row to keep all
          filter chrome consistent app-wide. */}
      {overdueUnpaid.length > 0 && (
        <div className="w-full flex items-center justify-between gap-3 rounded-lg border px-4 py-3 border-amber-500/40 bg-amber-500/10">
          <div className="flex items-center gap-3 min-w-0">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-amber-300">
                {overdueUnpaid.length} unpaid invoice{overdueUnpaid.length === 1 ? "" : "s"} overdue (48h+)
              </div>
              <div className="text-xs text-amber-200/70">
                Use the &ldquo;Show&rdquo; filter below to view only overdue invoices.
              </div>
            </div>
          </div>
          <FilterDropdown
            label="Show:"
            value={overdueOnly ? "overdue" : "all"}
            onChange={(v: string) => setOverdueOnly(v === "overdue")}
            options={[
              { value: "all", label: "All invoices" },
              { value: "overdue", label: "Overdue only" },
            ]}
            widthClass="w-40"
            testId="filter-invoices-overdue"
          />
        </div>
      )}

      {/* Search + Filters — single row of compact dropdowns + search input
          so the chrome is identical to every other list page (Bookings,
          Follow-ups, etc.). The Source filter (formerly a button-group of
          New/Imported/All tabs) is now a dropdown alongside Status. */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9 h-11 bg-card border-border"
            placeholder="Search by invoice number, client name, booking ref..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterDropdown
            label="Source:"
            value={sourceFilter}
            onChange={(v) => setSourceFilter(v as "new" | "imported" | "all")}
            options={[
              { value: "new",      label: "New",            count: newCount },
              { value: "imported", label: "Imported (Odoo)", count: importedCount },
              { value: "all",      label: "All",            count: invoices?.length ?? 0 },
            ]}
            widthClass="w-44"
            testId="filter-invoices-source"
          />
          <FilterDropdown
            label="Status:"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "All Statuses" },
              ...statuses.map(s => ({ value: s, label: s })),
            ]}
            widthClass="w-40"
            testId="filter-invoices-status"
          />
        </div>
      </div>

      {(() => {
        const SOURCE_LABELS: Record<string, string> = { new: "New", imported: "Imported (Odoo)", all: "All" };
        const chips: ActiveFilter[] = [];
        if (sourceFilter !== "new") chips.push({ key: "source", label: "Source", value: SOURCE_LABELS[sourceFilter] ?? sourceFilter, onClear: () => setSourceFilter("new") });
        if (statusFilter !== "all") chips.push({ key: "status", label: "Status", value: statusFilter, onClear: () => setStatusFilter("all") });
        if (overdueOnly) chips.push({ key: "show", label: "Show", value: "Overdue only", onClear: () => setOverdueOnly(false) });
        return <ActiveFilterChips filters={chips} onClearAll={() => { setSourceFilter("new"); setStatusFilter("all"); setOverdueOnly(false); }} />;
      })()}

      {/* Invoice list — grouped by linked booking's date, sticky day headers */}
      <div className="space-y-6">
        {isLoading ? (
          [...Array(5)].map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : filteredInvoices.length > 0 ? (
          groupedByDate.map(group => (
            <div key={group.sortKey} className="space-y-3">
              <div className="flex items-center gap-3 sticky top-0 bg-background/95 backdrop-blur-sm py-1.5 z-10">
                <h2 className="text-sm font-bold text-primary uppercase tracking-wide">{group.label}</h2>
                <div className="flex-1 h-px bg-border" />
                <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                  {group.items.length} invoice{group.items.length !== 1 ? "s" : ""}
                </Badge>
              </div>
              {group.items.map((invoice) => {
            const bk = bookingMap[invoice.booking_id];
            const selected = bulk.isSelected(invoice.id);
            const cardBody = (
              <Card className={`border-border transition-all bg-card ${
                bulk.selectMode
                  ? (selected ? "ring-2 ring-primary border-primary cursor-pointer" : "hover:border-primary/40 cursor-pointer")
                  : "hover:border-primary/40 hover:bg-secondary/10 cursor-pointer"
              }`}>
                    <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-4 min-w-0">
                        {bulk.selectMode ? (
                          <div className={`w-11 h-11 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${selected ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
                            {selected && <CheckSquare className="w-5 h-5 text-primary-foreground" />}
                          </div>
                        ) : (
                          <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <Receipt className="w-5 h-5 text-primary" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-bold text-foreground font-mono">{invoice.invoice_number}</div>
                          <div className="text-sm text-foreground/80 mt-0.5 font-medium truncate">
                            {bk?.client_name || "—"}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                            {bk?.tvl_ref && <span className="font-mono">{bk.tvl_ref}</span>}
                            {bk?.service_type && <span>· {bk.service_type}</span>}
                            {bk?.price && <span>· £{Number(bk.price).toLocaleString()}</span>}
                          </div>
                          {invoice.generated_at && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              Generated {format(new Date(invoice.generated_at), "dd MMM yyyy")}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 ml-0 sm:ml-4 flex-shrink-0">
                        <Badge variant="outline" className={`${getStatusColor(invoice.status)} text-xs px-3 py-1`}>
                          {invoice.status}
                        </Badge>
                        {/* Spacer reserves room for the absolutely-positioned
                            trash button so the badge isn't covered. */}
                        {canDeleteInvoices && !bulk.selectMode && <span className="w-9" aria-hidden />}
                      </div>
                    </CardContent>
                  </Card>
            );
            return (
              <div key={invoice.id} className="relative group">
                {bulk.selectMode ? (
                  <button type="button" onClick={() => bulk.toggle(invoice.id)} className="block w-full text-left" data-testid={`select-invoice-${invoice.id}`}>
                    {cardBody}
                  </button>
                ) : (
                  <Link href={`/invoices/${invoice.id}`}>{cardBody}</Link>
                )}
                {canDeleteInvoices && !bulk.selectMode && (
                  <div className="absolute top-1/2 -translate-y-1/2 right-3 sm:right-4 z-10">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/40 bg-card"
                          title="Delete invoice"
                          data-testid={`button-delete-invoice-${invoice.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete invoice {invoice.invoice_number}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently removes the invoice. The linked booking is not affected. The deletion is logged in the audit trail and broadcast to all staff. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep invoice</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => deleteInvoiceMut.mutate({ id: invoice.id })}
                            data-testid={`button-confirm-delete-invoice-${invoice.id}`}
                          >
                            Delete permanently
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}
              </div>
            );
          })}
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed rounded-xl">
            <FileText className="w-12 h-12 text-muted-foreground/30 mb-4" />
            {searchQuery || statusFilter !== "all" ? (
              <>
                <p className="text-muted-foreground font-medium">No invoices match your search</p>
                <Button variant="ghost" size="sm" className="mt-3" onClick={() => { setSearchQuery(""); setStatusFilter("all"); }}>
                  Clear filters
                </Button>
              </>
            ) : (
              <>
                <p className="text-muted-foreground font-medium">No invoices yet</p>
                <p className="text-sm text-muted-foreground/70 mt-1 mb-6">
                  Invoices are auto-generated when a booking is confirmed, or generate manually here.
                </p>
                <Button onClick={() => setGenerateOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Generate Invoice
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Generate dialog */}
      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle>Generate Invoice</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Select Booking</label>
              <Select value={selectedBookingId} onValueChange={setSelectedBookingId}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Choose a booking..." />
                </SelectTrigger>
                <SelectContent>
                  {bookingsWithoutInvoice.length === 0 ? (
                    <SelectItem value="_none" disabled>All bookings already have invoices</SelectItem>
                  ) : (
                    bookingsWithoutInvoice.map(b => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.tvl_ref} — {b.client_name || "Unknown"} — £{b.price}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              An INV-XXXX numbered invoice will be generated and linked to the selected booking. Invoices are also auto-generated when a booking is confirmed.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateOpen(false)}>Cancel</Button>
            <Button onClick={handleGenerate} disabled={!selectedBookingId || generate.isPending}>
              {generate.isPending ? "Generating..." : "Generate Invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkActionBar
        count={bulk.count}
        noun="invoice"
        onClear={bulk.clear}
        onDelete={handleBulkDelete}
      />
    </div>
  );
}
