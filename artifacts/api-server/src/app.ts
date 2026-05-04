import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
// pino-http ships as CommonJS `export =`. Namespace import avoids the need for
// esModuleInterop — we then cast to the correct callable type using its own
// exported Options/HttpLogger so no type safety is lost.
import * as pinoHttpNs from "pino-http";
import type { IncomingMessage, ServerResponse } from "http";
import { jwtVerify } from "jose";
import router from "./routes";
import publicV1Router from "./routes/public-v1";
import { logger } from "./lib/logger";
import cookieParser from "cookie-parser";
import { authStorage } from "./lib/supabase";

type PinoHttpFactory = (opts?: pinoHttpNs.Options) => pinoHttpNs.HttpLogger;
// For CJS modules loaded via namespace import, esbuild places module.exports
// at `.default`. Fall back to the namespace itself for other bundlers.
const pinoHttp = ((pinoHttpNs as any).default ?? pinoHttpNs) as unknown as PinoHttpFactory;

const app: Express = express();

app.use(cookieParser());
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req: IncomingMessage & { id?: unknown }) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res: ServerResponse) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global auth guard — reject any unauthenticated request to protected API routes.
// Health and auth endpoints are public; everything else requires a valid, non-expired JWT.
// Paths are relative to the /api mount point (req.path strips the /api prefix).
//
// NOTE: list the *exact* mounted paths here. The health router is mounted at the
// root and exposes `/healthz`, so we list `/healthz` (NOT `/health`). The auth
// router is mounted under `/auth`, so `/auth` + `/auth/...` are public.
const PUBLIC_PATHS = ["/healthz", "/auth"];

// HS256-shared-secret JWT verification against Supabase's signing key. The
// secret lives in SUPABASE_JWT_SECRET (from the Supabase dashboard → Settings
// → API → JWT Secret). When unset we still enforce the expiry check on the
// decoded payload and log a one-shot warning on boot so the operator can fix
// it; the per-request supabase client also re-validates the token via the
// auth API for sensitive routes (getUserFromToken), so this layer is a fast
// gate, not the only line of defence.
const JWT_SECRET_RAW = (process.env.SUPABASE_JWT_SECRET || "").trim();
const JWT_SECRET = JWT_SECRET_RAW ? new TextEncoder().encode(JWT_SECRET_RAW) : null;
let warnedMissingJwtSecret = false;
if (!JWT_SECRET) {
  // Defer to first request so unit tests / build don't spam the log.
}

async function requireJwt(req: Request, res: Response, next: NextFunction): Promise<void> {
  const path = req.path;
  if (PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"))) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.slice(7);

  if (JWT_SECRET) {
    try {
      // Full HS256 signature + exp check via jose. Rejects forged tokens
      // even if the upstream RLS rules are misconfigured.
      await jwtVerify(token, JWT_SECRET, { algorithms: ["HS256"] });
    } catch (err: any) {
      const code = err?.code === "ERR_JWT_EXPIRED" ? "Token expired" : "Invalid token";
      res.status(401).json({ error: code });
      return;
    }
    return next();
  }

  // No secret configured — fall back to decode-only with an exp check.
  if (!warnedMissingJwtSecret) {
    warnedMissingJwtSecret = true;
    logger.warn(
      "SUPABASE_JWT_SECRET is not set — JWT signatures cannot be verified at " +
      "the API edge. Set the secret from your Supabase dashboard for full " +
      "verification.",
    );
  }
  try {
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) throw new Error("Malformed token");
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === "number" && payload.exp < nowSec) {
      res.status(401).json({ error: "Token expired" });
      return;
    }
  } catch {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  next();
}

// Run each request inside an AsyncLocalStorage scope holding the auth header,
// so the supabase client automatically forwards the user's JWT to Postgres
// (required for RLS).
function withAuthContext(req: Request, _res: Response, next: NextFunction): void {
  authStorage.run(req.headers.authorization, () => next());
}

app.use("/api", requireJwt, withAuthContext, router);

// Public Traveluxe OS API surface for external apps (Client App, Drivers App).
// Auth is per-route via requireApiKey() / requireDriverSession() — NOT the
// Supabase JWT used by the OS web app.
app.use("/v1", publicV1Router);

export default app;
