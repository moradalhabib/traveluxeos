import { randomBytes, createHash, timingSafeEqual, scryptSync } from "node:crypto";

export const API_KEY_PREFIX = "tvl_pk_";
export const DRIVER_TOKEN_PREFIX = "tvl_drv_";

export type Scope =
  | "requests:create"
  | "driver:auth"
  | "driver:read"
  | "driver:update";

export const ALL_SCOPES: Scope[] = [
  "requests:create",
  "driver:auth",
  "driver:read",
  "driver:update",
];

export const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  "requests:create": "Submit new bookings as Requests (Client App)",
  "driver:auth": "Driver PIN login (Drivers App)",
  "driver:read": "Read assigned jobs (Drivers App)",
  "driver:update": "Update job status: On the way, Arrived, Started, Completed (Drivers App)",
};

export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const random = randomBytes(32).toString("base64url");
  const plaintext = `${API_KEY_PREFIX}${random}`;
  return {
    plaintext,
    hash: hashSecret(plaintext),
    prefix: plaintext.slice(0, API_KEY_PREFIX.length + 6),
  };
}

export function generateDriverToken(): { plaintext: string; hash: string } {
  const random = randomBytes(32).toString("base64url");
  const plaintext = `${DRIVER_TOKEN_PREFIX}${random}`;
  return { plaintext, hash: hashSecret(plaintext) };
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// PIN hashing: scrypt with per-PIN random salt. Format: scrypt$<saltB64>$<hashB64>
// Memory-hard KDF makes 4-6 digit PINs expensive to brute-force even if hashes leak.
const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 64;

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPin(pin: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "base64");
    const expected = Buffer.from(parts[2], "base64");
    const actual = scryptSync(pin, salt, expected.length, { N: SCRYPT_N, r: 8, p: 1 });
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4,6}$/.test(pin);
}

// In-memory PIN-login rate limiter (per process). Throttles brute-force attempts
// per (whatsapp + IP) — 5 fails in 15 min triggers a 15-min lockout.
const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

interface AttemptRec { count: number; firstAt: number; blockedUntil?: number }
const loginAttempts = new Map<string, AttemptRec>();

export function checkLoginRateLimit(key: string): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const now = Date.now();
  const rec = loginAttempts.get(key);
  if (!rec) return { allowed: true };
  if (rec.blockedUntil && rec.blockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.ceil((rec.blockedUntil - now) / 1000) };
  }
  if (rec.blockedUntil && rec.blockedUntil <= now) {
    loginAttempts.delete(key);
    return { allowed: true };
  }
  if (now - rec.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
  }
  return { allowed: true };
}

export function recordLoginFailure(key: string): void {
  const now = Date.now();
  const rec = loginAttempts.get(key);
  if (!rec || now - rec.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAt: now });
    return;
  }
  rec.count += 1;
  if (rec.count >= LOGIN_MAX_FAILS) {
    rec.blockedUntil = now + LOGIN_LOCKOUT_MS;
  }
}

export function clearLoginAttempts(key: string): void {
  loginAttempts.delete(key);
}

// Test-only escape hatch.
export function _resetLoginAttemptsForTests(): void {
  loginAttempts.clear();
}
