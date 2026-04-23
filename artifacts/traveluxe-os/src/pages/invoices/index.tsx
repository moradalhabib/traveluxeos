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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Link } from "wouter";
import { format } from "date-fns";
import { AlertTriangle, FileText, Plus, Receipt, Search, X, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

export default function Invoices() {
  const [generateOpen, setGenerateOpen] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState<"new" | "imported" | "all">("new");
  // When true, show only invoices that are unpaid (Generated/Sent/Overdue)
  // for bookings completed > 48h ago — these are the operator's overdue items.
  // Toggled by tapping the amber banner; cleared by the X button.
  const [overdueOnly, setOverdueOnly] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canDeleteInvoices = user?.role === "admin" || user?.role === "super_admin";

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
    // Fix 3 — default Most Recent first across all list pages.
    const ts = (v: any) => (v ? new Date(v).getTime() : 0);
    return [...list].sort((a, b) =>
      ts((b as any).generated_at ?? (b as any).created_at) -
      ts((a as any).generated_at ?? (a as any).created_at)
    );
  }, [invoices, searchQuery, statusFilter, sourceFilter, bookingMap, overdueOnly, cutoff48h]);

  const statuses = ["Generated", "Sent", "Paid", "Overdue"];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Invoices</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filteredInvoices.length} of {invoices?.length || 0} invoices
          </p>
        </div>
        <Button
          className="w-full sm:w-auto h-12 shadow-[0_0_10px_rgba(201,168,76,0.2)]"
          onClick={() => setGenerateOpen(true)}
        >
          <Plus className="w-4 h-4 mr-2" />
          Generate Invoice
        </Button>
      </div>

      {/* Overdue-unpaid in-app reminder.
          REPLACES the operator email reminder by surfacing 48h+ unpaid
          invoices in-app only. Tap the banner to filter; tap the X to clear. */}
      {overdueUnpaid.length > 0 && (
        <button
          type="button"
          onClick={() => setOverdueOnly(v => !v)}
          className={`w-full flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
            overdueOnly
              ? "border-amber-500/60 bg-amber-500/15"
              : "border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15"
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-amber-300">
                {overdueUnpaid.length} unpaid invoice{overdueUnpaid.length === 1 ? "" : "s"} overdue (48h+)
              </div>
              <div className="text-xs text-amber-200/70">
                {overdueOnly ? "Showing overdue only — tap to clear filter" : "Tap to filter to overdue invoices only"}
              </div>
            </div>
          </div>
          {overdueOnly && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); setOverdueOnly(false); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setOverdueOnly(false); } }}
              className="inline-flex items-center gap-1 text-xs font-medium text-amber-300 hover:text-amber-200 px-2 py-1 rounded cursor-pointer"
            >
              <X className="w-3.5 h-3.5" /> Clear
            </span>
          )}
        </button>
      )}

      {/* Source tabs — keep imported Odoo invoices out of the way */}
      <div className="flex gap-1 bg-card border border-border rounded-lg p-1 w-fit">
        {([
          { key: "new", label: "New", count: newCount },
          { key: "imported", label: "Imported (Odoo)", count: importedCount },
          { key: "all", label: "All", count: invoices?.length ?? 0 },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setSourceFilter(t.key)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              sourceFilter === t.key
                ? "bg-primary/15 text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label} <span className="text-xs opacity-70">({t.count})</span>
          </button>
        ))}
      </div>

      {/* Search + Filter */}
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
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40 h-11 bg-card border-border">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {statuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Invoice list */}
      <div className="space-y-3">
        {isLoading ? (
          [...Array(5)].map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : filteredInvoices.length > 0 ? (
          filteredInvoices.map((invoice) => {
            const bk = bookingMap[invoice.booking_id];
            return (
              <div key={invoice.id} className="relative group">
                <Link href={`/invoices/${invoice.id}`}>
                  <Card className="border-border hover:border-primary/40 hover:bg-secondary/10 transition-all cursor-pointer bg-card">
                    <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Receipt className="w-5 h-5 text-primary" />
                        </div>
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
                        {canDeleteInvoices && <span className="w-9" aria-hidden />}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
                {canDeleteInvoices && (
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
          })
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
    </div>
  );
}
