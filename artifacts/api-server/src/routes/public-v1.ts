import { Router, type IRouter } from "express";
import { getServiceRoleClient } from "../lib/supabase";
import {
  generateDriverToken,
  verifyPin,
  isValidPin,
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginAttempts,
} from "../lib/api-keys";
import { requireApiKey, requireDriverSession } from "../middleware/api-key-auth";

const router: IRouter = Router();

const VALID_SERVICE_TYPES = new Set([
  "Airport Transfer", "Tour", "City Tour", "Chauffeur Tour",
  "Apartment", "Hotel", "Apartment / Accommodation",
  "Car Rental", "As Directed", "Event Transfer", "Other",
]);

const DRIVER_ALLOWED_STATUS = new Set([
  "On the way", "Arrived", "Started", "Completed",
]);

const DRIVER_PUBLIC_FIELDS =
  "id, name, staff_no, whatsapp, vehicle_type, vehicle_model, vehicle_year, plate, status";
const JOB_PUBLIC_FIELDS =
  "id, tvl_ref, service_type, status, pickup, dropoff, flight_number, " +
  "date_time, price, passengers, luggage, driver_notes, notes, " +
  "client_id, driver_id, clients(name, whatsapp, vip_tier)";

function shapeJob(b: unknown) {
  const row = b as Record<string, unknown> & {
    clients?: { name?: string; whatsapp?: string; vip_tier?: string } | null;
  };
  const c = row.clients;
  return {
    ...row,
    client_name: c?.name ?? null,
    client_whatsapp: c?.whatsapp ?? null,
    client_vip_tier: c?.vip_tier ?? null,
    clients: undefined,
  };
}

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok", api: "traveluxe-os/v1" });
});

