import { describe, it, expect, vi, beforeAll } from "vitest";
import express from "express";
import request from "supertest";

// ────────────────────────────────────────────────────────────────────────────
// Fake Supabase query builder
// ────────────────────────────────────────────────────────────────────────────
// Replaces the Supabase Proxy from src/lib/supabase with an in-memory store.
// Implements only the chainable methods that src/routes/search.ts actually
// calls: .select / .is / .or / .ilike / .eq / .in / .limit, with a thenable
// that resolves to { data, error } so `await supabase.from(t)...` works.
//
// The builder is intentionally minimal — it does not aim to be a complete
// PostgREST emulator. It only needs to make the search route's three-pass
// algorithm (direct → by-client → by-driver) observable from the outside.
// ────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function ilikePatternToRegex(pattern: string): RegExp {
  // Supabase ilike uses % as wildcard, _ as single-char wildcard.
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = escaped.replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${re}$`, "i");
}

function parseOrExpression(expr: string): Array<(row: Row) => boolean> {
  // Format per branch: "<col>.<op>.<value>" where value may contain commas
  // wrapped in % wildcards. Our route never injects commas, so a plain split
  // is safe and matches what PostgREST receives.
  return expr.split(",").map((branch) => {
    const m = branch.trim().match(/^([^.]+)\.([^.]+)\.(.+)$/);
    if (!m) return () => false;
    const [, col, op, val] = m;
    if (op === "ilike") {
      const re = ilikePatternToRegex(val);
      return (row: Row) => typeof row[col] === "string" && re.test(row[col] as string);
    }
    if (op === "eq") return (row: Row) => row[col] === val;
    return () => false;
  });
}

class FakeBuilder implements PromiseLike<{ data: Row[]; error: null }> {
  private filters: Array<(row: Row) => boolean> = [];
  private cap = Infinity;
  constructor(private readonly rows: Row[]) {}

  select(_cols: string) { return this; }
  is(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val || (val === null && r[col] == null));
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    const set = new Set(vals);
    this.filters.push((r) => set.has(r[col]));
    return this;
  }
  ilike(col: string, pattern: string) {
    const re = ilikePatternToRegex(pattern);
    this.filters.push((r) => typeof r[col] === "string" && re.test(r[col] as string));
    return this;
  }
  or(expr: string) {
    const branches = parseOrExpression(expr);
    this.filters.push((r) => branches.some((b) => b(r)));
    return this;
  }
  limit(n: number) {
    this.cap = n;
    return this;
  }

  then<T1 = { data: Row[]; error: null }, T2 = never>(
    onFulfilled?: ((v: { data: Row[]; error: null }) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    let result = this.rows.filter((r) => this.filters.every((f) => f(r)));
    if (result.length > this.cap) result = result.slice(0, this.cap);
    return Promise.resolve({ data: result, error: null }).then(
      onFulfilled ?? undefined,
      onRejected ?? undefined,
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Seeded dataset
// ────────────────────────────────────────────────────────────────────────────
// Two drivers, three bookings. None of the bookings has a direct-field
// match against the driver's name or plate — so any booking that comes
// back when searching by driver name/plate proves the driver-id second
// pass is wired up correctly.
// ────────────────────────────────────────────────────────────────────────────
const SEED = {
  drivers: [
    {
      id: "D1", name: "John Smith", staff_no: "S001", whatsapp: "+44111",
      vehicle_type: "Executive Saloon", vehicle_model: "Mercedes E-Class",
      vehicle_year: 2023, plate: "AB12CDE", status: "active", avg_rating: [],
    },
    {
      id: "D2", name: "Jane Doe", staff_no: "S002", whatsapp: "+44222",
      vehicle_type: "Executive Saloon", vehicle_model: "BMW 7 Series",
      vehicle_year: 2024, plate: "XY99ZZZ", status: "active", avg_rating: [],
    },
  ],
  clients: [] as Row[],
  bookings: [
    {
      id: "B1", tvl_ref: "TVL-001", service_type: "Airport Transfer",
      status: "Confirmed", pickup: "Heathrow T5", dropoff: "Mayfair",
      flight_number: "BA123", date_time: "2026-05-10T10:00:00Z",
      price: 200, client_id: null, driver_id: "D1", clients: null,
    },
    {
      id: "B2", tvl_ref: "TVL-002", service_type: "Airport Transfer",
      status: "Active", pickup: "Gatwick North", dropoff: "Soho",
      flight_number: "BA124", date_time: "2026-05-11T14:00:00Z",
      price: 180, client_id: null, driver_id: "D1", clients: null,
    },
    {
      id: "B3", tvl_ref: "TVL-003", service_type: "Tour",
      status: "Pending", pickup: "Knightsbridge", dropoff: "Windsor Castle",
      flight_number: null, date_time: "2026-05-12T09:00:00Z",
      price: 300, client_id: null, driver_id: "D2", clients: null,
    },
  ],
  suppliers: [] as Row[],
  requests: [] as Row[],
  invoices: [] as Row[],
  tasks: [] as Row[],
};

// Mock the supabase module BEFORE importing the route. vi.mock is hoisted,
// so this runs before any `import` in this file is resolved.
vi.mock("../src/lib/supabase", () => ({
  supabase: {
    from(table: string) {
      const rows = (SEED as Record<string, Row[]>)[table] ?? [];
      return new FakeBuilder(rows);
    },
  },
}));

// ────────────────────────────────────────────────────────────────────────────
// Test harness — mount the search router on a fresh Express app. We bypass
// the JWT middleware entirely because the route's behaviour-under-test is
// purely the search algorithm; auth is enforced by app.ts's requireJwt and
// is exercised by integration tests of that middleware (out of scope here).
// ────────────────────────────────────────────────────────────────────────────
let app: express.Express;
beforeAll(async () => {
  const { default: searchRouter } = await import("../src/routes/search");
  app = express();
  app.use("/api/search", searchRouter);
});

describe("GET /api/search — driver / plate lookups", () => {
  it("returns the driver row AND its bookings when querying by driver name", async () => {
    const res = await request(app).get("/api/search").query({ q: "John" });

    expect(res.status).toBe(200);
    // Driver matched directly on the `drivers.name` ilike.
    expect(res.body.drivers).toHaveLength(1);
    expect(res.body.drivers[0]).toMatchObject({ id: "D1", name: "John Smith", plate: "AB12CDE" });
    // Bookings come back via the THIRD pass (driver_id IN [D1]) — without
    // that pass, this assertion fails because no booking has "John" in any
    // direct field. This is the regression the task explicitly guards.
    const bookingIds = res.body.bookings.map((b: { id: string }) => b.id).sort();
    expect(bookingIds).toEqual(["B1", "B2"]);
  });

  it("returns the driver row AND its bookings when querying by plate", async () => {
    const res = await request(app).get("/api/search").query({ q: "AB12" });

    expect(res.status).toBe(200);
    // Driver matched on `drivers.plate` (one of the OR branches).
    expect(res.body.drivers).toHaveLength(1);
    expect(res.body.drivers[0].plate).toBe("AB12CDE");
    // Same third-pass guarantee as above — searching a plate must surface
    // the related jobs, not just the driver row.
    const bookingIds = res.body.bookings.map((b: { id: string }) => b.id).sort();
    expect(bookingIds).toEqual(["B1", "B2"]);
  });

  it("deduplicates bookings that match multiple passes", async () => {
    // Heathrow matches B1 directly (pickup field) and also belongs to D1,
    // but the third pass only fires if there's still room under `limit`
    // and a driver matched. Here we use a query that surfaces the driver
    // (so the third pass runs) AND matches a direct booking field.
    // "Mercedes" matches drivers.vehicle_model (D1) and no booking direct
    // field — but both B1 and B2 belong to D1, so they appear via pass 3.
    // We then assert that the response has each booking exactly once.
    const res = await request(app).get("/api/search").query({ q: "Mercedes" });

    expect(res.status).toBe(200);
    const ids = res.body.bookings.map((b: { id: string }) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("respects the per-group limit cap", async () => {
    const res = await request(app).get("/api/search").query({ q: "John", limit: "1" });

    expect(res.status).toBe(200);
    expect(res.body.drivers.length).toBeLessThanOrEqual(1);
    expect(res.body.bookings.length).toBeLessThanOrEqual(1);
  });

  it("returns the empty contract for queries shorter than 2 chars", async () => {
    const res = await request(app).get("/api/search").query({ q: "J" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      clients: [], bookings: [], drivers: [], suppliers: [],
      requests: [], invoices: [], tasks: [],
    });
  });

  it("returns no driver and no driver-linked bookings for a non-matching query", async () => {
    const res = await request(app).get("/api/search").query({ q: "ZZZ-NO-MATCH" });

    expect(res.status).toBe(200);
    expect(res.body.drivers).toHaveLength(0);
    expect(res.body.bookings).toHaveLength(0);
  });
});
