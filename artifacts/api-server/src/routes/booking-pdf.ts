import { Router, type IRouter, type Request, type Response } from "express";
import PDFDocument from "pdfkit";
import { supabase } from "../lib/supabase";

const router: IRouter = Router();

// Brand palette — keep in sync with the Traveluxe OS dark + gold theme.
const COLOR_BG       = "#0b0b0b";
const COLOR_PANEL    = "#141414";
const COLOR_GOLD     = "#c9a961";
const COLOR_GOLD_DIM = "#8a7340";
const COLOR_TEXT     = "#f5f5f5";
const COLOR_MUTED    = "#9a9a9a";
const COLOR_LINE     = "#2a2a2a";

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
  });
}

// Render the dark luxury background + brand header on every page.
function paintChrome(doc: any, pageNum: number, total: number) {
  doc.save();
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLOR_BG);
  // Top gold bar
  doc.rect(0, 0, doc.page.width, 6).fill(COLOR_GOLD);
  // Footer
  doc.fillColor(COLOR_MUTED).fontSize(8)
    .text(`Traveluxe London · Mayfair · info@traveluxelondon.com`, 50, doc.page.height - 40, {
      width: doc.page.width - 100, align: "left",
    });
  doc.fillColor(COLOR_GOLD_DIM).fontSize(8)
    .text(`Page ${pageNum} of ${total}`, 50, doc.page.height - 40, {
      width: doc.page.width - 100, align: "right",
    });
  doc.restore();
}

function buildPdf(b: any, client: any, driver: any): Promise<Buffer> {
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

    // ── Pricing block ──────────────────────────────────────────────────
    doc.fillColor(COLOR_GOLD).font("Helvetica-Bold").fontSize(11).text("PRICING", 50, y);
    y += 16;
    const price = Number(b.price ?? 0);
    const extras = Array.isArray(b.extras) ? b.extras
                  : (typeof b.extras === "string" && b.extras ? [{ label: "Extras", amount: 0, note: b.extras }] : []);
    const extrasTotal = extras.reduce((s: number, e: any) => s + (Number(e?.amount) || 0), 0);
    const grand = price + extrasTotal;

    const pTop = y;
    const pRows = 1 + (extras.length > 0 ? 1 : 0) + 1;
    const pH = pRows * rowH + 22;
    doc.roundedRect(50, pTop, doc.page.width - 100, pH, 6).fill(COLOR_PANEL);
    y = pTop + 12;
    doc.fillColor(COLOR_MUTED).fontSize(10).font("Helvetica").text("Service price", 64, y);
    doc.fillColor(COLOR_TEXT).font("Helvetica-Bold").text(fmtMoney(price), 0, y, {
      align: "right", width: doc.page.width - 64,
    });
    y += rowH;
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

    // Payment status pill
    const ps = b.payment_status ?? "Unpaid";
    const pillColor = ps === "Paid" ? "#7ed957" : ps === "Partial" ? "#f4c542" : "#e26666";
    const pillText = `Payment: ${ps}`;
    const pillW = doc.widthOfString(pillText) + 18;
    doc.roundedRect(50, y, pillW, 18, 9).fillAndStroke(pillColor, pillColor);
    doc.fillColor(COLOR_BG).font("Helvetica-Bold").fontSize(9).text(pillText, 59, y + 5);
    y += 36;

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

  try {
    const buf = await buildPdf(b, client, driver);
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