// ── Client App ──────────────────────────────────────────────────────────────
// POST /v1/requests — turns a customer-app booking into a Request in OS.
router.post("/requests", requireApiKey("requests:create"), async (req, res) => {
  const sb = getServiceRoleClient();
  if (!sb) return res.status(503).json({ error: "Service unavailable." });

  const b = (req.body ?? {}) as Record<string, unknown>;

  const service_type = String(b.service_type ?? "").trim();
  if (!VALID_SERVICE_TYPES.has(service_type)) {
    return res.status(400).json({
      error: "Invalid or missing service_type.",
      valid_service_types: Array.from(VALID_SERVICE_TYPES),
    });
  }

  const client_name = String(b.client_name ?? "").trim();
  const client_whatsapp = String(b.client_whatsapp ?? "").trim();
  if (!client_name || !client_whatsapp) {
    return res.status(400).json({ error: "client_name and client_whatsapp are required." });
  }

  const requested_date_time = b.requested_date_time ? String(b.requested_date_time) : null;
  if (requested_date_time && Number.isNaN(Date.parse(requested_date_time))) {
    return res.status(400).json({ error: "requested_date_time must be an ISO 8601 timestamp." });
  }

  const today = new Date();
  const followUp = new Date(today.getTime() + 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  const details: Record<string, unknown> = {
    client_whatsapp,
    client_email: b.client_email ?? null,
    pickup: b.pickup ?? null,
    dropoff: b.dropoff ?? null,
    flight_number: b.flight_number ?? null,
    passengers: b.passengers ?? null,
    luggage: b.luggage ?? null,
    nights: b.nights ?? null,
    check_in: b.check_in ?? null,
    check_out: b.check_out ?? null,
    notes: b.notes ?? null,
    extras: b.extras ?? null,
  };

  const insert = {
    client_name,
    service_type,
    status: "New" as const,
    priority: typeof b.priority === "string" ? b.priority : "Medium",
    follow_up_date: followUp,
    requested_date_time,
    estimated_price: typeof b.estimated_price === "number" ? b.estimated_price : null,
    notes: typeof b.notes === "string" ? b.notes : null,
    details,
    source: req.apiKey?.name ?? "External API",
    source_api_key_id: req.apiKey?.id ?? null,
  };

  const { data, error } = await sb
    .from("requests")
    .insert(insert)
    .select("id, status, follow_up_date, created_at")
    .single();

  if (error) {
    req.log?.error({ err: error.message }, "[/v1/requests] insert failed");
    return res.status(400).json({ error: error.message });
  }

  return res.status(201).json({
    id: data.id,
    status: data.status,
    follow_up_date: data.follow_up_date,
    created_at: data.created_at,
    message: "Request received. An operator will review and confirm shortly.",
  });
});

// ── Drivers App ─────────────────────────────────────────────────────────────
// POST /v1/driver/login — exchange whatsapp + PIN for a session token.
router.post("/driver/login", requireApiKey("driver:auth"), async (req, res) => {
  const sb = getServiceRoleClient();
  if (!sb) return res.status(503).json({ error: "Service unavailable." });

  const whatsapp = String((req.body?.whatsapp ?? "")).trim();
  const pin = req.body?.pin;
  if (!whatsapp || !isValidPin(pin)) {
    return res.status(400).json({ error: "whatsapp and a 4-6 digit pin are required." });
  }

  const ip = (req.ip || req.headers["x-forwarded-for"] || "unknown").toString().split(",")[0].trim();
  const rlKey = `${whatsapp}|${ip}`;
  const rl = checkLoginRateLimit(rlKey);
  if (!rl.allowed) {
    res.setHeader("Retry-After", String(rl.retryAfterSeconds));
    return res.status(429).json({ error: "Too many login attempts. Try again later.", retry_after_seconds: rl.retryAfterSeconds });
  }

  const { data: driver, error } = await sb
    .from("drivers")
    .select("id, name, staff_no, whatsapp, vehicle_type, vehicle_model, vehicle_year, plate, status, pin_hash")
    .eq("whatsapp", whatsapp)
    .maybeSingle();

  if (error || !driver || !driver.pin_hash) {
    recordLoginFailure(rlKey);
    return res.status(401).json({ error: "Driver not found or PIN not set. Ask the operator to set your PIN." });
  }
  if (!verifyPin(pin, driver.pin_hash as string)) {
    recordLoginFailure(rlKey);
    return res.status(401).json({ error: "Invalid PIN." });
  }
  if (typeof driver.status === "string" && driver.status.trim().toLowerCase() !== "active") {
    return res.status(403).json({ error: `Driver status is "${driver.status}". Contact the operator.` });
  }
  clearLoginAttempts(rlKey);

  const token = generateDriverToken();
  const expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const ua = (req.headers["user-agent"] as string | undefined)?.slice(0, 200) ?? null;

  const { error: insErr } = await sb.from("driver_sessions").insert({
    driver_id: driver.id,
    token_hash: token.hash,
    api_key_id: req.apiKey?.id ?? null,
    expires_at,
    user_agent: ua,
  });

  if (insErr) {
    req.log?.error({ err: insErr.message }, "[/v1/driver/login] session insert failed");
    return res.status(500).json({ error: "Could not start session." });
  }

  const { pin_hash: _omit, ...publicDriver } = driver;
  void _omit;
  return res.json({
    driver_token: token.plaintext,
    expires_at,
    driver: publicDriver,
  });
});

router.post("/driver/logout", requireDriverSession(), async (req, res) => {
  const sb = getServiceRoleClient();
  if (!sb) return res.status(503).json({ error: "Service unavailable." });
  await sb
    .from("driver_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", req.driverCtx!.sessionId);
  return res.json({ ok: true });
});

router.get("/driver/me", requireApiKey("driver:read"), requireDriverSession(), async (req, res) => {
  const sb = getServiceRoleClient();
  if (!sb) return res.status(503).json({ error: "Service unavailable." });
  const { data, error } = await sb
    .from("drivers")
    .select(DRIVER_PUBLIC_FIELDS)
    .eq("id", req.driverCtx!.driverId)
    .single();
  if (error) return res.status(404).json({ error: "Driver not found." });
  return res.json(data);
});

router.get("/driver/jobs", requireApiKey("driver:read"), requireDriverSession(), async (req, res) => {
  const sb = getServiceRoleClient();
  if (!sb) return res.status(503).json({ error: "Service unavailable." });

  const { from, to, status } = req.query as { from?: string; to?: string; status?: string };

  let q = sb
    .from("bookings")
    .select(JOB_PUBLIC_FIELDS)
    .eq("driver_id", req.driverCtx!.driverId)
    .order("date_time", { ascending: true });

  if (status) q = q.eq("status", String(status));
  if (from) q = q.gte("date_time", String(from));
  if (to) q = q.lte("date_time", String(to));

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(((data ?? []) as unknown[]).map(shapeJob));
});

router.get("/driver/jobs/:id", requireApiKey("driver:read"), requireDriverSession(), async (req, res) => {
  const sb = getServiceRoleClient();
  if (!sb) return res.status(503).json({ error: "Service unavailable." });
  const { data, error } = await sb
    .from("bookings")
    .select(JOB_PUBLIC_FIELDS)
    .eq("id", req.params.id)
    .eq("driver_id", req.driverCtx!.driverId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Job not found or not assigned to you." });
  return res.json(shapeJob(data));
});

router.patch(
  "/driver/jobs/:id/status",
  requireApiKey("driver:update"),
  requireDriverSession(),
  async (req, res) => {
    const sb = getServiceRoleClient();
    if (!sb) return res.status(503).json({ error: "Service unavailable." });

    const newStatus = String(req.body?.status ?? "");
    if (!DRIVER_ALLOWED_STATUS.has(newStatus)) {
      return res.status(400).json({
        error: "Invalid status for driver update.",
        allowed: Array.from(DRIVER_ALLOWED_STATUS),
      });
    }

    const { data: existing, error: lookupErr } = await sb
      .from("bookings")
      .select("id, driver_id, status, tvl_ref")
      .eq("id", req.params.id)
      .maybeSingle();

    if (lookupErr) return res.status(500).json({ error: lookupErr.message });
    if (!existing) return res.status(404).json({ error: "Job not found." });
    if (existing.driver_id !== req.driverCtx!.driverId) {
      return res.status(403).json({ error: "This job is not assigned to you." });
    }
    if (existing.status === "Cancelled" || existing.status === "Completed") {
      return res.status(409).json({ error: `Job is already ${existing.status}; status cannot be changed by driver.` });
    }

    const { data, error } = await sb
      .from("bookings")
      .update({ status: newStatus })
      .eq("id", req.params.id)
      .select("id, status, tvl_ref")
      .single();
    if (error) return res.status(400).json({ error: error.message });

    sb.from("audit_log")
      .insert({
        action: "driver_status_update",
        entity_type: "booking",
        entity_id: data.id,
        operator_id: null,
        detail: `Driver set status → ${newStatus} (via Drivers App, session=${req.driverCtx!.sessionId})`,
      })
      .then(() => undefined, () => undefined);

    return res.json(data);
  },
);

export default router;
