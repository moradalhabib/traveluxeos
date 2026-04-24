import { Router, type IRouter, type Request, type Response } from "express";
import PDFDocument from "pdfkit";
import { supabase } from "../lib/supabase";

const router: IRouter = Router();

// Customer-facing PDF palette — light/print-friendly so receipts and
// confirmations render correctly in every mail client (Mac Mail, Outlook,
// Gmail). The OS itself is dark; the printable document is not.
const COLOR_BG       = "#ffffff";
const COLOR_PANEL    = "#f6f3ec";
const COLOR_GOLD     = "#c9a961";
const COLOR_GOLD_DIM = "#8a7340";
const COLOR_TEXT     = "#1a1a1a";
const COLOR_MUTED    = "#6b6b6b";
const COLOR_LINE     = "#e2dccd";

function fmtMoney(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return `£${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDateTime(s?: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
  });
}
function fmtDate(s?: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    timeZone: "Europe/London",
  });
}

// Per-page chrome: top gold bar + footer line.
// IMPORTANT: must NOT repaint the page background — doing so wipes the
// body content (PDFs draw in order; later ops paint over earlier ones).
// The page background is painted once at the start of each page by the
// caller before any content is added.
function paintChrome(doc: any, pageNum: number, total: number) {
  doc.save();
  // Top gold bar
  doc.rect(0, 0, doc.page.width, 6).fill(COLOR_GOLD);
  // Footer
  doc.fillColor(COLOR_MUTED).font("Helvetica").fontSize(8)
    .text(`Traveluxe London · Mayfair · info@traveluxelondon.com`, 50, doc.page.height - 40, {
      width: doc.page.width - 100, align: "left",
    });
  doc.fillColor(COLOR_GOLD_DIM).fontSize(8)
    .text(`Page ${pageNum} of ${total}`, 50, doc.page.height - 40, {
      width: doc.page.width - 100, align: "right",
    });
  doc.restore();
}

type VehicleLeg = {
  car_no: number;            // 1 = primary, 2+ = extras
  driver_name: string | null;
  vehicle_type: string | null;
  pickup: string | null;
  dropoff: string | null;
  date_time: string | null;
  is_override: boolean;      // true if this leg deviates from the primary
};

export function buildPdf(
  b: any,
  client: any,
  driver: any,
  vehicleLegs: VehicleLeg[] = [],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Page 1 background ──────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLOR_BG);
    doc.rect(0, 0, doc.page.width, 6).fill(COLOR_GOLD);

    // ── Brand header ──────────────────────────────────────────────────
    doc.fillColor(COLOR_GOLD).font("Helvetica-Bold").fontSize(24)
      .text("TRAVELUXE", 50, 50, { continued: true })
      .fillColor(COLOR_TEXT).text(" LONDON");
    doc.fillColor(COLOR_MUTED).font("Helvetica").fontSize(9)
      .text("Private Concierge · Mayfair, London", 50, 80);

    // Reference panel (top right)
    const refX = doc.page.width - 200, refY = 50;
    doc.roundedRect(refX, refY, 150, 56, 4).fill(COLOR_PANEL);
    doc.fillColor(COLOR_MUTED).fontSize(8).text("BOOKING REFERENCE", refX + 12, refY + 8);
    doc.fillColor(COLOR_GOLD).font("Helvetica-Bold").fontSize(16)
      .text(b.tvl_ref ?? "—", refX + 12, refY + 22);
    doc.fillColor(COLOR_MUTED).font("Helvetica").fontSize(8)
      .text(`Issued ${new Date().toLocaleDateString("en-GB")}`, refX + 12, refY + 44);

    // Title
    doc.moveDown(3);
    doc.fillColor(COLOR_TEXT).font("Helvetica-Bold").fontSize(20)
      .text("Booking Confirmation", 50, 130);
    doc.moveTo(50, 160).lineTo(doc.page.width - 50, 160).strokeColor(COLOR_GOLD).lineWidth(0.6).stroke();

    let y = 180;

    // ── Client block ───────────────────────────────────────────────────
    doc.fillColor(COLOR_GOLD).font("Helvetica-Bold").fontSize(11).text("PREPARED FOR", 50, y);
    y += 16;
    doc.fillColor(COLOR_TEXT).font("Helvetica-Bold").fontSize(14)
      .text(b.client_name ?? client?.name ?? "—", 50, y);
    if (client?.vip_tier && client.vip_tier !== "Standard") {
      const tier = client.vip_tier;
      const tierColor = tier === "Platinum" ? COLOR_GOLD
                      : tier === "VVIP" ? "#b58cff"
                      : COLOR_GOLD_DIM;
      const w = doc.widthOfString(tier) + 14;
      const tx = 50 + doc.widthOfString(b.client_name ?? client?.name ?? "—") + 12;
      doc.roundedRect(tx, y - 1, w, 16, 8).fillAndStroke(tierColor, tierColor);
      doc.fillColor(COLOR_BG).font("Helvetica-Bold").fontSize(8).text(tier, tx + 7, y + 3);
    }
    y += 30;

    // ── Booking detail rows ────────────────────────────────────────────
    const rows: Array<[string, string]> = [];
    rows.push(["Service", b.service_type ?? "—"]);

    const isAccom = b.service_type === "Hotel" || b.service_type === "Apartment";
    if (!isAccom) {
      rows.push(["Date & Time", fmtDateTime(b.date_time)]);
      if (b.direction)      rows.push(["Direction", b.direction]);
      if (b.flight_number)  rows.push(["Flight", b.flight_number]);
      if (b.vehicle_type)   rows.push(["Vehicle", b.vehicle_type]);
      if (b.pickup)         rows.push(["Pickup", b.pickup]);
      if (b.dropoff)        rows.push(["Drop-off", b.dropoff]);
      if (b.passengers)     rows.push(["Passengers", String(b.passengers)]);
      if (b.luggage)        rows.push(["Luggage", String(b.luggage)]);
      if (b.nameboard)      rows.push(["Meet & Greet Board", `"${b.nameboard}"`]);
      rows.push(["Driver", driver?.name ?? b.driver_name ?? "Will be confirmed shortly"]);
    } else {
      if (b.hotel_name)         rows.push(["Hotel", b.hotel_name]);
      if (b.property_name)      rows.push(["Property", b.property_name]);
      if (b.hotel_booking_ref)  rows.push(["Hotel Reference", b.hotel_booking_ref]);
      if (b.room_type)          rows.push(["Room", b.room_type]);
      if (b.check_in_date)      rows.push(["Check-in", fmtDate(b.check_in_date)]);
      if (b.check_out_date)     rows.push(["Check-out", fmtDate(b.check_out_date)]);
      if (b.num_nights || b.nights) rows.push(["Nights", String(b.num_nights ?? b.nights)]);
      if (b.num_guests)         rows.push(["Guests", String(b.num_guests)]);
    }

    if (b.service_type === "Car Rental") {
      if (b.rental_days)     rows.push(["Rental Days", String(b.rental_days)]);
      if (b.base_daily_rate) rows.push(["Daily Rate", fmtMoney(b.base_daily_rate)]);
    }

    // Render the rows panel
    const panelTop = y;
    const rowH = 22;
    const panelH = rows.length * rowH + 16;
    doc.roundedRect(50, panelTop, doc.page.width - 100, panelH, 6).fill(COLOR_PANEL);
    y = panelTop + 12;
    for (const [label, value] of rows) {
      doc.fillColor(COLOR_MUTED).font("Helvetica").fontSize(9)
        .text(label.toUpperCase(), 64, y, { width: 130 });
      doc.fillColor(COLOR_TEXT).font("Helvetica-Bold").fontSize(11)
        .text(value, 200, y - 1, { width: doc.page.width - 250 });
      y += rowH;
    }
    y = panelTop + panelH + 22;

    // ── Per-vehicle routes (multi-car bookings only) ───────────────────
    // When the booking has extra cars whose pickup, drop-off, or pickup time
    // deviates from the parent route, list each car's leg here so the client
    // knows exactly which car collects them where. Hidden for single-car
    // bookings and for accommodation-type services (where this doesn't apply).
    const overrideLegs = vehicleLegs.filter(v => v.is_override);
    if (!isAccom && overrideLegs.length > 0) {
      // Page-break safety: this section can be tall for 3+ cars.
      const estH = 30 + overrideLegs.length * 70;
      if (y + estH > doc.page.height - 80) {
        doc.addPage();
        doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLOR_BG);
        doc.rect(0, 0, doc.page.width, 6).fill(COLOR_GOLD);
        y = 60;
      }

      doc.fillColor(COLOR_GOLD).font("Helvetica-Bold").fontSize(11)
        .text("PER-VEHICLE ROUTES", 50, y);
      y += 6;
      doc.fillColor(COLOR_MUTED).font("Helvetica-Oblique").fontSize(9)
        .text(
          `${overrideLegs.length} of ${vehicleLegs.length} cars on this booking pick up at a different location or time.`,
          50, y + 6, { width: doc.page.width - 100 },
        );
      y += 24;

      const legsTop = y;
      // Reserve enough height for each leg block + padding.
      const legW = doc.page.width - 100;
      doc.roundedRect(50, legsTop, legW, overrideLegs.length * 70 + 12, 6).fill(COLOR_PANEL);
      let ly = legsTop + 12;
      for (const leg of overrideLegs) {
        // Heading: Car # · Driver · Vehicle
        const heading = `Car #${leg.car_no}` +
          (leg.driver_name ? ` · ${leg.driver_name}` : "") +
          (leg.vehicle_type ? ` · ${leg.vehicle_type}` : "");
        doc.fillColor(COLOR_GOLD).font("Helvetica-Bold").fontSize(10)
          .text(heading, 64, ly, { width: legW - 28 });
        ly += 14;

        // Render the override fields, falling back to the parent value when
        // a particular field wasn't overridden so the client always sees a
        // complete leg description (not just "pickup changed, drop-off ?").
        const pickup  = leg.pickup  ?? b.pickup  ?? "—";
        const dropoff = leg.dropoff ?? b.dropoff ?? b.destination ?? "—";
        const when    = leg.date_time ?? b.date_time;

        doc.fillColor(COLOR_MUTED).font("Helvetica").fontSize(9)
          .text("Pickup:", 64, ly, { width: 60, continued: true })
          .fillColor(COLOR_TEXT).font("Helvetica-Bold")
          .text(` ${pickup}`, { width: legW - 80 });
        ly = doc.y + 2;
        doc.fillColor(COLOR_MUTED).font("Helvetica").fontSize(9)
          .text("Drop-off:", 64, ly, { width: 60, continued: true })
          .fillColor(COLOR_TEXT).font("Helvetica-Bold")
          .text(` ${dropoff}`, { width: legW - 80 });
        ly = doc.y + 2;
        if (when) {
          doc.fillColor(COLOR_MUTED).font("Helvetica").fontSize(9)
            .text("Pickup time:", 64, ly, { width: 70, continued: true })
            .fillColor(COLOR_TEXT).font("Helvetica-Bold")
            .text(` ${fmtDateTime(when)}`, { width: legW - 90 });
          ly = doc.y + 2;
        }
        ly += 8;
      }
      y = legsTop + overrideLegs.length * 70 + 12 + 14;
    }

    // ── Inclusions block (What's included in this booking) ─────────────
    // Builds a bullet list from vehicle_type + transfer_extras +
    // supplier_items so a "Diamond Package" picked from the supplier
    // catalogue surfaces here automatically. Only renders when there is
    // actually something to show (Hotels/Apartments typically skip it).
    // Vehicle is already shown in the booking detail rows above (Assigned
    // / Preferred Vehicle), so we deliberately exclude vehicle_type here
    // to avoid duplication. Inclusions list = extras + supplier items only.
    const inclusions: string[] = [];
    if (Array.isArray(b.transfer_extras)) {
      for (const e of b.transfer_extras) if (e?.name) inclusions.push(String(e.name));
    }
    if (Array.isArray(b.supplier_items)) {
      for (const s of b.supplier_items) {
        const nm = s?.product_name || s?.name;
        if (nm) inclusions.push(String(nm));
      }
    }
    if (inclusions.length > 0) {
      doc.fillColor(COLOR_GOLD).font("Helvetica-Bold").fontSize(11).text("INCLUSIONS", 50, y);
      y += 14;
      const incTop = y;
      const incH = inclusions.length * 14 + 16;
      doc.roundedRect(50, incTop, doc.page.width - 100, incH, 6).fill(COLOR_PANEL);
      y = incTop + 8;
      doc.fillColor(COLOR_TEXT).font("Helvetica").fontSize(10);
      for (const item of inclusions) {
        doc.text(`•  ${item}`, 64, y, { width: doc.page.width - 128 });
        y += 14;
      }
      y = incTop + incH + 12;
    }

    // ── Pricing block ──────────────────────────────────────────────────
    // Renders Subtotal + Discount + Total when the operator filled in
    // quoted_price + discount_amount; otherwise falls back to the simple
    // single-line layout. Discount line is green and shows the reason.
    doc.fillColor(COLOR_GOLD).font("Helvetica-Bold").fontSize(11).text("PRICING", 50, y);
    y += 16;
    const price = Number(b.price ?? 0);
    const extras = Array.isArray(b.extras) ? b.extras
                  : (typeof b.extras === "string" && b.extras ? [{ label: "Extras", amount: 0, note: b.extras }] : []);
    const extrasTotal = extras.reduce((s: number, e: any) => s + (Number(e?.amount) || 0), 0);
    const grand = price + extrasTotal;
    const quoted = Number(b.quoted_price ?? 0);
    const discount = Number(b.discount_amount ?? 0);
    const hasDiscount = quoted > 0 && discount > 0;

    const pTop = y;
    const baseRows = hasDiscount ? 2 : 1;             // Subtotal (+ Discount) OR Service price
    const pRows = baseRows + (extras.length > 0 ? 1 : 0) + 1; // + Extras + Total
    const pH = pRows * rowH + 22;
    doc.roundedRect(50, pTop, doc.page.width - 100, pH, 6).fill(COLOR_PANEL);
    y = pTop + 12;
    if (hasDiscount) {
      doc.fillColor(COLOR_MUTED).fontSize(10).font("Helvetica").text("Subtotal", 64, y);
      doc.fillColor(COLOR_TEXT).font("Helvetica-Bold").text(fmtMoney(quoted), 0, y, {
        align: "right", width: doc.page.width - 64,
      });
      y += rowH;
      const reason = b.discount_reason ? `Discount — ${String(b.discount_reason)}` : "Discount";
      doc.fillColor(COLOR_MUTED).font("Helvetica").text(reason, 64, y, { width: doc.page.width - 200 });
      // Use ASCII hyphen-minus instead of U+2212 — PDFKit's built-in
      // Helvetica is WinAnsi-encoded and renders the Unicode minus as a
      // garbled glyph (showed up as a stray quote in the discount line).
      doc.fillColor("#1a7a40").font("Helvetica-Bold").text(`-${fmtMoney(discount)}`, 0, y, {
        align: "right", width: doc.page.width - 64,
      });
      y += rowH;
    } else {
      doc.fillColor(COLOR_MUTED).fontSize(10).font("Helvetica").text("Service price", 64, y);
      doc.fillColor(COLOR_TEXT).font("Helvetica-Bold").text(fmtMoney(price), 0, y, {
        align: "right", width: doc.page.width - 64,
      });
      y += rowH;
    }
    if (extras.length > 0) {
      doc.fillColor(COLOR_MUTED).font("Helvetica").text("Extras", 64, y);
      doc.fillColor(COLOR_TEXT).font("Helvetica-Bold").text(fmtMoney(extrasTotal), 0, y, {
        align: "right", width: doc.page.width - 64,
      });
      y += rowH;
    }
    doc.moveTo(64, y + 2).lineTo(doc.page.width - 64, y + 2).strokeColor(COLOR_LINE).lineWidth(0.4).stroke();
    y += 8;
    doc.fillColor(COLOR_GOLD).font("Helvetica-Bold").fontSize(12).text("Total", 64, y);
    doc.fillColor(COLOR_GOLD).text(fmtMoney(grand), 0, y, {
      align: "right", width: doc.page.width - 64,
    });
    y = pTop + pH + 14;

    // ── Payment block ─────────────────────────────────────────────────
    // When the booking is Paid or Partial, render a structured panel with
    // the date paid, amount paid, method, and any payment notes. Falls back
    // to a simple status pill for Unpaid bookings.
    const ps = b.payment_status ?? "Unpaid";
    const pillColor = ps === "Paid" ? "#7ed957" : ps === "Partial" ? "#f4c542" : "#e26666";
    const paidAmount = Number(b.paid_amount ?? (ps === "Paid" ? grand : 0));
    const outstanding = Math.max(0, grand - paidAmount);
    const payRows: Array<[string, string]> = [["Status", ps]];
    if (b.payment_method)               payRows.push(["Method", String(b.payment_method)]);
    if (b.payment_date)                 payRows.push(["Date Paid", fmtDate(b.payment_date)]);
    if (paidAmount > 0)                 payRows.push(["Amount Paid", fmtMoney(paidAmount)]);
    if (ps !== "Paid" && outstanding>0) payRows.push(["Outstanding", fmtMoney(outstanding)]);
    if (b.payment_notes)                payRows.push(["Notes", String(b.payment_notes)]);

    const payTop = y;
    const payH = payRows.length * 18 + 30;
    doc.roundedRect(50, payTop, doc.page.width - 100, payH, 6).fill(COLOR_PANEL);
    doc.fillColor(COLOR_GOLD).font("Helvetica-Bold").fontSize(10).text("PAYMENT", 64, payTop + 10);
    // Status pill in the panel header (right-aligned)
    const pillText = ps;
    const pillW = doc.widthOfString(pillText) + 16;
    const pillX = doc.page.width - 50 - pillW - 14;
    doc.roundedRect(pillX, payTop + 8, pillW, 16, 8).fillAndStroke(pillColor, pillColor);
    doc.fillColor(COLOR_BG).font("Helvetica-Bold").fontSize(8).text(pillText, pillX + 8, payTop + 13);
    let py = payTop + 30;
    for (const [label, value] of payRows) {
      doc.fillColor(COLOR_MUTED).font("Helvetica").fontSize(9)
        .text(label.toUpperCase(), 64, py, { width: 130 });
      doc.fillColor(COLOR_TEXT).font("Helvetica-Bold").fontSize(10)
        .text(value, 200, py - 1, { width: doc.page.width - 250 });
      py += 18;
    }
    y = payTop + payH + 14;

    // PAID stamp — diagonal watermark over the pricing area when fully paid.
    if (ps === "Paid") {
      doc.save();
      doc.translate(doc.page.width - 150, 250);
      doc.rotate(-22);
      doc.lineWidth(3).strokeColor("#7ed957");
      doc.roundedRect(-50, -22, 130, 50, 6).stroke();
      doc.fillColor("#7ed957").font("Helvetica-Bold").fontSize(28).text("PAID", -38, -14);
      doc.fillColor("#7ed957").font("Helvetica").fontSize(7)
        .text(b.payment_date ? fmtDate(b.payment_date) : "Settled", -38, 18);
      doc.restore();
    }


    // ── Terms section ─────────────────────────────────────────────────
    if (y > doc.page.height - 200) {
      doc.addPage();
      doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLOR_BG);
      doc.rect(0, 0, doc.page.width, 6).fill(COLOR_GOLD);
      y = 60;
    }
    doc.fillColor(COLOR_GOLD).font("Helvetica-Bold").fontSize(11).text("TERMS & CONDITIONS", 50, y);
    y += 16;
    const terms = [
      "Cancellations within 24 hours of the service are charged in full. Earlier cancellations are reviewed case by case.",
      "Should your flight be delayed or rescheduled, our team monitor arrivals and adjust the pickup at no extra cost.",
      "All chauffeurs hold full PCO licences and our vehicles are insured for private hire.",
      "Waiting time after the standard complimentary period is charged in 15-minute increments at the published rate.",
      "Our team are reachable around the clock. For urgent assistance please reply to this confirmation or message us on WhatsApp.",
    ];
    doc.fillColor(COLOR_MUTED).font("Helvetica").fontSize(9);
    for (const line of terms) {
      doc.text(`•  ${line}`, 50, y, { width: doc.page.width - 100 });
      y = doc.y + 4;
    }
    y += 6;
    doc.fillColor(COLOR_GOLD_DIM).fontSize(9).font("Helvetica-Oblique")
      .text("It is our privilege to look after you. — Traveluxe London", 50, y, {
        width: doc.page.width - 100, align: "center",
      });

    // Stamp page numbers across all pages.
    const range = doc.bufferedPageRange();
    const total = range.count;
    for (let i = 0; i < total; i++) {
      doc.switchToPage(i);
      paintChrome(doc, i + 1, total);
    }

    doc.end();
  });
}

