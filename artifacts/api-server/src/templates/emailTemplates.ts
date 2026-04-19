import { format } from "date-fns";

const BRAND_GOLD = "#C9A84C";
const BRAND_DARK = "#111111";

/** Escape user-supplied text before interpolating into HTML to prevent injection. */
function esc(value: string | null | undefined): string {
  if (!value) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function baseLayout(content: string, preheader: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Traveluxe London</title>
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
  <style>
    body { margin:0; padding:0; background:#f4f4f4; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; color:#333; }
    a { color:${BRAND_GOLD}; text-decoration:none; }
    .wrapper { width:100%; background:#f4f4f4; padding:24px 0; }
    .container { max-width:600px; margin:0 auto; background:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.08); }
    .header { background:${BRAND_DARK}; padding:32px 40px; text-align:center; }
    .header-logo { font-size:22px; font-weight:700; letter-spacing:4px; text-transform:uppercase; color:#fff; }
    .header-sub { font-size:11px; color:rgba(255,255,255,0.5); letter-spacing:2px; margin-top:4px; text-transform:uppercase; }
    .gold-bar { height:3px; background:${BRAND_GOLD}; }
    .body { padding:40px; }
    .greeting { font-size:22px; font-weight:700; color:${BRAND_DARK}; margin-bottom:8px; }
    .intro { font-size:15px; color:#555; line-height:1.6; margin-bottom:28px; }
    .ref-badge { display:inline-block; background:#f8f3e8; border:1px solid ${BRAND_GOLD}; border-radius:6px; padding:8px 20px; font-family:monospace; font-size:18px; font-weight:700; color:${BRAND_GOLD}; margin-bottom:28px; }
    .section-title { font-size:11px; text-transform:uppercase; letter-spacing:2px; color:#999; margin-bottom:12px; border-top:1px solid #eee; padding-top:20px; }
    .detail-grid { width:100%; border-collapse:collapse; margin-bottom:4px; }
    .detail-grid td { padding:8px 0; font-size:14px; vertical-align:top; border-bottom:1px solid #f0f0f0; }
    .detail-label { color:#888; width:38%; }
    .detail-value { color:${BRAND_DARK}; font-weight:600; }
    .price-box { background:#f8f3e8; border-left:4px solid ${BRAND_GOLD}; padding:16px 20px; border-radius:0 6px 6px 0; margin:24px 0; }
    .price-label { font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#888; margin-bottom:4px; }
    .price-amount { font-size:28px; font-weight:700; color:${BRAND_GOLD}; }
    .paid-badge { display:inline-block; background:#e8f8ee; border:1px solid #52c97d; color:#1a7a40; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1px; padding:4px 14px; border-radius:20px; margin-left:12px; vertical-align:middle; }
    .note-box { background:#fffdf7; border:1px solid #f0e8cc; border-radius:6px; padding:14px 18px; font-size:13px; color:#666; line-height:1.6; margin:20px 0; }
    .cta { text-align:center; margin:32px 0; }
    .cta a { display:inline-block; background:${BRAND_GOLD}; color:#fff !important; font-weight:700; font-size:14px; padding:14px 36px; border-radius:6px; letter-spacing:0.5px; }
    .footer { background:#f9f9f9; border-top:1px solid #eee; padding:24px 40px; text-align:center; }
    .footer p { font-size:12px; color:#aaa; margin:4px 0; line-height:1.7; }
    .footer a { color:#aaa; }
  </style>
</head>
<body>
  <div style="display:none;max-height:0;overflow:hidden">${preheader}</div>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <div class="header-logo">TRAVELUXE</div>
        <div class="header-sub">Mayfair, London</div>
      </div>
      <div class="gold-bar"></div>
      <div class="body">
        ${content}
      </div>
      <div class="footer">
        <p style="background:#fff8e6;border:1px solid #e9d77a;border-radius:4px;padding:10px 14px;color:#5a4a10;font-size:12px;margin:0 0 14px 0">
          <strong>Please do not reply to this email.</strong> This mailbox is unattended.<br>
          For all enquiries, replies, or changes, please contact us at
          <a href="mailto:info@traveluxelondon.com" style="color:#5a4a10;font-weight:600">info@traveluxelondon.com</a>.
        </p>
        <p><strong style="color:#555">Traveluxe London</strong> &nbsp;·&nbsp; Mayfair, London</p>
        <p>Luxury Chauffeur &amp; Travel Concierge</p>
        <p><a href="mailto:info@traveluxelondon.com">info@traveluxelondon.com</a></p>
        <p style="margin-top:12px;font-size:11px">This email was sent by Traveluxe OS on behalf of your concierge team.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function row(label: string, value: string | null | undefined): string {
  if (!value) return "";
  return `<tr>
    <td class="detail-label">${label}</td>
    <td class="detail-value">${value}</td>
  </tr>`;
}

function formatDateTime(dt: string | null | undefined): string {
  if (!dt) return "—";
  try { return format(new Date(dt), "EEEE d MMMM yyyy 'at' HH:mm"); } catch { return dt; }
}

function formatDate(dt: string | null | undefined): string {
  if (!dt) return "—";
  try { return format(new Date(dt), "d MMMM yyyy"); } catch { return dt; }
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOKING CONFIRMATION
// ─────────────────────────────────────────────────────────────────────────────
export function bookingConfirmationHtml(booking: any, invoiceNumber?: string): string {
  const clientName = booking.client_name || booking.clients?.name || "Valued Guest";
  const firstName = esc(clientName.split(" ")[0]);
  const svc = booking.service_type;
  const isAirport = svc === "Airport Transfer";
  const isTour = svc === "Tour";
  const isAsDirected = svc === "As Directed";
  const isHotel = svc === "Hotel";
  const isApartment = svc === "Apartment";
  const isTransport = isAirport || isTour || isAsDirected;

  // Build the per-service-type details block.
  // Hotel & Apartment bookings MUST NOT show driver, vehicle or name board —
  // those are only relevant to chauffeur-driven services.
  let detailsRows = "";
  if (isAirport) {
    detailsRows = `
      ${row("Service", esc(svc))}
      ${row("Date &amp; Time", formatDateTime(booking.date_time))}
      ${booking.direction ? row("Direction", esc(booking.direction)) : ""}
      ${booking.flight_number ? row("Flight", esc(booking.flight_number)) : ""}
      ${booking.pickup ? row("Pickup", esc(booking.pickup)) : ""}
      ${booking.dropoff || booking.destination ? row("Drop-off", esc(booking.dropoff || booking.destination)) : ""}
      ${booking.passengers ? row("Passengers", esc(String(booking.passengers))) : ""}
      ${booking.luggage ? row("Luggage", esc(booking.luggage)) : ""}
      ${booking.vehicle_type ? row("Vehicle", esc(booking.vehicle_type)) : ""}
      ${booking.nameboard ? row("Name Board", `<em>&ldquo;${esc(booking.nameboard)}&rdquo;</em>`) : ""}
    `;
  } else if (isTour) {
    detailsRows = `
      ${row("Service", esc(svc))}
      ${row("Date &amp; Time", formatDateTime(booking.date_time))}
      ${booking.tour_name ? row("Tour", esc(booking.tour_name)) : ""}
      ${booking.meeting_point ? row("Meeting Point", esc(booking.meeting_point)) : ""}
      ${booking.pickup ? row("Pickup", esc(booking.pickup)) : ""}
      ${booking.destination ? row("Destination", esc(booking.destination)) : ""}
      ${booking.guide_included ? row("Guide", "Included") : ""}
      ${booking.itinerary ? row("Itinerary", `<span style="white-space:pre-line">${esc(booking.itinerary)}</span>`) : ""}
      ${booking.passengers ? row("Passengers", esc(String(booking.passengers))) : ""}
      ${booking.vehicle_type ? row("Vehicle", esc(booking.vehicle_type)) : ""}
    `;
  } else if (isAsDirected) {
    detailsRows = `
      ${row("Service", esc(svc))}
      ${row("Date &amp; Start Time", formatDateTime(booking.date_time))}
      ${booking.duration ? row("Duration", esc(String(booking.duration))) : ""}
      ${booking.pickup ? row("Pickup", esc(booking.pickup)) : ""}
      ${booking.passengers ? row("Passengers", esc(String(booking.passengers))) : ""}
      ${booking.vehicle_type ? row("Vehicle", esc(booking.vehicle_type)) : ""}
    `;
  } else if (isHotel) {
    // Hotel booking reference is critical — render it prominently right after
    // the hotel name with bold gold styling so the guest can quote it at check-in.
    const refRow = booking.hotel_booking_ref ? `<tr>
      <td class="detail-label">Booking Reference</td>
      <td class="detail-value" style="color:${BRAND_GOLD};font-family:monospace;font-size:16px;font-weight:700">${esc(booking.hotel_booking_ref)}</td>
    </tr>` : "";
    detailsRows = `
      ${row("Service", esc(svc))}
      ${booking.hotel_name ? row("Hotel", esc(booking.hotel_name)) : ""}
      ${refRow}
      ${booking.room_type ? row("Room", esc(booking.room_type)) : ""}
      ${booking.check_in_date ? row("Check-in", formatDateTime(booking.check_in_date)) : ""}
      ${booking.check_out_date ? row("Check-out", formatDateTime(booking.check_out_date)) : ""}
      ${booking.num_nights ? row("Nights", esc(String(booking.num_nights))) : ""}
      ${booking.num_guests ? row("Guests", esc(String(booking.num_guests))) : ""}
      ${booking.breakfast_included ? row("Breakfast", "Included") : ""}
    `;
  } else if (isApartment) {
    detailsRows = `
      ${row("Service", esc(svc))}
      ${booking.property_name ? row("Property", esc(booking.property_name)) : ""}
      ${booking.property_address ? row("Address", esc(booking.property_address)) : ""}
      ${booking.check_in_date ? row("Check-in", formatDateTime(booking.check_in_date)) : ""}
      ${booking.check_out_date ? row("Check-out", formatDateTime(booking.check_out_date)) : ""}
      ${booking.nights ? row("Nights", esc(String(booking.nights))) : ""}
      ${booking.property_contact ? row("Contact", esc(booking.property_contact)) : ""}
    `;
  } else {
    // Fallback — minimal safe details
    detailsRows = `
      ${row("Service", esc(svc))}
      ${row("Date &amp; Time", formatDateTime(booking.date_time))}
    `;
  }

  // Driver section — ONLY for transport service types and only when assigned.
  const driverSection = isTransport && booking.driver_name ? `
    <div class="section-title">Your Driver</div>
    <table class="detail-grid">
      ${row("Driver", esc(booking.driver_name))}
      ${booking.driver_staff_no ? row("Staff Number", `<span style="font-family:monospace;color:${BRAND_GOLD};font-weight:700">${esc(booking.driver_staff_no)}</span>`) : ""}
      ${booking.vehicle_type ? row("Vehicle", esc(booking.vehicle_type)) : ""}
    </table>
    <p style="font-size:13px;color:#666;margin-top:8px">
      Your driver will meet you at the agreed location. A Traveluxe representative will be in touch
      with any updates closer to your journey.
    </p>` : "";

  const content = `
    <div class="greeting">Dear ${firstName},</div>
    <p class="intro">
      Thank you for choosing Traveluxe London. Your booking has been confirmed and our team
      is ready to ensure an exceptional experience for you.
    </p>

    ${booking.tvl_ref ? `<div class="ref-badge">${esc(booking.tvl_ref)}</div>` : ""}

    <div class="section-title">Booking Details</div>
    <table class="detail-grid">
      ${detailsRows}
    </table>

    ${driverSection}

    <div class="price-box">
      <div class="price-label">Total Amount</div>
      <div class="price-amount">£${Number(booking.price || 0).toLocaleString()}</div>
      ${booking.payment_method ? `<div style="font-size:12px;color:#888;margin-top:4px">Payment: ${esc(booking.payment_method)}</div>` : ""}
    </div>

    ${invoiceNumber ? `<p style="font-size:13px;color:#888">Invoice reference: <strong style="color:#333;font-family:monospace">${esc(invoiceNumber)}</strong></p>` : ""}

    ${booking.notes ? `
    <div class="note-box">
      <strong>Notes from your concierge:</strong><br>${esc(booking.notes)}
    </div>` : ""}

    <p style="font-size:14px;color:#555;line-height:1.7;margin-top:20px">
      If you have any questions or need to make any changes, please contact your dedicated concierge
      immediately. We look forward to serving you.
    </p>
    <p style="font-size:14px;color:#555">Warm regards,<br><strong style="color:#333">The Traveluxe Team</strong></p>
  `;

  return baseLayout(content, `Your Traveluxe booking ${booking.tvl_ref || ""} is confirmed — ${booking.service_type} on ${formatDate(booking.date_time)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT RECEIPT
// ─────────────────────────────────────────────────────────────────────────────
export function paymentReceiptHtml(booking: any, invoiceNumber?: string): string {
  const clientName = booking.client_name || booking.clients?.name || "Valued Guest";
  const firstName = esc(clientName.split(" ")[0]);

  const content = `
    <div class="greeting">Dear ${firstName},</div>
    <p class="intro">
      We have received your payment in full. Thank you for choosing Traveluxe London —
      your account is now settled.
    </p>

    ${booking.tvl_ref ? `<div class="ref-badge">${esc(booking.tvl_ref)} <span class="paid-badge">Paid</span></div>` : ""}

    <div class="section-title">Payment Summary</div>
    <table class="detail-grid">
      ${row("Service", esc(booking.service_type))}
      ${row("Date", formatDateTime(booking.date_time))}
      ${row("Payment Method", esc(booking.payment_method || "—"))}
      ${row("Payment Date", formatDate(new Date().toISOString()))}
      ${invoiceNumber ? row("Invoice", esc(invoiceNumber)) : ""}
    </table>

    <div class="price-box">
      <div class="price-label">Amount Received</div>
      <div class="price-amount">£${Number(booking.price || 0).toLocaleString()}</div>
      <div style="font-size:12px;color:#1a7a40;font-weight:600;margin-top:6px">Payment confirmed</div>
    </div>

    <p style="font-size:14px;color:#555;line-height:1.7;margin-top:20px">
      This email serves as your payment receipt. Please retain it for your records.
      Should you require a formal VAT invoice or have any queries, do not hesitate to contact us.
    </p>

    <p style="font-size:14px;color:#555">
      We look forward to welcoming you again.<br>
      <strong style="color:#333">The Traveluxe Team</strong>
    </p>
  `;

  return baseLayout(content, `Payment received for your Traveluxe booking ${booking.tvl_ref || ""} — £${Number(booking.price || 0).toLocaleString()}`);
}
