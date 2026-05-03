import { describe, it, expect, vi, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { hashSecret, hashPin, generateApiKey } from "../src/lib/api-keys";

type Row = Record<string, unknown>;

const NOW = Date.now();
const ONE_HOUR = 60 * 60 * 1000;

const validKey = generateApiKey();
const revokedKey = generateApiKey();
const noScopeKey = generateApiKey();

const SEED: { api_keys: Row[]; drivers: Row[]; driver_sessions: Row[]; bookings: Row[]; requests: Row[]; audit_log: Row[] } = {
  api_keys: [
    { id: "K1", name: "Client App", key_hash: validKey.hash, key_prefix: validKey.prefix,
      scopes: ["requests:create", "driver:auth", "driver:read", "driver:update"],
      revoked_at: null },
    { id: "K2", name: "Old App", key_hash: revokedKey.hash, key_prefix: revokedKey.prefix,
      scopes: ["requests:create"], revoked_at: new Date(NOW - 1000).toISOString() },
    { id: "K3", name: "Limited", key_hash: noScopeKey.hash, key_prefix: noScopeKey.prefix,
      scopes: ["driver:read"], revoked_at: null },
  ],
  drivers: [
    { id: "D1", name: "John Smith", staff_no: "S001", whatsapp: "+44111", vehicle_type: "Saloon",
      vehicle_model: "Mercedes", vehicle_year: 2024, plate: "AB12CDE", status: "active",
      pin_hash: hashPin("1234") },
    { id: "D2", name: "Jane Doe", staff_no: "S002", whatsapp: "+44222", vehicle_type: "Saloon",
      vehicle_model: "BMW", vehicle_year: 2024, plate: "XY99ZZZ", status: "active",
      pin_hash: null },
  ],
  driver_sessions: [],
  bookings: [
    { id: "B1", tvl_ref: "TVL-001", service_type: "Airport Transfer", status: "Confirmed",
      pickup: "LHR", dropoff: "Mayfair", flight_number: "BA1", date_time: "2026-05-10T10:00:00Z",
      price: 200, passengers: 2, luggage: 2, driver_notes: null, notes: null,
      client_id: "C1", driver_id: "D1", clients: { name: "VIP Co", whatsapp: "+44999", vip_tier: "VVIP" } },
    { id: "B2", tvl_ref: "TVL-002", service_type: "Tour", status: "Completed",
      pickup: "Mayfair", dropoff: "Windsor", flight_number: null, date_time: "2026-04-01T09:00:00Z",
      price: 500, passengers: 4, luggage: 0, driver_notes: null, notes: null,
      client_id: "C1", driver_id: "D1", clients: null },
    { id: "B3", tvl_ref: "TVL-003", service_type: "Tour", status: "Confirmed",
      pickup: "Soho", dropoff: "Bath", flight_number: null, date_time: "2026-05-12T08:00:00Z",
      price: 800, passengers: 2, luggage: 0, driver_notes: null, notes: null,
      client_id: "C2", driver_id: "D2", clients: null },
  ],
  requests: [],
  audit_log: [],
};

class FakeBuilder implements PromiseLike<{ data: Row | Row[] | null; error: { message: string } | null }> {
  private filters: Array<(r: Row) => boolean> = [];
  private op: "select" | "insert" | "update" = "select";
  private payload: Row | null = null;
  private cap = Infinity;
  private singleMode: "none" | "single" | "maybeSingle" = "none";
  constructor(private readonly table: string, private readonly rows: Row[]) {}
  select(_cols?: string) { return this; }
  eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this; }
  gte(col: string, val: unknown) { this.filters.push((r) => String(r[col]) >= String(val)); return this; }
  lte(col: string, val: unknown) { this.filters.push((r) => String(r[col]) <= String(val)); return this; }
  is(col: string, val: unknown) { this.filters.push((r) => (val === null ? r[col] == null : r[col] === val)); return this; }
  in(col: string, vals: unknown[]) { const set = new Set(vals); this.filters.push((r) => set.has(r[col])); return this; }
  order(_c: string, _o?: unknown) { return this; }
  limit(n: number) { this.cap = n; return this; }
  single() { this.singleMode = "single"; return this; }
  maybeSingle() { this.singleMode = "maybeSingle"; return this; }
  insert(payload: Row | Row[]) { this.op = "insert"; this.payload = Array.isArray(payload) ? payload[0] : payload; return this; }
  update(payload: Row) { this.op = "update"; this.payload = payload; return this; }
  private execute(): { data: Row | Row[] | null; error: { message: string } | null } {
    if (this.op === "insert" && this.payload) {
      const row = { id: `${this.table}_${this.rows.length + 1}`, ...this.payload };
      this.rows.push(row);
      return { data: this.singleMode !== "none" ? row : [row], error: null };
    }
    let matched = this.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update" && this.payload) {
      matched.forEach((r) => Object.assign(r, this.payload));
    }
    if (matched.length > this.cap) matched = matched.slice(0, this.cap);
    if (this.singleMode === "single") {
      if (matched.length === 0) return { data: null, error: { message: "Row not found" } };
      return { data: matched[0], error: null };
    }
    if (this.singleMode === "maybeSingle") {
      return { data: matched[0] ?? null, error: null };
    }
    return { data: matched, error: null };
  }
  then<T1 = unknown, T2 = never>(
    onFulfilled?: ((v: { data: Row | Row[] | null; error: { message: string } | null }) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.execute()).then(onFulfilled ?? undefined, onRejected ?? undefined);
  }
}

