import { Router } from "express";
import { supabase, auditLog, getUserFromToken } from "../lib/supabase";
import { notifyByRoles, STAFF_ROLES } from "../services/notify";

const router = Router();

const VALID_STATUS = ["New","Following Up","Ready to Book","Converted","Declined","Expired","Cancelled"];
const VALID_PRIORITY = ["Low","Medium","High","Urgent"];
const VALID_SERVICE = ["Airport Transfer","Tour","Car Rental","Apartment","Hotel","Other"];

// GET /api/requests?status=&priority=&client_id=&search=&sort=
router.get("/", async (req, res) => {
  const { status, priority, client_id, search, sort } = req.query;
  let query = supabase
    .from("requests")
    .select("*, clients(name, whatsapp)");

  if (status) query = query.eq("status", String(status));
  if (priority) query = query.eq("priority", String(priority));
  if (client_id) query = query.eq("client_id", String(client_id));
  if (search) {
    const s = String(search);
    query = query.or(`client_name.ilike.%${s}%,notes.ilike.%${s}%`);
  }

  // Default sort: follow-up date ascending (most urgent first)
  const sortKey = sort === "created" ? "created_at" : "follow_up_date";
  const ascending = sort !== "created";
  query = query.order(sortKey, { ascending });

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Auto-expire requests whose follow_up_date is more than 7 days past and
  // status is still New/Following Up
  const today = new Date().toISOString().slice(0, 10);
  const expiredIds = (data ?? [])
    .filter((r: any) => ["New","Following Up"].includes(r.status))
    .filter((r: any) => {
      if (!r.follow_up_date) return false;
      const diff = (Date.parse(today) - Date.parse(r.follow_up_date)) / (1000 * 60 * 60 * 24);
      return diff > 7;
    })
    .map((r: any) => r.id);

  if (expiredIds.length > 0) {
    await supabase.from("requests").update({ status: "Expired" }).in("id", expiredIds);
  }

  const requests = (data ?? []).map((r: any) => ({
    ...r,
    client_name: r.clients?.name ?? r.client_name,
    // Prefer the linked client profile's whatsapp; fall back to the value
    // captured at request creation (stored in details.client_whatsapp for
    // typed-lead requests that have no client_id yet). Mirrors the detail
    // endpoint so the requests list can render a WhatsApp action button.
    client_whatsapp:
      r.clients?.whatsapp ?? (r.details as any)?.client_whatsapp ?? null,
    clients: undefined,
    status: expiredIds.includes(r.id) ? "Expired" : r.status,
  }));

  return res.json(requests);
});

router.post("/", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);

  const body = req.body || {};
  if (!VALID_SERVICE.includes(body.service_type)) {
    return res.status(400).json({ error: "Invalid service_type" });
  }
  if (body.priority && !VALID_PRIORITY.includes(body.priority)) {
    return res.status(400).json({ error: "Invalid priority" });
  }
  if (body.status && !VALID_STATUS.includes(body.status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  if (!body.follow_up_date) {
    return res.status(400).json({ error: "follow_up_date is required" });
  }

  const { data, error } = await supabase
    .from("requests")
    .insert({ ...body, created_by: user?.id ?? null })
    .select("*, clients(name)")
    .single();

  if (error) return res.status(400).json({ error: error.message });
  await auditLog(
    "create_request", "request", data.id, user?.id ?? null,
    `Created request for ${data.clients?.name ?? data.client_name ?? "client"}`
  );

  // Fix — bell notification when a new request lands. Goes to staff because
  // any operator may pick it up. dedupe_key prevents double-fires from retries.
  {
    const clientName = data.clients?.name ?? data.client_name ?? "client";
    notifyByRoles(STAFF_ROLES, {
      type: "request_new",
      title: "New Request",
      message: `${data.service_type ?? "Request"} · ${clientName}`,
      link: `/requests/${data.id}`,
      entityType: "request",
      entityId: data.id,
      severity: data.priority === "urgent" ? "urgent" : "info",
      dedupeKey: `request_new:${data.id}`,
    }).catch(() => {});
  }

  return res.status(201).json({
    ...data,
    client_name: data.clients?.name ?? data.client_name,
    clients: undefined,
  });
});

