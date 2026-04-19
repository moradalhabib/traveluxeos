import { useParams, useLocation } from "wouter";
import { useListInvoices, getListInvoicesQueryKey, useGetBooking, getGetBookingQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Download, Printer, Receipt } from "lucide-react";
import { format } from "date-fns";
import { useRef } from "react";

export default function InvoiceDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const id = params.id as string;
  const printRef = useRef<HTMLDivElement>(null);

  const { data: invoices, isLoading: invLoading } = useListInvoices(
    { query: { enabled: true, queryKey: getListInvoicesQueryKey() } }
  );

  const invoice = invoices?.find(inv => inv.id === id);

  const { data: booking, isLoading: bookLoading } = useGetBooking(
    invoice?.booking_id ?? "",
    {
      query: {
        enabled: !!invoice?.booking_id,
        queryKey: getGetBookingQueryKey(invoice?.booking_id ?? "")
      }
    }
  );

  const isLoading = invLoading || bookLoading;

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    if (!printRef.current || !invoice || !booking) return;

    const content = buildPdfHtml(invoice, booking);
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${invoice.invoice_number}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const buildPdfHtml = (inv: any, bk: any) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${inv.invoice_number}</title>
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #111; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 2px solid #C9A84C; }
    .brand { font-size: 24px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; }
    .brand-sub { font-size: 11px; color: #888; margin-top: 4px; }
    .inv-meta { text-align: right; }
    .inv-number { font-size: 22px; font-weight: bold; color: #C9A84C; font-family: monospace; }
    .inv-date { font-size: 12px; color: #666; margin-top: 4px; }
    .section { margin-bottom: 30px; }
    .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin-bottom: 8px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th { text-align: left; padding: 10px 12px; background: #f5f5f5; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #555; }
    td { padding: 12px; border-bottom: 1px solid #eee; font-size: 14px; }
    .total-row td { font-weight: bold; border-top: 2px solid #C9A84C; background: #fffdf5; }
    .status { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: bold; background: #f0f9f0; color: #2a7d2a; border: 1px solid #a3d9a3; }
    .footer { margin-top: 50px; padding-top: 20px; border-top: 1px solid #eee; font-size: 11px; color: #888; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">TRAVELUXE</div>
      <div class="brand-sub">Mayfair, London &nbsp;|&nbsp; Luxury Chauffeur &amp; Travel Concierge</div>
    </div>
    <div class="inv-meta">
      <div class="inv-number">${inv.invoice_number}</div>
      <div class="inv-date">Date: ${inv.generated_at ? format(new Date(inv.generated_at), 'dd MMMM yyyy') : format(new Date(), 'dd MMMM yyyy')}</div>
      <div style="margin-top:8px"><span class="status">${inv.status}</span></div>
    </div>
  </div>

  <div class="grid">
    <div class="section">
      <div class="section-title">Billed To</div>
      <div style="font-size:16px;font-weight:600">${bk.client_name || 'Client'}</div>
      ${bk.client_nationality ? `<div style="color:#666;font-size:13px">${bk.client_nationality}</div>` : ''}
    </div>
    <div class="section">
      <div class="section-title">Booking Reference</div>
      <div style="font-size:16px;font-weight:600;font-family:monospace">${bk.tvl_ref || '—'}</div>
      <div style="color:#666;font-size:13px">${bk.service_type}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>Date</th>
        <th>Route</th>
        <th style="text-align:right">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${bk.service_type}${bk.vehicle_type ? ` — ${bk.vehicle_type}` : ''}</td>
        <td>${bk.date_time ? format(new Date(bk.date_time), 'dd MMM yyyy HH:mm') : '—'}</td>
        <td>${bk.pickup || '—'} → ${bk.dropoff || bk.destination || '—'}</td>
        <td style="text-align:right;font-weight:600">£${Number(bk.price || 0).toLocaleString()}</td>
      </tr>
      ${bk.flight_number ? `<tr><td colspan="3" style="color:#555;font-size:12px">Flight: ${bk.flight_number}${bk.passengers ? ` &nbsp;|&nbsp; Passengers: ${bk.passengers}` : ''}</td><td></td></tr>` : ''}
      <tr class="total-row">
        <td colspan="3">Total</td>
        <td style="text-align:right;font-size:18px;color:#C9A84C">£${Number(bk.price || 0).toLocaleString()}</td>
      </tr>
    </tbody>
  </table>

  <div class="footer">
    <p>Traveluxe London &nbsp;|&nbsp; Mayfair &nbsp;|&nbsp; Thank you for choosing our service.</p>
    <p>This invoice was generated by Traveluxe OS. For queries, please contact your concierge.</p>
  </div>
</body>
</html>`;

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[500px] w-full" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center">
        <p className="text-muted-foreground">Invoice not found.</p>
        <Button variant="ghost" onClick={() => setLocation("/invoices")} className="mt-4">Back to Invoices</Button>
      </div>
    );
  }

  const getStatusColor = (s: string) => {
    switch (s) {
      case 'Sent': return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
      case 'Paid': return 'bg-green-500/20 text-green-400 border-green-500/50';
      case 'Overdue': return 'bg-destructive/20 text-destructive border-destructive/50';
      default: return 'bg-amber-500/20 text-amber-400 border-amber-500/50';
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => setLocation("/invoices")} className="text-muted-foreground">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Invoices
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handlePrint} className="border-primary/20 hover:bg-primary/10">
            <Printer className="w-4 h-4 mr-2" />
            Print
          </Button>
          <Button onClick={handleDownload} className="shadow-[0_0_10px_rgba(201,168,76,0.2)]">
            <Download className="w-4 h-4 mr-2" />
            Download
          </Button>
        </div>
      </div>

      {/* Invoice preview card */}
      <Card className="border-primary/20 bg-card overflow-hidden" ref={printRef}>
        {/* Gold header bar */}
        <div className="h-1.5 bg-primary w-full" />

        <CardContent className="p-8 space-y-8">
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-6">
            <div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded bg-primary flex items-center justify-center">
                  <span className="text-primary-foreground font-bold text-xl">T</span>
                </div>
                <div>
                  <div className="font-bold text-xl tracking-widest uppercase text-foreground">TRAVELUXE</div>
                  <div className="text-xs text-muted-foreground tracking-wide">Mayfair, London</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">Luxury Chauffeur &amp; Travel Concierge</p>
            </div>
            <div className="text-left sm:text-right">
              <div className="font-mono text-2xl font-bold text-primary">{invoice.invoice_number}</div>
              <Badge variant="outline" className={`mt-2 ${getStatusColor(invoice.status)}`}>{invoice.status}</Badge>
              {invoice.generated_at && (
                <div className="text-xs text-muted-foreground mt-2">
                  Generated {format(new Date(invoice.generated_at), 'dd MMMM yyyy')}
                </div>
              )}
            </div>
          </div>

          <Separator className="bg-primary/20" />

          {/* Billed to + booking ref */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Billed To</p>
              <p className="font-bold text-lg text-foreground">{booking?.client_name || '—'}</p>
              {(booking as any)?.client_nationality && (
                <p className="text-sm text-muted-foreground">{(booking as any).client_nationality}</p>
              )}
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Booking Reference</p>
              <p className="font-mono font-bold text-lg text-foreground">{booking?.tvl_ref || '—'}</p>
              <p className="text-sm text-muted-foreground mt-1">{booking?.service_type}</p>
            </div>
          </div>

          <Separator className="bg-border" />

          {/* Line items table */}
          <div>
            <div className="grid grid-cols-12 gap-2 pb-2 border-b border-border text-xs uppercase tracking-wider text-muted-foreground font-medium">
              <div className="col-span-5">Description</div>
              <div className="col-span-3">Date / Time</div>
              <div className="col-span-2">Route</div>
              <div className="col-span-2 text-right">Amount</div>
            </div>
            <div className="grid grid-cols-12 gap-2 py-4 border-b border-border/50 text-sm">
              <div className="col-span-5">
                <p className="font-medium text-foreground">{booking?.service_type}{booking?.vehicle_type ? ` — ${booking.vehicle_type}` : ''}</p>
                {booking?.flight_number && <p className="text-xs text-muted-foreground mt-1">Flight: {booking.flight_number}</p>}
                {booking?.passengers && <p className="text-xs text-muted-foreground">Passengers: {booking.passengers}</p>}
                {booking?.nameboard && <p className="text-xs text-muted-foreground">Name board: {booking.nameboard}</p>}
              </div>
              <div className="col-span-3 text-muted-foreground">
                {booking?.date_time ? format(new Date(booking.date_time), 'dd MMM yyyy HH:mm') : '—'}
              </div>
              <div className="col-span-2 text-muted-foreground text-xs">
                {booking?.pickup ? `${booking.pickup}` : '—'}
                {(booking?.dropoff || (booking as any)?.destination) && ` → ${booking?.dropoff || (booking as any)?.destination}`}
              </div>
              <div className="col-span-2 text-right font-semibold text-foreground">
                £{Number(booking?.price || 0).toLocaleString()}
              </div>
            </div>

            {/* Total */}
            <div className="grid grid-cols-12 gap-2 pt-4">
              <div className="col-span-10 text-right font-bold text-foreground text-base">Total</div>
              <div className="col-span-2 text-right font-bold text-primary text-xl">
                £{Number(booking?.price || 0).toLocaleString()}
              </div>
            </div>
          </div>

          <Separator className="bg-border" />

          {/* Footer */}
          <div className="text-center space-y-1">
            <p className="text-xs text-muted-foreground">
              Traveluxe London &nbsp;·&nbsp; Mayfair &nbsp;·&nbsp; Thank you for choosing our service
            </p>
            <p className="text-xs text-muted-foreground/60">
              For queries regarding this invoice, please contact your dedicated concierge.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
