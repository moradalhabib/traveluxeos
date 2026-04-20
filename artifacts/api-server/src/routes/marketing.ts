import { Router } from "express";
import { supabase, getUserFromToken, auditLog } from "../lib/supabase";

const router = Router();

// ── Auth helper ────────────────────────────────────────────────────────────
async function requireAdmin(authHeader: string | undefined) {
  const user = await getUserFromToken(authHeader);
  if (!user) return { ok: false as const, status: 401, msg: "Unauthorized" };
  if (!["super_admin", "admin"].includes(user.role)) {
    return { ok: false as const, status: 403, msg: "Admin access required" };
  }
  return { ok: true as const, user };
}

// ── Types ──────────────────────────────────────────────────────────────────
type Filters = {
  segment?: "cold" | "warm" | "active" | "vip" | null;
  last_booking_more_than_days?: number | null;
  last_booking_within_days?: number | null;
  last_booking_min_days?: number | null;
  last_booking_max_days?: number | null;
  vip_tier?: "Standard" | "VIP" | "VVIP" | "Any" | null;
  nationality?: string | null;
  service_type?: string | null;
  min_total_spend?: number | null;
};

type EnrichedClient = {
  id: string;
  name: string;
  email: string | null;
  nationality: string | null;
  vip_tier: string | null;
  inactive: boolean | null;
  total_bookings: number;
  total_spent: number;
  last_booking_date: string | null;
  last_service_type: string | null;
};

// ── Core: load clients enriched with booking aggregates ────────────────────
async function loadEnrichedClients(): Promise<EnrichedClient[]> {
  const { data, error } = await supabase
    .from("clients")
    .select(
      "id, name, email, nationality, vip_tier, inactive, " +
      "bookings(id, price, additional_charges, date_time, status, service_type)"
    )
    .is("merged_into", null);

  if (error) throw new Error(error.message);

  return (data ?? []).map((c: any) => {
    const bookings = (c.bookings ?? []).filter(
      (b: any) => b.status !== "Cancelled"
    );
    const total_spent = bookings.reduce(
      (s: number, b: any) => s + (b.price || 0) + (b.additional_charges || 0),
      0
    );
    const sorted = [...bookings].sort(
      (a: any, b: any) =>
        new Date(b.date_time).getTime() - new Date(a.date_time).getTime()
    );
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      nationality: c.nationality,
      vip_tier: c.vip_tier,
      inactive: c.inactive,
      total_bookings: bookings.length,
      total_spent,
      last_booking_date: sorted[0]?.date_time ?? null,
      last_service_type: sorted[0]?.service_type ?? null,
    };
  });
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / 86_400_000);
}

// ── Filter logic ───────────────────────────────────────────────────────────
function applyFilters(
  clients: EnrichedClient[],
  filters: Filters
): EnrichedClient[] {
  return clients.filter((c) => {
    // Always require email + active
    if (!c.email || !c.email.includes("@")) return false;
    if (c.inactive === true) return false;

    // Pre-built segment shortcuts
    const since = daysSince(c.last_booking_date);

    if (filters.segment === "cold") {
      if (since === null || since < 90) return false;
    } else if (filters.segment === "warm") {
      if (since === null || since < 30 || since > 90) return false;
    } else if (filters.segment === "active") {
      if (since === null || since > 30) return false;
    } else if (filters.segment === "vip") {
      if (c.vip_tier !== "VIP" && c.vip_tier !== "VVIP") return false;
    }

    // Custom filters (combine on top)
    if (filters.last_booking_more_than_days != null) {
      if (since === null) return false;
      if (since <= filters.last_booking_more_than_days) return false;
    }
    if (filters.last_booking_within_days != null) {
      if (since === null) return false;
      if (since > filters.last_booking_within_days) return false;
    }
    if (
      filters.last_booking_min_days != null &&
      filters.last_booking_max_days != null
    ) {
      if (since === null) return false;
      if (
        since < filters.last_booking_min_days ||
        since > filters.last_booking_max_days
      )
        return false;
    }
    if (filters.vip_tier && filters.vip_tier !== "Any") {
      if (c.vip_tier !== filters.vip_tier) return false;
    }
    if (filters.nationality && filters.nationality.trim()) {
      const wanted = filters.nationality.trim().toLowerCase();
      if (!c.nationality || !c.nationality.toLowerCase().includes(wanted))
        return false;
    }
    if (filters.service_type && filters.service_type !== "Any") {
      if (c.last_service_type !== filters.service_type) return false;
    }
    if (filters.min_total_spend != null && filters.min_total_spend > 0) {
      if (c.total_spent < filters.min_total_spend) return false;
    }
    return true;
  });
}

