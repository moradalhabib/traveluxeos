import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import cookieParser from "cookie-parser";
import { authStorage } from "./lib/supabase";

const app: Express = express();

app.use(cookieParser());
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
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
const PUBLIC_PATHS = ["/health", "/auth"];

function requireJwt(req: Request, res: Response, next: NextFunction): void {
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
  try {
    // Decode the JWT payload (without signature verification — Supabase RLS
    // enforces row-level auth; here we simply reject obviously invalid tokens).
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

export default app;