const fakeServiceRoleClient = {
  from(table: string) {
    const rows = (SEED as unknown as Record<string, Row[]>)[table];
    if (!rows) throw new Error(`Unknown table in test fake: ${table}`);
    return new FakeBuilder(table, rows);
  },
};

vi.mock("../src/lib/supabase", () => ({
  getServiceRoleClient: () => fakeServiceRoleClient,
  supabase: fakeServiceRoleClient,
  getUserFromToken: async () => null,
  auditLog: async () => undefined,
  authStorage: { run: (_v: unknown, fn: () => unknown) => fn() },
}));

let app: express.Express;
beforeAll(async () => {
  const { default: v1Router } = await import("../src/routes/public-v1");
  app = express();
  app.use(express.json());
  app.use("/v1", v1Router);
});

const auth = (k: { plaintext: string }) => ({ Authorization: `Bearer ${k.plaintext}` });

describe("Public API — middleware", () => {
  it("rejects requests with no API key", async () => {
    const r = await request(app).post("/v1/requests").send({});
    expect(r.status).toBe(401);
  });
  it("rejects revoked keys", async () => {
    const r = await request(app).post("/v1/requests").set(auth(revokedKey)).send({});
    expect(r.status).toBe(401);
  });
  it("rejects keys missing the required scope", async () => {
    const r = await request(app).post("/v1/requests").set(auth(noScopeKey)).send({});
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/missing required scope/i);
  });
  it("rejects unknown bearer keys", async () => {
    const r = await request(app).post("/v1/requests").set({ Authorization: "Bearer not-a-real-key" }).send({});
    expect(r.status).toBe(401);
  });
});

describe("Public API — POST /v1/requests (Client App intake)", () => {
  it("rejects an invalid service_type", async () => {
    const r = await request(app).post("/v1/requests").set(auth(validKey))
      .send({ service_type: "Spaceflight", client_name: "X", client_whatsapp: "+1" });
    expect(r.status).toBe(400);
  });
  it("creates a Request and stamps the API key as the source", async () => {
    const r = await request(app).post("/v1/requests").set(auth(validKey)).send({
      service_type: "Airport Transfer",
      client_name: "Sheikha A",
      client_whatsapp: "+447700111222",
      pickup: "LHR T5", dropoff: "Mayfair", flight_number: "BA101",
      passengers: 2, luggage: 2, requested_date_time: "2026-06-01T10:00:00Z",
    });
    expect(r.status).toBe(201);
    expect(r.body.id).toBeDefined();
    expect(r.body.status).toBe("New");
    const persisted = SEED.requests.find((x) => x.id === r.body.id);
    expect(persisted).toBeDefined();
    expect(persisted!.source).toBe("Client App");
    expect(persisted!.source_api_key_id).toBe("K1");
  });
});