// ── GET /segments — live counts for the four prebuilt segments ────────────
router.get("/segments", async (req, res) => {
  const auth = await requireAdmin(req.headers.authorization);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.msg });

  try {
    const all = await loadEnrichedClients();
    const cold = applyFilters(all, { segment: "cold" }).length;
    const warm = applyFilters(all, { segment: "warm" }).length;
    const active = applyFilters(all, { segment: "active" }).length;
    const vip = applyFilters(all, { segment: "vip" }).length;
    const total_with_email = all.filter(
      (c) => c.email && c.email.includes("@") && c.inactive !== true
    ).length;
    return res.json({ cold, warm, active, vip, total_with_email });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /nationalities — list of unique nationalities for filter dropdown ──
router.get("/nationalities", async (req, res) => {
  const auth = await requireAdmin(req.headers.authorization);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.msg });

  const { data, error } = await supabase
    .from("clients")
    .select("nationality")
    .not("nationality", "is", null);
  if (error) return res.status(500).json({ error: error.message });

  const unique = Array.from(
    new Set(
      (data ?? [])
        .map((r: any) => r.nationality?.trim())
        .filter((n: string) => n && n.length > 0)
    )
  ).sort();
  return res.json(unique);
});

// ── POST /preview — return clients matching filters (no email returned) ────
router.post("/preview", async (req, res) => {
  const auth = await requireAdmin(req.headers.authorization);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.msg });

  try {
    const filters: Filters = req.body ?? {};
    const all = await loadEnrichedClients();
    const matched = applyFilters(all, filters);
    // Strip email for privacy in preview
    const preview = matched.map((c) => ({
      id: c.id,
      name: c.name,
      nationality: c.nationality,
      vip_tier: c.vip_tier,
      last_booking_date: c.last_booking_date,
      total_bookings: c.total_bookings,
      total_spent: c.total_spent,
    }));
    return res.json({ count: matched.length, clients: preview });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /export — return CSV-ready rows + log to campaign log ────────────
router.post("/export", async (req, res) => {
  const auth = await requireAdmin(req.headers.authorization);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.msg });

  try {
    const { campaign_name, ...filters } = req.body ?? {};
    if (!campaign_name || typeof campaign_name !== "string" || !campaign_name.trim()) {
      return res.status(400).json({ error: "campaign_name is required" });
    }

    const all = await loadEnrichedClients();
    const matched = applyFilters(all, filters as Filters);

    const rows = matched.map((c) => {
      const firstName = (c.name || "").trim().split(/\s+/)[0] || "";
      return { first_name: firstName, email: c.email as string };
    });

    // Build readable filter description
    const filtersUsed: string[] = [];
    if (filters.segment) filtersUsed.push(`segment=${filters.segment}`);
    if (filters.last_booking_more_than_days != null)
      filtersUsed.push(`last_booking>${filters.last_booking_more_than_days}d`);
    if (filters.last_booking_within_days != null)
      filtersUsed.push(`last_booking<${filters.last_booking_within_days}d`);
    if (filters.last_booking_min_days != null && filters.last_booking_max_days != null)
      filtersUsed.push(`last_booking ${filters.last_booking_min_days}-${filters.last_booking_max_days}d`);
    if (filters.vip_tier && filters.vip_tier !== "Any")
      filtersUsed.push(`tier=${filters.vip_tier}`);
    if (filters.nationality) filtersUsed.push(`nationality=${filters.nationality}`);
    if (filters.service_type && filters.service_type !== "Any")
      filtersUsed.push(`service=${filters.service_type}`);
    if (filters.min_total_spend != null && filters.min_total_spend > 0)
      filtersUsed.push(`min_spend=£${filters.min_total_spend}`);

    const description = filtersUsed.length > 0 ? filtersUsed.join(", ") : "all eligible";

    // Log to audit_log (used as Campaign Log)
    const detail = JSON.stringify({
      campaign_name: campaign_name.trim(),
      description,
      client_count: matched.length,
      filters,
    });

    await auditLog(
      "MARKETING_EXPORT",
      "marketing_campaign",
      crypto.randomUUID(),
      auth.user.id ?? null,
      detail
    ).catch(() => {});

    return res.json({
      count: matched.length,
      rows,
      campaign_name: campaign_name.trim(),
      description,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /campaigns — read-only campaign log ────────────────────────────────
router.get("/campaigns", async (req, res) => {
  const auth = await requireAdmin(req.headers.authorization);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.msg });

  const { data, error } = await supabase
    .from("audit_log")
    .select("id, action, detail, created_at, operator_id, users(name)")
    .eq("action", "MARKETING_EXPORT")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) return res.status(500).json({ error: error.message });

  const campaigns = (data ?? []).map((row: any) => {
    let parsed: any = {};
    try {
      parsed = JSON.parse(row.detail || "{}");
    } catch {
      parsed = { campaign_name: "(unparseable)", description: row.detail };
    }
    return {
      id: row.id,
      campaign_name: parsed.campaign_name ?? "(unnamed)",
      description: parsed.description ?? "",
      client_count: parsed.client_count ?? 0,
      operator_name: row.users?.name ?? "Unknown",
      created_at: row.created_at,
    };
  });

  return res.json(campaigns);
});

export default router;