router.get("/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("requests")
    .select("*, clients(name, whatsapp, email)")
    .eq("id", req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: "Request not found" });

  // Hydrate the cancelling operator's display name + email so the banner
  // on /requests/:id can show "Cancelled by Sara A." with an email tooltip.
  // Read-only, optional join — falls back to nulls when the actor row is
  // missing (e.g. legacy cancellations from before cancelled_by existed).
  //
  // Privacy gate: routes/users.ts has two distinct deactivation flows —
  // `deactivate` keeps the real email but flips active=false, while `remove`
  // also overwrites email with a safe placeholder + name="[removed]". We
  // null out cancelled_by_email for any actor with active=false so a merely-
  // deactivated operator's address is never leaked through the attribution.
  // The display name is still safe to show (it's their real name or
  // "[removed]" — never a leaked email).
  let cancelled_by_name: string | null = null;
  let cancelled_by_email: string | null = null;
  if ((data as any).cancelled_by) {
    const { data: actor } = await supabase
      .from("users")
      .select("name, email, active")
      .eq("id", (data as any).cancelled_by)
      .maybeSingle();
    if (actor) {
      cancelled_by_name = (actor as any).name ?? null;
      cancelled_by_email = (actor as any).active === false
        ? null
        : (actor as any).email ?? null;
    }
  }

  return res.json({
    ...data,
    client_name: data.clients?.name ?? data.client_name,
    client_whatsapp: data.clients?.whatsapp ?? null,
    client_email: data.clients?.email ?? null,
    cancelled_by_name,
    cancelled_by_email,
    clients: undefined,
  });
});

