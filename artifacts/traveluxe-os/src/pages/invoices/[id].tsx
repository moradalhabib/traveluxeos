import { useParams, useLocation } from "wouter";
import { useListInvoices, getListInvoicesQueryKey, useGetBooking, getGetBookingQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Download, Printer, Receipt, Mail, Phone } from "lucide-react";
import { format } from "date-fns";
import { useRef, useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const COMPANY = {
  name: "TRAVELUXE LONDON",
  address: "Berkeley Square, Mayfair, London W1J 6BR",
  email: "notifications@traveluxelondon.com",
  phone: "+44 (0) 20 XXXX XXXX",
  website: "www.traveluxelondon.com",
  tagline: "Luxury Chauffeur & Travel Concierge",
};

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

  const [orderLines, setOrderLines] = useState<any[]>([]);
  const [clientProfile, setClientProfile] = useState<any | null>(null);

  useEffect(() => {
    if (!invoice?.booking_id) return;
    supabase
      .from("booking_products")
      .select("*")
      .eq("booking_id", invoice.booking_id)
      .order("created_at")
      .then(({ data }) => setOrderLines(data ?? []));
  }, [invoice?.booking_id]);

  useEffect(() => {
    if (!(booking as any)?.client_id) return;
    supabase
      .from("clients")
      .select("id, name, email, whatsapp, nationality, vip_tier")
      .eq("id", (booking as any).client_id)
      .single()
      .then(({ data }) => setClientProfile(data ?? null));
  }, [(booking as any)?.client_id]);

  const isLoading = invLoading || bookLoading;

  const productsTotal = orderLines.reduce((s, l) => s + (l.total ?? l.unit_price * l.quantity ?? 0), 0);
  const jobTotal = booking ? Number(booking.price || 0) : 0;

  const handlePrint = () => window.print();

  const handleDownload = () => {
    if (!invoice || !booking) return;
    const content = buildPdfHtml(invoice, booking, orderLines, clientProfile);
    const blob = new Blob([content], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${invoice.invoice_number}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const buildPdfHtml = (inv: any, bk: any, lines: any[], client: any) => {
    const dateStr = inv.generated_at ? format(new Date(inv.generated_at), "dd MMMM yyyy") : format(new Date(), "dd MMMM yyyy");
    const serviceDate = bk.date_time ? format(new Date(bk.date_time), "dd MMM yyyy HH:mm") : "—";
    const hasLines = lines.length > 0;
    const linesHtml = hasLines
      ? lines.map(l => `<tr><td>${l.name}</td><td style="text-align:center">${l.quantity}</td><td style="text-align:right">£${Number(l.unit_price).toLocaleString()}</td><td style="text-align:right;font-weight:600">£${Number(l.total ?? l.unit_price * l.quantity).toLocaleString()}</td></tr>`).join("")
      : `<tr><td>${bk.service_type}${bk.vehicle_type ? ` — ${bk.vehicle_type}` : ""}</td><td style="text-align:center">1</td><td style="text-align:right">£${Number(bk.price || 0).toLocaleString()}</td><td style="text-align:right;font-weight:600">£${Number(bk.price || 0).toLocaleString()}</td></tr>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${inv.invoice_number} — Traveluxe London</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 820px; margin: 40px auto; padding: 0 30px; color: #111; font-size: 14px; }
    .gold-bar { height: 4px; background: linear-gradient(90deg, #C9A84C, #f0d080, #C9A84C); margin-bottom: 36px; border-radius: 2px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; }
    .brand-name { font-size: 22px; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; color: #0a0a0a; }
    .brand-meta { font-size: 11px; color: #888; margin-top: 4px; line-height: 1.6; }
    .inv-meta { text-align: right; }
    .inv-number { font-size: 24px; font-weight: 800; color: #C9A84C; font-family: monospace; }
    .inv-date { font-size: 12px; color: #666; margin-top: 6px; }
    .status-badge { display: inline-block; padding: 3px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; background: #f0faf0; color: #2a7d2a; border: 1px solid #a3d9a3; margin-top: 8px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin: 32px 0; }
    .section-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #999; margin-bottom: 8px; font-weight: 600; }
    .client-name { font-size: 18px; font-weight: 700; color: #111; line-height: 1.3; }
    .client-detail { font-size: 13px; color: #555; margin-top: 3px; line-height: 1.5; }
    .ref-num { font-size: 18px; font-weight: 700; font-family: monospace; color: #111; }
    .ref-detail { font-size: 13px; color: #555; margin-top: 3px; }
    .divider { border: none; border-top: 1px solid #e5e5e5; margin: 24px 0; }
    .gold-divider { border: none; border-top: 2px solid #C9A84C; margin: 24px 0; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 10px 12px; background: #f8f6f0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; border-bottom: 2px solid #C9A84C; }
    th:not(:first-child) { text-align: right; }
    th:nth-child(2) { text-align: center; }
    td { padding: 12px; border-bottom: 1px solid #eee; vertical-align: top; }
    .total-section { margin-top: 16px; }
    .total-row { display: flex; justify-content: space-between; padding: 8px 12px; }
    .total-row.grand { background: #f8f6f0; border-top: 2px solid #C9A84C; border-radius: 4px; font-weight: 700; font-size: 16px; color: #C9A84C; }
    .service-detail { font-size: 12px; color: #777; margin-top: 3px; }
    .footer { margin-top: 48px; padding-top: 20px; border-top: 1px solid #e5e5e5; display: flex; justify-content: space-between; align-items: flex-end; }
    .footer-brand { font-size: 12px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #C9A84C; }
    .footer-text { font-size: 11px; color: #999; margin-top: 4px; line-height: 1.6; }
    .footer-right { text-align: right; font-size: 11px; color: #999; line-height: 1.7; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <div class="gold-bar"></div>
  <div class="header">
    <div>
      <div class="brand-name">TRAVELUXE</div>
      <div class="brand-meta">
        ${COMPANY.address}<br>
        ${COMPANY.email}&nbsp;|&nbsp;${COMPANY.phone}<br>
        ${COMPANY.tagline}
      </div>
    </div>
    <div class="inv-meta">
      <div class="inv-number">${inv.invoice_number}</div>
      <div class="inv-date">Date: ${dateStr}</div>
      <div><span class="status-badge">${inv.status}</span></div>
    </div>
  </div>

  <hr class="gold-divider">

  <div class="grid-2">
    <div>
      <div class="section-label">Billed To</div>
      <div class="client-name">${client?.name || bk.client_name || "Client"}</div>
      ${client?.email ? `<div class="client-detail">📧 ${client.email}</div>` : ""}
      ${client?.nationality ? `<div class="client-detail">${client.nationality}</div>` : ""}
      ${client?.vip_tier && client.vip_tier !== "Standard" ? `<div class="client-detail">⭐ ${client.vip_tier} Client</div>` : ""}
    </div>
    <div>
      <div class="section-label">Booking Reference</div>
      <div class="ref-num">${bk.tvl_ref || "—"}</div>
      <div class="ref-detail">${bk.service_type || "—"}</div>
      ${serviceDate !== "—" ? `<div class="ref-detail">📅 ${serviceDate}</div>` : ""}
      ${bk.pickup ? `<div class="ref-detail">📍 ${bk.pickup}${bk.dropoff ? ` → ${bk.dropoff}` : ""}</div>` : ""}
      ${bk.flight_number ? `<div class="ref-detail">✈ ${bk.flight_number}${bk.passengers ? ` | ${bk.passengers} pax` : ""}</div>` : ""}
    </div>
  </div>

  <hr class="divider">

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th style="text-align:center">Qty</th>
        <th style="text-align:right">Unit Price</th>
        <th style="text-align:right">Total</th>
      </tr>
    </thead>
    <tbody>
      ${linesHtml}
    </tbody>
  </table>

  <div class="total-section">
    <div class="total-row grand">
      <span>TOTAL DUE</span>
      <span>£${Number(bk.price || 0).toLocaleString()}</span>
    </div>
  </div>

  <div class="footer">
    <div>
      <div class="footer-brand">Traveluxe London</div>
      <div class="footer-text">
        ${COMPANY.address}<br>
        Thank you for choosing Traveluxe. We look forward to serving you again.
      </div>
    </div>
    <div class="footer-right">
      ${COMPANY.email}<br>
      ${COMPANY.phone}<br>
      ${COMPANY.website}
    </div>
  </div>
</body>
</html>`;
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[600px] w-full" />
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
      case "Sent": return "bg-blue-500/20 text-blue-400 border-blue-500/50";
      case "Paid": return "bg-green-500/20 text-green-400 border-green-500/50";
      case "Overdue": return "bg-destructive/20 text-destructive border-destructive/50";
      default: return "bg-amber-500/20 text-amber-400 border-amber-500/50";
    }
  };

  const hasLines = orderLines.length > 0;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => setLocation("/invoices")} className="text-muted-foreground">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Invoices
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handlePrint} className="border-primary/20 hover:bg-primary/10">
            <Printer className="w-4 h-4 mr-2" /> Print
          </Button>
          <Button onClick={handleDownload} className="shadow-[0_0_10px_rgba(201,168,76,0.2)]">
            <Download className="w-4 h-4 mr-2" /> Download
          </Button>
        </div>
      </div>

      <Card className="border-primary/20 bg-card overflow-hidden" ref={printRef}>
        <div className="h-1.5 bg-gradient-to-r from-primary via-amber-300 to-primary w-full" />

        <CardContent className="p-6 sm:p-10 space-y-8">
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-6">
            <div>
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-lg bg-primary flex items-center justify-center shadow-[0_0_16px_rgba(201,168,76,0.3)]">
                  <span className="text-primary-foreground font-bold text-xl">T</span>
                </div>
                <div>
                  <div className="font-bold text-xl tracking-widest uppercase text-foreground">TRAVELUXE</div>
                  <div className="text-xs text-muted-foreground tracking-wide">Mayfair, London</div>
                </div>
              </div>
              <div className="mt-4 space-y-1">
                <p className="text-xs text-muted-foreground">{COMPANY.address}</p>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Mail className="w-3 h-3" /> {COMPANY.email}
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Phone className="w-3 h-3" /> {COMPANY.phone}
                </div>
              </div>
            </div>
            <div className="text-left sm:text-right">
              <div className="font-mono text-3xl font-bold text-primary">{invoice.invoice_number}</div>
              <Badge variant="outline" className={`mt-2 ${getStatusColor(invoice.status)}`}>{invoice.status}</Badge>
              {invoice.generated_at && (
                <div className="text-xs text-muted-foreground mt-2">
                  {format(new Date(invoice.generated_at), "dd MMMM yyyy")}
                </div>
              )}
            </div>
          </div>

          <Separator className="bg-primary/30" />

          {/* Billed to + booking ref */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Billed To</p>
              <p className="font-bold text-lg text-foreground">
                {clientProfile?.name || booking?.client_name || "—"}
              </p>
              {clientProfile?.email && (
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
                  <Mail className="w-3.5 h-3.5" /> {clientProfile.email}
                </div>
              )}
              {(clientProfile?.nationality || (booking as any)?.client_nationality) && (
                <p className="text-sm text-muted-foreground mt-1">
                  {clientProfile?.nationality || (booking as any).client_nationality}
                </p>
              )}
              {clientProfile?.vip_tier && clientProfile.vip_tier !== "Standard" && (
                <Badge variant="outline" className="mt-2 text-primary border-primary/30 text-[10px]">
                  ⭐ {clientProfile.vip_tier}
                </Badge>
              )}
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Booking Details</p>
              <p className="font-mono font-bold text-lg text-foreground">{booking?.tvl_ref || "—"}</p>
              <p className="text-sm text-muted-foreground mt-1">{booking?.service_type}</p>
              {booking?.date_time && (
                <p className="text-sm text-muted-foreground mt-1">
                  📅 {format(new Date(booking.date_time), "dd MMM yyyy, HH:mm")}
                </p>
              )}
              {booking?.pickup && (
                <p className="text-xs text-muted-foreground mt-1">
                  📍 {booking.pickup}{(booking.dropoff || (booking as any).destination) ? ` → ${booking.dropoff || (booking as any).destination}` : ""}
                </p>
              )}
              {booking?.flight_number && (
                <p className="text-xs text-muted-foreground mt-1">
                  ✈ {booking.flight_number}{booking.passengers ? ` · ${booking.passengers} pax` : ""}
                </p>
              )}
            </div>
          </div>

          <Separator className="bg-border" />

          {/* Line items */}
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-4">Services & Products</p>

            {/* Table header */}
            <div className="grid grid-cols-12 gap-2 pb-2.5 border-b border-primary/30 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              <div className="col-span-6">Description</div>
              <div className="col-span-2 text-center">Qty</div>
              <div className="col-span-2 text-right">Unit</div>
              <div className="col-span-2 text-right">Total</div>
            </div>

            {hasLines ? (
              orderLines.map((line: any) => (
                <div key={line.id} className="grid grid-cols-12 gap-2 py-3.5 border-b border-border/50 text-sm">
                  <div className="col-span-6 font-medium text-foreground">{line.name}</div>
                  <div className="col-span-2 text-center text-muted-foreground">{line.quantity}</div>
                  <div className="col-span-2 text-right text-muted-foreground">£{Number(line.unit_price ?? 0).toLocaleString()}</div>
                  <div className="col-span-2 text-right font-semibold text-foreground">
                    £{Number(line.total ?? line.unit_price * line.quantity ?? 0).toLocaleString()}
                  </div>
                </div>
              ))
            ) : (
              <div className="grid grid-cols-12 gap-2 py-3.5 border-b border-border/50 text-sm">
                <div className="col-span-6">
                  <p className="font-medium text-foreground">{booking?.service_type}{booking?.vehicle_type ? ` — ${booking.vehicle_type}` : ""}</p>
                  {booking?.flight_number && <p className="text-xs text-muted-foreground mt-0.5">Flight: {booking.flight_number}</p>}
                  {booking?.nameboard && <p className="text-xs text-muted-foreground">Board: {booking.nameboard}</p>}
                </div>
                <div className="col-span-2 text-center text-muted-foreground">1</div>
                <div className="col-span-2 text-right text-muted-foreground">£{Number(booking?.price || 0).toLocaleString()}</div>
                <div className="col-span-2 text-right font-semibold text-foreground">£{Number(booking?.price || 0).toLocaleString()}</div>
              </div>
            )}

            {/* Hotel booking details note */}
            {booking?.service_type === "Hotel" && (
              <div className="mt-4 p-4 rounded-xl border border-primary/20 bg-primary/5 text-sm space-y-1">
                <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-2">Booking Details</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {booking.hotel_name && <><span className="text-muted-foreground">Hotel:</span><span className="font-medium">{booking.hotel_name}</span></>}
                  {booking.room_type && <><span className="text-muted-foreground">Room Type:</span><span className="font-medium">{booking.room_type}</span></>}
                  {booking.hotel_booking_ref && <><span className="text-muted-foreground">Booking Ref:</span><span className="font-medium font-mono">{booking.hotel_booking_ref}</span></>}
                  {booking.num_guests && <><span className="text-muted-foreground">Guests:</span><span className="font-medium">{booking.num_guests}</span></>}
                  {booking.check_in_date && <><span className="text-muted-foreground">Check-in:</span><span className="font-medium">{new Date(booking.check_in_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span></>}
                  {booking.check_out_date && <><span className="text-muted-foreground">Check-out:</span><span className="font-medium">{new Date(booking.check_out_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span></>}
                  {booking.num_nights && <><span className="text-muted-foreground">Nights:</span><span className="font-medium">{booking.num_nights} {booking.num_nights === 1 ? "night" : "nights"}</span></>}
                  {booking.breakfast_included != null && <><span className="text-muted-foreground">Breakfast:</span><span className="font-medium">{booking.breakfast_included ? "Included" : "Not included"}</span></>}
                </div>
              </div>
            )}

            {/* Apartment booking details note */}
            {booking?.service_type === "Apartment" && (
              <div className="mt-4 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 text-sm space-y-1">
                <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2">Accommodation Details</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {booking.property_name && <><span className="text-muted-foreground">Property:</span><span className="font-medium">{booking.property_name}</span></>}
                  {booking.property_address && <><span className="text-muted-foreground col-span-1">Address:</span><span className="font-medium">{booking.property_address}</span></>}
                  {booking.check_in_date && <><span className="text-muted-foreground">Check-in:</span><span className="font-medium">{new Date(booking.check_in_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span></>}
                  {booking.check_out_date && <><span className="text-muted-foreground">Check-out:</span><span className="font-medium">{new Date(booking.check_out_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span></>}
                  {booking.nights && <><span className="text-muted-foreground">Nights:</span><span className="font-medium">{booking.nights}</span></>}
                </div>
              </div>
            )}

            {/* Totals */}
            <div className="mt-5 space-y-2">
              {hasLines && productsTotal !== jobTotal && (
                <div className="flex justify-between items-center text-sm px-1">
                  <span className="text-muted-foreground">Products Subtotal</span>
                  <span className="text-foreground font-medium">£{productsTotal.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between items-center bg-primary/5 border border-primary/20 rounded-xl px-4 py-3.5">
                <span className="font-bold text-base text-foreground">TOTAL DUE</span>
                <span className="font-bold text-2xl text-primary">£{jobTotal.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <Separator className="bg-border" />

          {/* Payment status + notes */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
            <div>
              {booking?.payment_status && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Payment:</span>
                  <Badge variant="outline" className={booking.payment_status === "Paid" ? "text-green-400 border-green-500/30 text-xs" : "text-amber-400 border-amber-500/30 text-xs"}>
                    {booking.payment_status}
                  </Badge>
                  {booking.payment_method && (
                    <span className="text-xs text-muted-foreground">via {booking.payment_method}</span>
                  )}
                </div>
              )}
            </div>
          </div>

          <Separator className="bg-border" />

          {/* Footer */}
          <div className="flex flex-col sm:flex-row justify-between items-end gap-4">
            <div>
              <p className="text-xs font-bold tracking-widest uppercase text-primary mb-1">Traveluxe London</p>
              <p className="text-xs text-muted-foreground">{COMPANY.address}</p>
              <p className="text-xs text-muted-foreground">Thank you for choosing our service.</p>
            </div>
            <div className="text-left sm:text-right space-y-0.5">
              <p className="text-xs text-muted-foreground">{COMPANY.email}</p>
              <p className="text-xs text-muted-foreground">{COMPANY.phone}</p>
              <p className="text-xs text-muted-foreground">{COMPANY.website}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