// ── Driver Job Sheet PDF ───────────────────────────────────────────────────
// Mirrors the on-screen Job Sheet (artifacts/traveluxe-os/src/pages/bookings/
// JobSheet.tsx). Strictly NO financials — drivers print/share this via
// WhatsApp and operators sometimes hand-print it. When the booking has extra
// vehicles whose pickup/drop-off/time deviate from the parent route, each
// car's leg is rendered explicitly so the wrong driver doesn't show up at
// the wrong pickup.
export function buildJobSheetPdf(
  b: any,
  client: any,
  driver: any,
  vehicleLegs: VehicleLeg[] = [],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLOR_BG);
    doc.rect(0, 0, doc.page.width, 6).fill(COLOR_GOLD);

    // Brand header
    doc.fillColor(COLOR_GOLD).font("Helvetica-Bold").fontSize(24)
      .text("TRAVELUXE", 50, 50, { continued: true })
      .fillColor(COLOR_TEXT).text(" LONDON");
    doc.fillColor(COLOR_MUTED).font("Helvetica").fontSize(9)
      .text("Driver Job Sheet · For driver use only", 50, 80);

    // Reference panel
    const refX = doc.page.width - 200, refY = 50;
    doc.roundedRect(refX, refY, 150, 56, 4).fill(COLOR_PANEL);
    doc.fillColor(COLOR_MUTED).fontSize(8).text("BOOKING REFERENCE", refX + 12, refY + 8);
    doc.fillColor(COLOR_GOLD).font("Helvetica-Bold").fontSize(16)
      .text(b.tvl_ref ?? "—", refX + 12, refY + 22);
    doc.fillColor(COLOR_MUTED).font("Helvetica").fontSize(8)
      .text(`Issued ${new Date().toLocaleDateString("en-GB")}`, refX + 12, refY + 44);

    doc.fillColor(COLOR_TEXT).font("Helvetica-Bold").fontSize(20)
      .text("Driver Job Sheet", 50, 130);
    doc.moveTo(50, 160).lineTo(doc.page.width - 50, 160).strokeColor(COLOR_GOLD).lineWidth(0.6).stroke();

    let y = 180;

    // Confidential notice — same wording as the on-screen sheet.
    doc.fillColor(COLOR_MUTED).font("Helvetica-Oblique").fontSize(8)
      .text("For driver use only — do not share with clients.", 50, y, {
        width: doc.page.width - 100, align: "center",
      });
    y += 18;

    // ── Booking detail rows (NO pricing, NO payment) ──────────────────
    const isAccom = b.service_type === "Hotel" || b.service_type === "Apartment";
    const rows: Array<[string, string]> = [];
    rows.push(["Service", b.service_type ?? "—"]);
    if (!isAccom) {
      rows.push(["Date & Time", fmtDateTime(b.date_time)]);
      if (b.flight_number) rows.push(["Flight", b.flight_number]);
      if (b.pickup)        rows.push(["Pickup", b.pickup]);
      if (b.dropoff || b.destination) {
        rows.push([b.destination ? "Destination" : "Drop-off", b.dropoff || b.destination]);
      }
      if (b.passengers != null) rows.push(["Passengers", String(b.passengers)]);
      if (b.luggage != null)    rows.push(["Luggage", String(b.luggage)]);
      const vehLine = [b.vehicle_model, b.vehicle_year ? `(${b.vehicle_year})` : null, b.plate ? `· ${b.plate}` : null]
        .filter(Boolean).join(" ");
      if (vehLine) rows.push(["Assigned Vehicle", vehLine]);
      else if (b.vehicle_type) rows.push(["Preferred Vehicle", b.vehicle_type]);
      rows.push(["Driver", driver?.name ?? b.driver_name ?? "—"]);
      if (b.nameboard) rows.push(["Meet & Greet Board", `"${b.nameboard}"`]);
    } else {
      if (b.hotel_name)     rows.push(["Hotel", b.hotel_name]);
      if (b.property_name)  rows.push(["Property", b.property_name]);
      if (b.check_in_date)  rows.push(["Check-in", fmtDate(b.check_in_date)]);
      if (b.check_out_date) rows.push(["Check-out", fmtDate(b.check_out_date)]);
    }
    if (b.client_name ?? client?.name) rows.push(["Client", b.client_name ?? client?.name]);

    const rowH = 22;
    const panelTop = y;
    const panelH = rows.length * rowH + 16;
    doc.roundedRect(50, panelTop, doc.page.width - 100, panelH, 6).fill(COLOR_PANEL);
    y = panelTop + 12;
    for (const [label, value] of rows) {
      doc.fillColor(COLOR_MUTED).font("Helvetica").fontSize(9)
        .text(label.toUpperCase(), 64, y, { width: 130 });
      doc.fillColor(COLOR_TEXT).font("Helvetica-Bold").fontSize(11)
        .text(value, 200, y - 1, { width: doc.page.width - 250 });
      y += rowH;
    }
    y = panelTop + panelH + 18;

    // ── Per-vehicle routes (multi-car bookings only) ───────────────────
    // Same shape as the booking confirmation PDF: header line uses the
    // "X of N cars on different routes" framing so drivers and operators
    // see consistent language across screen + print + WhatsApp.
    const overrideLegs = vehicleLegs.filter(v => v.is_override);
    if (!isAccom && vehicleLegs.length > 1) {
      const estH = 40 + vehicleLegs.length * 70;
      if (y + estH > doc.page.height - 80) {
        doc.addPage();
        doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLOR_BG);
        doc.rect(0, 0, doc.page.width, 6).fill(COLOR_GOLD);
        y = 60;
      }

      doc.fillColor(COLOR_GOLD).font("Helvetica-Bold").fontSize(11)
        .text(`DRIVERS (${vehicleLegs.length})`, 50, y);
      y += 16;

      if (overrideLegs.length > 0) {
        doc.fillColor(COLOR_MUTED).font("Helvetica-Oblique").fontSize(9)
          .text(
            `${overrideLegs.length} of ${vehicleLegs.length} cars on different routes — see per-leg pickup & time below.`,
            50, y, { width: doc.page.width - 100 },
          );
        y += 16;
      }

      const legW = doc.page.width - 100;
      const legsTop = y;
      doc.roundedRect(50, legsTop, legW, vehicleLegs.length * 70 + 12, 6).fill(COLOR_PANEL);
      let ly = legsTop + 12;

      for (const leg of vehicleLegs) {
        const heading = `Car #${leg.car_no}` +
          (leg.driver_name ? ` · ${leg.driver_name}` : " · Unassigned") +
          (leg.vehicle_type ? ` · ${leg.vehicle_type}` : "");
        doc.fillColor(COLOR_GOLD).font("Helvetica-Bold").fontSize(10)
          .text(heading, 64, ly, { width: legW - 28 });
        ly += 14;

        if (leg.is_override) {
          // Fall back to parent values for any field that wasn't overridden,
          // so each leg reads as a complete pickup instruction.
          const pickup  = leg.pickup  ?? b.pickup  ?? "—";
          const dropoff = leg.dropoff ?? b.dropoff ?? b.destination ?? "—";
          const when    = leg.date_time ?? b.date_time;

          doc.fillColor(COLOR_MUTED).font("Helvetica").fontSize(9)
            .text("Pickup:", 64, ly, { width: 60, continued: true })
            .fillColor(COLOR_TEXT).font("Helvetica-Bold")
            .text(` ${pickup}`, { width: legW - 80 });
          ly = doc.y + 2;
          doc.fillColor(COLOR_MUTED).font("Helvetica").fontSize(9)
            .text("Drop-off:", 64, ly, { width: 60, continued: true })
            .fillColor(COLOR_TEXT).font("Helvetica-Bold")
            .text(` ${dropoff}`, { width: legW - 80 });
          ly = doc.y + 2;
          if (when) {
            doc.fillColor(COLOR_MUTED).font("Helvetica").fontSize(9)
              .text("Pickup time:", 64, ly, { width: 70, continued: true })
              .fillColor(COLOR_TEXT).font("Helvetica-Bold")
              .text(` ${fmtDateTime(when)}`, { width: legW - 90 });
            ly = doc.y + 2;
          }
        } else {
          doc.fillColor(COLOR_MUTED).font("Helvetica-Oblique").fontSize(9)
            .text("Same route as primary booking above.", 64, ly, { width: legW - 28 });
          ly = doc.y + 2;
        }
        ly += 8;
      }
      y = legsTop + vehicleLegs.length * 70 + 12 + 14;
    }

    // ── Driver earnings panel ─────────────────────────────────────────
    // Driver-only money flow: what the driver receives in cash, what he
    // owes back to TVL as commission, and his net. NEVER includes the
    // client price, supplier cost, supplier commission, or TVL margin
    // (those are admin-only). Only renders when at least one figure is
    // set so legacy bookings stay clean.
    const dPay = Number((b as any).driver_cost ?? 0);
    const dComm = Number((b as any).tvl_commission ?? 0);
    if (!isAccom && (dPay > 0 || dComm > 0)) {
      const dNet = Math.max(0, dPay - dComm);
      if (y > doc.page.height - 160) {
        doc.addPage();
        doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLOR_BG);
        doc.rect(0, 0, doc.page.width, 6).fill(COLOR_GOLD);
        y = 60;
      }
      doc.fillColor(COLOR_GOLD).font("Helvetica-Bold").fontSize(11)
        .text("YOUR EARNINGS", 50, y);
      y += 16;
      const eTop = y;
      const eRows: Array<[string, string, string]> = [
        ["You earn", fmtMoney(dPay), COLOR_TEXT],
        ["Commission to TVL", `−${fmtMoney(dComm)}`, "#d97706"],
        ["Net (cash kept)", fmtMoney(dNet), "#15803d"],
      ];
      const eH = eRows.length * rowH + 24;
      doc.roundedRect(50, eTop, doc.page.width - 100, eH, 6).fill(COLOR_PANEL);
      let ey = eTop + 12;
      for (const [label, value, color] of eRows) {
        doc.fillColor(COLOR_MUTED).font("Helvetica").fontSize(10).text(label, 64, ey);
        doc.fillColor(color).font("Helvetica-Bold").fontSize(12).text(value, 0, ey - 1, {
          align: "right", width: doc.page.width - 64,
        });
        ey += rowH;
      }
      doc.fillColor(COLOR_MUTED).font("Helvetica-Oblique").fontSize(8)
        .text("Cash collected on the job. Pay TVL the commission at settlement.", 64, ey, {
          width: doc.page.width - 128,
        });
      y = eTop + eH + 14;
    }

    // ── Notes & special requests ──────────────────────────────────────
    const notes = b.special_requests || b.notes;
    if (notes) {
      if (y > doc.page.height - 140) {
        doc.addPage();
        doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLOR_BG);
        doc.rect(0, 0, doc.page.width, 6).fill(COLOR_GOLD);
        y = 60;
      }
      doc.fillColor(COLOR_GOLD).font("Helvetica-Bold").fontSize(11)
        .text("NOTES & SPECIAL REQUESTS", 50, y);
      y += 16;
      const nTop = y;
      doc.roundedRect(50, nTop, doc.page.width - 100, 0, 6); // placeholder
      doc.fillColor(COLOR_TEXT).font("Helvetica").fontSize(10)
        .text(String(notes), 64, nTop + 8, { width: doc.page.width - 128 });
      y = doc.y + 12;
    }

    // Stamp page numbers across all pages.
    const range = doc.bufferedPageRange();
    const total = range.count;
    for (let i = 0; i < total; i++) {
      doc.switchToPage(i);
      paintChrome(doc, i + 1, total);
    }

    doc.end();
  });
}

