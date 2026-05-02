import { describe, it, expect, vi, beforeAll } from "vitest";
import express from "express";
import request from "supertest";

type Row = Record<string, unknown>;

function ilikePatternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = escaped.replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${re}$`, "i");
}

function parseOrExpression(expr: string): Array<(row: Row) => boolean> {
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

const SEED = {
  drivers: [
    {
      id: "D1", name: "John Smith", staff_no: "S001", whatsapp: "+44111",
      vehicle_type: "Executive Saloon", vehicle_model: "Mercedes E-Class VIP",
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
      status: "Confirmed", pickup: "Heathrow T5 VIP Lounge", dropoff: "Mayfair",
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

vi.mock("../src/lib/supabase", () => ({
  supabase: {
    from(table: string) {
      const rows = (SEED as Record<string, Row[]>)[table] ?? [];
      return new FakeBuilder(rows);
    },
  },
}));

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
    expect(res.body.drivers).toHaveLength(1);
    expect(res.body.drivers[0]).toMatchObject({ id: "D1", name: "John Smith", plate: "AB12CDE" });
    // Bookings only surface via the driver_id second pass — no booking row
    // contains "John" in any direct field.
    const bookingIds = res.body.bookings.map((b: { id: string }) => b.id).sort();
    expect(bookingIds).toEqual(["B1", "B2"]);
  });

  it("returns the driver row AND its bookings when querying by plate", async () => {
    const res = await request(app).get("/api/search").query({ q: "AB12" });

    expect(res.status).toBe(200);
    expect(res.body.drivers).toHaveLength(1);
    expect(res.body.drivers[0].plate).toBe("AB12CDE");
    const bookingIds = res.body.bookings.map((b: { id: string }) => b.id).sort();
    expect(bookingIds).toEqual(["B1", "B2"]);
  });

  it("deduplicates bookings that match BOTH the direct pass AND the driver-id pass", async () => {
    // "VIP" matches D1.vehicle_model (driver pass surfaces B1+B2) AND
    // B1.pickup (direct pass surfaces B1) — B1 must appear exactly once.
    const res = await request(app).get("/api/search").query({ q: "VIP" });

    expect(res.status).toBe(200);
    const ids = res.body.bookings.map((b: { id: string }) => b.id);
    expect(ids.sort()).toEqual(["B1", "B2"]);
    expect(ids.filter((id: string) => id === "B1")).toHaveLength(1);
    expect(res.body.drivers.map((d: { id: string }) => d.id)).toEqual(["D1"]);
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
