import { Router } from "express";
import { supabase, auditLog, getUserFromToken } from "../lib/supabase";
import { logActivity } from "../lib/activity";
import { notifyByRoles, STAFF_ROLES } from "../services/notify";
import {
  sendConfirmationEmail,
  sendPaymentReceiptEmail,
  enrichBooking,
} from "./bookings";

const router = Router();

// Default payment terms: 30 days from invoice generation
const PAYMENT_TERMS_DAYS = 30;

/**
 * GET /invoices
 * Returns all invoices, automatically flipping Generated/Sent invoices to
 * Overdue if their due date (generated_at + 30 days) has passed.
 */
router.get("/", async (_req, res) => {
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .order("generated_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const invoices = data ?? [];
  const nowMs = Date.now();

  // Find invoices that should flip to Overdue.
  // Imported Odoo invoices (number contains "/", e.g. INV/2026/00001) are
  // historical records that have already been settled in the old system —
  // never auto-flip them, regardless of date.
  const overdueIds: string[] = invoices
    .filter(inv => {
      if (inv.status !== "Generated" && inv.status !== "Sent") return false;
      if (!inv.generated_at) return false;
      if (inv.invoice_number && String(inv.invoice_number).includes("/")) return false;
      const dueMs = new Date(inv.generated_at).getTime() + PAYMENT_TERMS_DAYS * 86_400_000;
      return nowMs > dueMs;
    })
    .map(inv => inv.id);

  if (overdueIds.length > 0) {
    await supabase
      .from("invoices")
      .update({ status: "Overdue" })
      .in("id", overdueIds);

    // Reflect the update in the response
    invoices.forEach(inv => {
      if (overdueIds.includes(inv.id)) inv.status = "Overdue";
    });
  }

  return res.json(invoices);
});

router.patch("/:id/status", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorised" });

  const { status } = req.body;
  const allowed = ["Generated", "Sent", "Paid", "Overdue", "Cancelled"];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${allowed.join(", ")}` });
  }

  const updates: Record<string, any> = { status };
  if (status === "Paid") updates.paid_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("invoices")
    .update(updates)
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // ── Sync the related booking so the job sheet stays in lock-step ─────────
  // The reverse direction (booking → invoice) already lives in PUT /bookings/:id.
  // Here we propagate invoice status changes back to the booking so an operator
  // can manage either side and see the other update automatically.
  if (data.booking_id) {
    const { data: booking } = await supabase
      .from("bookings")
      .select("status, payment_status, tvl_ref")
      .eq("id", data.booking_id)
      .single();

    const bookingPatch: Record<string, any> = {};

    if (status === "Paid") {
      if (booking?.payment_status !== "Paid") bookingPatch.payment_status = "Paid";
      // Auto-complete the job (unless it was already cancelled/completed)
      if (booking && booking.status !== "Cancelled" && booking.status !== "Completed") {
        bookingPatch.status = "Completed";
      }
    } else if (status === "Cancelled") {
      // Don't override a Completed booking — that would lose history.
      if (booking && booking.status !== "Completed" && booking.status !== "Cancelled") {
        bookingPatch.status = "Cancelled";
      }
    } else if (status === "Generated" || status === "Sent" || status === "Overdue") {
      // Invoice flipped back to unpaid → booking is no longer "Paid".
      if (booking?.payment_status === "Paid") bookingPatch.payment_status = "Unpaid";
    }

    // Was the booking *previously* unpaid? Captured BEFORE the patch goes in
    // so we can fire the receipt email exactly once per real transition.
    const wasNotPaid = booking?.payment_status !== "Paid";

    if (Object.keys(bookingPatch).length > 0) {
      const { error: syncErr } = await supabase
        .from("bookings")
        .update(bookingPatch)
        .eq("id", data.booking_id);
      if (syncErr) {
        // Surface the failure rather than silently leaving the two records out
        // of sync. The invoice update already committed, so the operator gets
        // a clear error and can retry; the audit log records the attempt.
        console.error("[Invoice→Booking sync] failed:", syncErr.message);
        await auditLog(
          "sync_booking_from_invoice_failed",
          "booking",
          data.booking_id,
          user.id,
          `Booking sync failed after invoice ${data.invoice_number} → ${status}: ${syncErr.message}`,
        );
        return res.status(500).json({
          error: `Invoice updated but failed to sync the related booking: ${syncErr.message}. Please refresh and update the booking manually.`,
          invoice: data,
        });
      }
      await auditLog(
        "sync_booking_from_invoice",
        "booking",
        data.booking_id,
        user.id,
        `Booking ${booking?.tvl_ref ?? ""} synced after invoice ${data.invoice_number} → ${status}: ${JSON.stringify(bookingPatch)}`,
      );
    }

    // ── Fire receipt email when an invoice flips to Paid via this route ───
    // The reverse path (PUT /bookings/:id with payment_status=Paid) already
    // fires the receipt. Without this branch, paying via the invoice screen
    // completed the booking but never sent the client a receipt.
    if (status === "Paid" && wasNotPaid) {
      const { data: bk } = await supabase
        .from("bookings")
        .select("*")
        .eq("id", data.booking_id)
        .single();
      if (bk) {
        const enriched = await enrichBooking(bk);
        sendPaymentReceiptEmail(enriched, { triggeredBy: user.id }).catch(err =>
          console.error("[Email] Receipt send error (invoice → Paid):", err?.message ?? err)
        );
      }
    }
  }

  await auditLog("update_invoice_status", "invoice", data.id, user.id,
    `Invoice ${data.invoice_number} marked as ${status}`);

  return res.json(data);
});

router.post("/generate", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { booking_id } = req.body;

  if (!booking_id) return res.status(400).json({ error: "booking_id is required" });

  // Check if invoice already exists
  const { data: existing } = await supabase
    .from("invoices")
    .select("*")
    .eq("booking_id", booking_id)
    .single();

  if (existing) {
    return res.json(existing);
  }

  const { data, error } = await supabase
    .from("invoices")
    .insert({ booking_id, generated_by: user?.id ?? null, status: "Generated" })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await auditLog("generate_invoice", "invoice", data.id, user?.id ?? null,
    `Invoice ${data.invoice_number} generated for booking ${booking_id}`);

  return res.status(201).json(data);
});

/**
 * POST /invoices/:id/send-email
 * Sends the invoice/booking confirmation to the client by email and flips
 * status to "Sent". Useful for imported (Odoo) invoices that never got emailed,
 * or for manual resend.
 */
router.post("/:id/send-email", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthorised" });

  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", req.params.id)
    .single();
  if (invErr || !invoice) return res.status(404).json({ error: "Invoice not found" });

  const { data: booking, error: bkErr } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", invoice.booking_id)
    .single();
  if (bkErr || !booking) return res.status(404).json({ error: "Booking not found" });

  const { data: client } = await supabase
    .from("clients")
    .select("name, email, vip_tier")
    .eq("id", booking.client_id)
    .single();

  const email = client?.email;

  // Route every manual send through the canonical sendBookingEmail pipeline
  // — including the no-email case — so the badge / audit trail stays
  // consistent. The helper itself writes a `skipped_no_email` row when `to`
  // is empty, which we surface back to the UI as a non-error 200 so the
  // toast can show a friendly "no email on file" message.
  const enriched = await enrichBooking(booking);
  const enrichedWithEmail: any = { ...enriched, client_email: email ?? null };

  // Paid → receipt; everything else → confirmation. Manual operator action,
  // so force=true to override de-dup.
  const sendResult =
    booking.payment_status === "Paid"
      ? await sendPaymentReceiptEmail(enrichedWithEmail, {
          triggeredBy: user.id,
          triggerSource: "manual",
          force: true,
        })
      : await sendConfirmationEmail(enrichedWithEmail, invoice.invoice_number, {
          triggeredBy: user.id,
          triggerSource: "manual",
          force: true,
        });

  if (sendResult.skipped && sendResult.reason === "no_email_on_file") {
    return res.json({
      ok: false,
      skipped: true,
      reason: "no_email_on_file",
      message: `No email on file for ${client?.name ?? "client"}. Add one on the client profile, then try again.`,
      invoice_number: invoice.invoice_number,
    });
  }

  if (!sendResult.sent) {
    return res.status(502).json({
      error: `Failed to send email: ${sendResult.reason ?? "unknown"}`,
    });
  }

  // Flip Generated → Sent (don't downgrade Paid/Overdue)
  if (invoice.status === "Generated") {
    await supabase.from("invoices").update({ status: "Sent" }).eq("id", invoice.id);
  }

  await auditLog("send_invoice_email", "invoice", invoice.id, user.id,
    `Invoice ${invoice.invoice_number} emailed to ${email}`);

  return res.json({ ok: true, sent_to: email, invoice_number: invoice.invoice_number });
});

// ── Hard delete an invoice ──────────────────────────────────────────────────
// Admin or Super Admin only. Snapshot is captured into the audit log before
// deletion (immutable forensic record), an entry is written to the operator
// activity feed, and an in-app notification is broadcast to all staff so
// deletions can't happen quietly. The booking the invoice was linked to is
// untouched — only the invoice row is removed.
router.delete("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  if (!user || !["admin", "super_admin"].includes(user.role)) {
    return res.status(403).json({ error: "Only Admin or Super Admin can delete invoices" });
  }
  const id = req.params.id;

  const { data: inv } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", id)
    .single();
  if (!inv) return res.status(404).json({ error: "Invoice not found" });

  const { error: delErr } = await supabase.from("invoices").delete().eq("id", id);
  if (delErr) return res.status(400).json({ error: delErr.message });

  const summary = `Invoice ${inv.invoice_number ?? id} permanently deleted by ${user.name ?? user.email ?? user.id} (${user.role}). ` +
    `Booking: ${inv.booking_id ?? "—"} · Amount: £${inv.total_amount ?? inv.amount ?? 0} · Status was: ${inv.status ?? "—"}`;

  await auditLog(
    "delete_invoice",
    "invoice",
    id,
    user.id,
    `${summary}\n--- SNAPSHOT ---\n${JSON.stringify(inv)}`,
  );

  await logActivity({
    action_type: "invoice_deleted",
    description: summary,
    entity_type: "invoice",
    entity_id: id,
    entity_label: inv.invoice_number ?? null,
    operator_id: user.id,
    operator_name: user.name ?? user.email ?? null,
  });

  // Suppressed when ?silent=1 — bulk-delete fan-out emits one aggregated
  // "N invoices deleted" via /api/notifications/broadcast-staff instead.
  if (req.query.silent !== "1") {
    notifyByRoles(STAFF_ROLES, {
      type: "booking_cancelled",
      title: "Invoice Deleted",
      message: `${inv.invoice_number ?? id} — deleted by ${user.name ?? user.email ?? "admin"}`,
      link: `/invoices`,
      entityType: "invoice",
      entityId: id,
      severity: "warning",
    }).catch(() => {});
  }

  return res.json({ ok: true, id, invoice_number: inv.invoice_number });
});

export default router;