// ── Receipt PDF ────────────────────────────────────────────────────────────
// Compact one-page receipt for paid (or partially paid) bookings. Sent as a
// stand-alone document independently of the booking confirmation.
export function buildReceiptPdf(b: any, client: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLOR_BG);
    doc.rect(0, 0, doc.page.width, 6).fill(COLOR_GOLD);

    // Brand header
    doc.fillColor(COLOR_GOLD).font("Helvetica-Bold").fontSize(24)
      .text("TRAVELUXE", 50, 50, { continued: true })
      .fillColor(COLOR_TEXT).text(" LONDON");
    doc.fillColor(COLOR_MUTED).font("Helvetica").fontSize(9)
      .text("Private Concierge · Mayfair, London", 50, 80);

    // Reference panel
    const refX = doc.page.width - 200, refY = 50;
    doc.roundedRect(refX, refY, 150, 56, 4).fill(COLOR_PANEL);
    doc.fillColor(COLOR_MUTED).fontSize(8).text("RECEIPT FOR", refX + 12, refY + 8);
    doc.fillColor(COLOR_GOLD).font("Helvetica-Bold").fontSize(16)
      .text(b.tvl_ref ?? "—", refX + 12, refY + 22);
    doc.fillColor(COLOR_MUTED).font("Helvetica").fontSize(8)
      .text(`Issued ${new Date().toLocaleDateString("en-GB")}`, refX + 12, refY + 44);

    doc.fillColor(COLOR_TEXT).font("Helvetica-Bold").fontSize(20)
      .text("Payment Receipt", 50, 130);
    doc.moveTo(50, 160).lineTo(doc.page.width - 50, 160).strokeColor(COLOR_GOLD).lineWidth(0.6).stroke();

    let y = 180;
    doc.fillColor(COLOR_GOLD).font("Helvetica-Bold").fontSize(11).text("RECEIVED FROM", 50, y);
    y += 16;
    doc.fillColor(COLOR_TEXT).font("Helvetica-Bold").fontSize(14)
      .text(b.client_name ?? client?.name ?? "—", 50, y);
    y += 30;

    const price = Number(b.price ?? 0);
    const extras = Array.isArray(b.extras) ? b.extras : [];
    const extrasTotal = extras.reduce((s: number, e: any) => s + (Number(e?.amount) || 0), 0);
    const grand = price + extrasTotal;
    const ps = b.payment_status ?? "Unpaid";
    const paidAmount = Number(b.paid_amount ?? (ps === "Paid" ? grand : 0));
    const outstanding = Math.max(0, grand - paidAmount);

    // Subtotal + Discount lines render only when the operator filled in
    // quoted_price + discount_amount. The reason is appended for context.
    const quoted = Number(b.quoted_price ?? 0);
    const discount = Number(b.discount_amount ?? 0);
    const hasDiscount = quoted > 0 && discount > 0;
    const rows: Array<[string, string]> = [
      ["Service", b.service_type ?? "—"],
    ];
    if (hasDiscount) {
      rows.push(["Subtotal", fmtMoney(quoted)]);
      const reasonSuffix = b.discount_reason ? ` (${String(b.discount_reason)})` : "";
      rows.push([`Discount${reasonSuffix}`, `-${fmtMoney(discount)}`]);
    }
    rows.push(
      ["Booking Total", fmtMoney(grand)],
      ["Amount Paid", fmtMoney(paidAmount)],
      ["Method", b.payment_method ?? "—"],
      ["Date Paid", b.payment_date ? fmtDate(b.payment_date) : new Date().toLocaleDateString("en-GB")],
      ["Status", ps],
    );
    if (outstanding > 0) rows.push(["Outstanding", fmtMoney(outstanding)]);
    if (b.payment_notes) rows.push(["Notes", String(b.payment_notes)]);

    const rowH = 22;
    const panelTop = y;
    const panelH = rows.length * rowH + 16;
    doc.roundedRect(50, panelTop, doc.page.width - 100, panelH, 6).fill(COLOR_PANEL);
    y = panelTop + 12;
    for (const [label, value] of rows) {
      doc.fillColor(COLOR_MUTED).font("Helvetica").fontSize(9)
        .text(label.toUpperCase(), 64, y, { width: 130 });
      doc.fillColor(COLOR_TEXT).font("Helvetica-Bold").fontSize(11)
        .text(value, 200, y - 1, { width: doc.page.width - 250 });
      y += rowH;
    }
    y = panelTop + panelH + 22;

    // PAID stamp when fully paid
    if (ps === "Paid") {
      doc.save();
      doc.translate(doc.page.width - 170, 200);
      doc.rotate(-22);
      doc.lineWidth(3).strokeColor("#7ed957");
      doc.roundedRect(-50, -22, 140, 56, 6).stroke();
      doc.fillColor("#7ed957").font("Helvetica-Bold").fontSize(30).text("PAID", -32, -14);
      doc.restore();
    }

    doc.fillColor(COLOR_GOLD_DIM).fontSize(9).font("Helvetica-Oblique")
      .text("Thank you. — Traveluxe London", 50, y, {
        width: doc.page.width - 100, align: "center",
      });

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      paintChrome(doc, i + 1, range.count);
    }
    doc.end();
  });
}