describe("Public API — Driver login + jobs", () => {
  let driverToken: string;
  it("rejects login with a wrong PIN", async () => {
    const r = await request(app).post("/v1/driver/login").set(auth(validKey))
      .send({ whatsapp: "+44111", pin: "9999" });
    expect(r.status).toBe(401);
  });
  it("rejects a driver with no PIN configured", async () => {
    const r = await request(app).post("/v1/driver/login").set(auth(validKey))
      .send({ whatsapp: "+44222", pin: "1234" });
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/PIN/i);
  });
  it("logs in with the correct PIN and issues a session token", async () => {
    const r = await request(app).post("/v1/driver/login").set(auth(validKey))
      .send({ whatsapp: "+44111", pin: "1234" });
    expect(r.status).toBe(200);
    expect(r.body.driver_token).toMatch(/^tvl_drv_/);
    expect(r.body.driver.id).toBe("D1");
    expect(r.body.driver.pin_hash).toBeUndefined();
    driverToken = r.body.driver_token;
    const persisted = SEED.driver_sessions.find((s) => s.token_hash === hashSecret(driverToken));
    expect(persisted).toBeDefined();
  });
  it("returns ONLY this driver's jobs from /v1/driver/jobs", async () => {
    const r = await request(app).get("/v1/driver/jobs")
      .set(auth(validKey))
      .set("X-Driver-Token", driverToken);
    expect(r.status).toBe(200);
    const ids = r.body.map((b: { id: string }) => b.id).sort();
    expect(ids).toEqual(["B1", "B2"]);
    expect(r.body.find((b: { id: string }) => b.id === "B3")).toBeUndefined();
  });
  it("flattens client info onto the job payload", async () => {
    const r = await request(app).get("/v1/driver/jobs")
      .set(auth(validKey))
      .set("X-Driver-Token", driverToken);
    const b1 = r.body.find((b: { id: string }) => b.id === "B1");
    expect(b1.client_name).toBe("VIP Co");
    expect(b1.client_vip_tier).toBe("VVIP");
    expect(b1.clients).toBeUndefined();
  });
  it("returns 404 when fetching a job belonging to another driver", async () => {
    const r = await request(app).get("/v1/driver/jobs/B3")
      .set(auth(validKey))
      .set("X-Driver-Token", driverToken);
    expect(r.status).toBe(404);
  });
  it("rejects an invalid status on PATCH", async () => {
    const r = await request(app).patch("/v1/driver/jobs/B1/status")
      .set(auth(validKey))
      .set("X-Driver-Token", driverToken)
      .send({ status: "Cancelled" });
    expect(r.status).toBe(400);
  });
  it("updates status to a driver-allowed value", async () => {
    const r = await request(app).patch("/v1/driver/jobs/B1/status")
      .set(auth(validKey))
      .set("X-Driver-Token", driverToken)
      .send({ status: "On the way" });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("On the way");
    const b1 = SEED.bookings.find((b) => b.id === "B1");
    expect(b1!.status).toBe("On the way");
  });
  it("rejects status changes on a Completed job", async () => {
    const r = await request(app).patch("/v1/driver/jobs/B2/status")
      .set(auth(validKey))
      .set("X-Driver-Token", driverToken)
      .send({ status: "On the way" });
    expect(r.status).toBe(409);
  });
  it("rejects status updates on jobs not assigned to this driver", async () => {
    const r = await request(app).patch("/v1/driver/jobs/B3/status")
      .set(auth(validKey))
      .set("X-Driver-Token", driverToken)
      .send({ status: "On the way" });
    expect(r.status).toBe(403);
  });
  it("rejects driver routes when the X-Driver-Token is missing", async () => {
    const r = await request(app).get("/v1/driver/jobs").set(auth(validKey));
    expect(r.status).toBe(401);
  });
  it("rejects an expired session", async () => {
    SEED.driver_sessions.push({
      id: "S_EXP", driver_id: "D1", token_hash: hashSecret("tvl_drv_expired"),
      api_key_id: "K1", expires_at: new Date(NOW - ONE_HOUR).toISOString(),
      revoked_at: null,
    });
    const r = await request(app).get("/v1/driver/jobs")
      .set(auth(validKey))
      .set("X-Driver-Token", "tvl_drv_expired");
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/expired/i);
  });
});