router.put("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const body = req.body || {};
  if (body.status && !VALID_STATUS.includes(body.status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  if (body.priority && !VALID_PRIORITY.includes(body.priority)) {
    return res.status(400).json({ error: "Invalid priority" });
  }
  if (body.service_type && !VALID_SERVICE.includes(body.service_type)) {
    return res.status(400).json({ error: "Invalid service_type" });
  }

  // Cancelling a request requires a reason — same contract as follow-ups so
  // the dashboard / finance reports can always surface the why behind a lost
  // lead. Stamps cancelled_at + cancelled_by automatically.
  if (body.status === "Cancelled") {
    const reason = (body.cancellation_reason ?? "").toString().trim();
    if (!reason) {
      return res.status(400).json({ error: "cancellation_reason is required when cancelling a request" });
    }
    body.cancellation_reason = reason;
    body.cancelled_at = new Date().toISOString();
    body.cancelled_by = user?.id ?? null;
  }

  // Status-transition handling for previously Cancelled rows.
  // Cancelled is intended as a near-terminal state — the only legal way out
  // is via the explicit "Re-open" action which sends status="New". This
  // also gives us a hook to (a) reject accidental Cancelled→FollowingUp /
  // Quoted / Booked transitions from the generic edit form and (b) append
  // an audit line to notes when the row actually goes Cancelled→New.
  // cancellation_reason / cancelled_at are preserved either way so the
  // Lost-Leads rollup still attributes the original loss correctly.
  let reopenAuditMsg: string | null = null;
  if (body.status && body.status !== "Cancelled") {
    const { data: existing } = await supabase
      .from("requests")
      .select("status, cancellation_reason, notes")
      .eq("id", req.params.id)
      .single();
    if (existing && existing.status === "Cancelled") {
      if (body.status !== "New") {
        return res.status(400).json({
          error: "Cancelled requests can only be re-opened to status 'New'. Use the Re-open action.",
        });
      }
      const stamp = new Date().toLocaleString("en-GB", {
        timeZone: "Europe/London",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
      const wasReason = (existing.cancellation_reason ?? "").toString().trim() || "Unspecified";
      const auditLine = `Re-opened (${stamp}) — was cancelled for: ${wasReason}`;
      const existingNotes = (existing.notes ?? "").toString().trim();
      body.notes = existingNotes ? `${existingNotes}\n\n${auditLine}` : auditLine;
      reopenAuditMsg = auditLine;
    }
  }

  const { data, error } = await supabase
    .from("requests")
    .update(body)
    .eq("id", req.params.id)
    .select("*, clients(name)")
    .single();

  if (error) return res.status(400).json({ error: error.message });
  await auditLog(
    "update_request", "request", req.params.id, user?.id ?? null,
    body.status === "Cancelled"
      ? `Request cancelled — ${body.cancellation_reason}`
      : reopenAuditMsg
        ? reopenAuditMsg
        : "Request updated",
  );
  return res.json({
    ...data,
    client_name: data.clients?.name ?? data.client_name,
    clients: undefined,
  });
});

router.delete("/:id", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { error } = await supabase
    .from("requests")
    .delete()
    .eq("id", req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  await auditLog("delete_request", "request", req.params.id, user?.id ?? null, "Request deleted");
  return res.json({ ok: true });
});

// Convert request → returns prefilled draft used by the booking form.
// Marks the request as Ready to Book until an actual booking is created
// (the booking form then PUTs status=Converted with converted_booking_id).
router.post("/:id/convert", async (req, res) => {
  const user = await getUserFromToken(req.headers.authorization);
  const { data: r, error } = await supabase
    .from("requests")
    .select("*, clients(name, whatsapp)")
    .eq("id", req.params.id)
    .single();

  if (error || !r) return res.status(404).json({ error: "Request not found" });

  // If the request was logged without a client_id (e.g. typed in by name
  // before a profile existed, or created via "New lead"), try to match an
  // existing client by exact (case-insensitive) name. When we find exactly
  // one we backfill the link on the request so the booking form, follow-ups,
  // etc. all see the same client going forward — no more "type the WhatsApp
  // number again" step on convert.
  let resolvedClientId: string | null = r.client_id ?? null;
  let resolvedClientName: string | null = r.clients?.name ?? r.client_name ?? null;
  // WhatsApp captured during request creation lives on details.client_whatsapp.
  // Use it both for matching and to prefill the booking lookup field.
  const draftWhatsapp: string | null =
    r.clients?.whatsapp ?? (r.details as any)?.client_whatsapp ?? null;
  if (!resolvedClientId && draftWhatsapp) {
    // Phone is the strongest identifier — try matching by digits first.
    const digits = String(draftWhatsapp).replace(/\D/g, "");
    if (digits.length >= 6) {
      const { data: byPhone } = await supabase
        .from("clients")
        .select("id, name")
        .or(`whatsapp.ilike.%${digits}%,whatsapp.ilike.%${draftWhatsapp}%`)
        .eq("inactive", false)
        .limit(2);
      if (byPhone && byPhone.length === 1) {
        resolvedClientId = byPhone[0].id;
        resolvedClientName = byPhone[0].name;
        await supabase
          .from("requests")
          .update({ client_id: resolvedClientId })
          .eq("id", r.id);
      }
    }
  }
  if (!resolvedClientId && resolvedClientName) {
    const { data: matches } = await supabase
      .from("clients")
      .select("id, name")
      .ilike("name", resolvedClientName)
      .eq("inactive", false)
      .limit(2);
    if (matches && matches.length === 1) {
      resolvedClientId = matches[0].id;
      resolvedClientName = matches[0].name;
      // Persist the link so the request and its detail page stay in sync.
      await supabase
        .from("requests")
        .update({ client_id: resolvedClientId })
        .eq("id", r.id);
    }
  }

  // Build a booking draft (not yet inserted — frontend opens /bookings/new prefilled)
  const draft = {
    request_id: r.id,
    client_id: resolvedClientId,
    client_name: resolvedClientName,
    client_whatsapp: draftWhatsapp,
    service_type: r.service_type,
    date_time: r.requested_date_time,
    notes: r.notes,
    price: r.estimated_price ?? 0,
    // Per-service-type structured fields captured at request time
    // (pickup, dropoff, flight, check-in, vehicle_type, etc.).
    details: r.details ?? {},
  };

  await supabase
    .from("requests")
    .update({ status: "Ready to Book" })
    .eq("id", r.id)
    .eq("status", "New");

  await auditLog(
    "convert_request", "request", r.id, user?.id ?? null,
    `Request prepared for booking conversion`
  );

  return res.json({ draft });
});

export default router;