router.get("/:id/job-sheet.pdf", async (req: Request, res: Response) => {
  const { id } = req.params;

  const { data: b, error } = await supabase
    .from("bookings").select("*").eq("id", id).single();
  if (error || !b) {
    console.warn("[job-sheet-pdf] booking lookup failed", id, error?.message);
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  let client: any = null;
  if ((b as any).client_id) {
    const { data } = await supabase
      .from("clients")
      .select("name, vip_tier, email, whatsapp, nationality")
      .eq("id", (b as any).client_id)
      .maybeSingle();
    client = data;
  }

  let driver: any = null;
  if ((b as any).driver_id) {
    const { data } = await supabase
      .from("drivers").select("*").eq("id", (b as any).driver_id).maybeSingle();
    driver = data;
  }

  // Same multi-vehicle roster shape as the confirmation PDF route — keeps
  // "X of N cars on different routes" totals in sync across both documents.
  const { data: vrows } = await supabase
    .from("booking_vehicles")
    .select("driver_id, vehicle_type, pickup, dropoff, date_time, drivers(name), created_at")
    .eq("booking_id", id)
    .order("created_at", { ascending: true });

  const vehicleLegs: VehicleLeg[] = [];
  vehicleLegs.push({
    car_no: 1,
    driver_name: driver?.name ?? (b as any).driver_name ?? null,
    vehicle_type: (b as any).vehicle_type ?? null,
    pickup: (b as any).pickup ?? null,
    dropoff: (b as any).dropoff ?? (b as any).destination ?? null,
    date_time: (b as any).date_time ?? null,
    is_override: false,
  });
  (vrows ?? []).forEach((row: any, idx: number) => {
    vehicleLegs.push({
      car_no: idx + 2,
      driver_name: row?.drivers?.name ?? null,
      vehicle_type: row?.vehicle_type ?? null,
      pickup: row?.pickup ?? null,
      dropoff: row?.dropoff ?? null,
      date_time: row?.date_time ?? null,
      is_override: !!(row?.pickup || row?.dropoff || row?.date_time),
    });
  });

  try {
    const buf = await buildJobSheetPdf(b, client, driver, vehicleLegs);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="traveluxe-jobsheet-${b.tvl_ref ?? id}.pdf"`);
    res.setHeader("Cache-Control", "no-store");
    res.end(buf);
  } catch (e: any) {
    console.error("[job-sheet-pdf]", e?.message);
    res.status(500).json({ error: "Failed to render job sheet PDF" });
  }
});

router.get("/:id/receipt.pdf", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { data: b, error } = await supabase
    .from("bookings").select("*").eq("id", id).single();
  if (error || !b) { res.status(404).json({ error: "Booking not found" }); return; }
  let client: any = null;
  if ((b as any).client_id) {
    const { data } = await supabase
      .from("clients").select("name, vip_tier, email, whatsapp")
      .eq("id", (b as any).client_id).maybeSingle();
    client = data;
  }
  try {
    const buf = await buildReceiptPdf(b, client);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="traveluxe-receipt-${b.tvl_ref ?? id}.pdf"`);
    res.setHeader("Cache-Control", "no-store");
    res.end(buf);
  } catch (e: any) {
    console.error("[receipt-pdf]", e?.message);
    res.status(500).json({ error: "Failed to render receipt" });
  }
});

