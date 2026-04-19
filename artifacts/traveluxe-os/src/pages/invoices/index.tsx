import { useState } from "react";
import { useListInvoices, getListInvoicesQueryKey, useGenerateInvoice, useListBookings, getListBookingsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Link } from "wouter";
import { format } from "date-fns";
import { FileText, Plus, Download, Eye, Receipt } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Invoices() {
  const [generateOpen, setGenerateOpen] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState("");
  const { toast } = useToast();

  const { data: invoices, isLoading, refetch } = useListInvoices(
    { query: { enabled: true, queryKey: getListInvoicesQueryKey() } }
  );

  const { data: bookings } = useListBookings(
    {},
    { query: { enabled: generateOpen, queryKey: getListBookingsQueryKey({}) } }
  );

  const generate = useGenerateInvoice();

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
      case 'Sent': return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
      case 'Paid': return 'bg-green-500/20 text-green-400 border-green-500/50';
      case 'Overdue': return 'bg-destructive/20 text-destructive border-destructive/50';
      default: return 'bg-amber-500/20 text-amber-400 border-amber-500/50';
    }
  };

  const bookingsWithoutInvoice = bookings?.filter(b =>
    b.status !== 'Cancelled' &&
    !invoices?.some(inv => inv.booking_id === b.id)
  ) || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Invoices</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{invoices?.length || 0} total</p>
        </div>
        <Button
          className="w-full sm:w-auto h-12 shadow-[0_0_10px_rgba(201,168,76,0.2)]"
          onClick={() => setGenerateOpen(true)}
        >
          <Plus className="w-4 h-4 mr-2" />
          Generate Invoice
        </Button>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          [...Array(5)].map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : invoices && invoices.length > 0 ? (
          invoices.map((invoice) => (
            <Link key={invoice.id} href={`/invoices/${invoice.id}`}>
              <Card className="border-border hover:border-primary/40 hover:bg-secondary/10 transition-all cursor-pointer bg-card">
                <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Receipt className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <div className="font-bold text-foreground font-mono">{invoice.invoice_number}</div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        Booking ref — {invoice.booking_id.slice(0, 8)}...
                      </div>
                      {invoice.generated_at && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Generated {format(new Date(invoice.generated_at), 'dd MMM yyyy HH:mm')}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 ml-15">
                    <Badge variant="outline" className={getStatusColor(invoice.status)}>
                      {invoice.status}
                    </Badge>
                    <Button variant="outline" size="sm" className="text-muted-foreground gap-2" asChild onClick={e => e.preventDefault()}>
                      <Link href={`/invoices/${invoice.id}`}>
                        <Eye className="w-4 h-4" />
                        View
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed rounded-xl">
            <FileText className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground font-medium">No invoices yet</p>
            <p className="text-sm text-muted-foreground/70 mt-1 mb-6">Generate your first invoice from a confirmed booking</p>
            <Button onClick={() => setGenerateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Generate Invoice
            </Button>
          </div>
        )}
      </div>

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
                        {b.tvl_ref} — {b.client_name || 'Unknown'} — £{b.price}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              An INV-XXXX numbered invoice will be generated and linked to the selected booking.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateOpen(false)}>Cancel</Button>
            <Button
              onClick={handleGenerate}
              disabled={!selectedBookingId || generate.isPending}
            >
              {generate.isPending ? "Generating..." : "Generate Invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