router.get("/:id/confirmation.pdf", async (req: Request, res: Response) => {
  const { id } = req.params;

  // Fetch booking on its own — embedded joins fail silently if the FK alias
  // or selected columns don't exist, which previously surfaced as a 404.
  const { data: b, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !b) {
    console.warn("[booking-pdf] booking lookup failed", id, error?.message);
    res.status(404).json({ error: "Booking not found" });
    return;
  }

  let client: any = null;
  if ((b as any).client_id) {
    const { data } = await supabase
      .from("clients")
      .select("name, vip_tier, email, whatsapp, nationality")
      .eq("id", (b as any).client_id)
      .maybeSingle();
    client = data;
  }

  let driver: any = null;
  if ((b as any).driver_id) {
    const { data } = await supabase
      .from("drivers")
      .select("*")
      .eq("id", (b as any).driver_id)
      .maybeSingle();
    driver = data;
  }

  // Multi-vehicle roster — only the rows that actually deviate from the
  // parent route end up in the PDF. We always include the primary car as
  // car #1 so "X of N" totals match what the operator sees on the booking
  // detail screen.
  const { data: vrows } = await supabase
    .from("booking_vehicles")
    .select("driver_id, vehicle_type, pickup, dropoff, date_time, drivers(name), created_at")
    .eq("booking_id", id)
    .order("created_at", { ascending: true });

  const vehicleLegs: VehicleLeg[] = [];
  vehicleLegs.push({
    car_no: 1,
    driver_name: driver?.name ?? (b as any).driver_name ?? null,
    vehicle_type: (b as any).vehicle_type ?? null,
    pickup: (b as any).pickup ?? null,
    dropoff: (b as any).dropoff ?? (b as any).destination ?? null,
    date_time: (b as any).date_time ?? null,
    is_override: false, // primary is the baseline by definition
  });
  (vrows ?? []).forEach((row: any, idx: number) => {
    vehicleLegs.push({
      car_no: idx + 2,
      driver_name: row?.drivers?.name ?? null,
      vehicle_type: row?.vehicle_type ?? null,
      pickup: row?.pickup ?? null,
      dropoff: row?.dropoff ?? null,
      date_time: row?.date_time ?? null,
      is_override: !!(row?.pickup || row?.dropoff || row?.date_time),
    });
  });

  try {
    const buf = await buildPdf(b, client, driver, vehicleLegs);
    const filename = `traveluxe-${b.tvl_ref ?? id}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.end(buf);
  } catch (e: any) {
    console.error("[booking-pdf]", e?.message);
    res.status(500).json({ error: "Failed to render PDF" });
  }
});

export default router;
