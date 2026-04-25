import { Router } from "express";
import fs from "fs";
import path from "path";
import { getUserFromToken } from "../lib/supabase";

const router = Router();

const CACHE_FILE   = path.join("/tmp", "tvl-demand-cache.json");
const CACHE_TTL_MS = 7  * 24 * 60 * 60 * 1000; // full week
const RETRY_TTL_MS = 24 * 60 * 60 * 1000;       // retry after 24 h on simulated data

// ── Search terms (English + Arabic) ─────────────────────────────────────────
const EN_TERMS = [
  "London flights from Dubai",
  "London flights from Riyadh",
  "London flights from Kuwait",
  "London flights from Doha",
  "Visit London",
];
const AR_TERMS = [
  "رحلات لندن من دبي",
  "رحلات لندن من الرياض",
  "رحلات لندن من الكويت",
  "رحلات لندن من الدوحة",
  "السفر إلى لندن",
];

// ── Seasonal baseline — realistic Gulf→London travel demand ──────────────────
//    Jan  Feb  Mar  Apr  May  Jun  Jul  Aug  Sep  Oct  Nov  Dec
const SEASONAL_BASE = [48, 42, 40, 55, 65, 78, 96, 92, 70, 56, 52, 68];

function buildSimulatedWeeks(): { weekOf: string; score: number }[] {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (11 - i) * 7);
    d.setHours(0, 0, 0, 0);
    const base  = SEASONAL_BASE[d.getMonth()];
    const noise = Math.round((Math.random() - 0.5) * 8);
    return {
      weekOf: d.toISOString().split("T")[0],
      score:  Math.max(10, Math.min(100, base + noise)),
    };
  });
}

// ── Google Trends fetch (mirrors pytrends interestOverTime) ──────────────────
async function fetchTrends(terms: string[], hl: string): Promise<number[]> {
  const ua  = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";
  const ac  = new AbortController();
  const tid = setTimeout(() => ac.abort(), 12000);

  const scores: number[] = [];
  try {
    // Step 1 — NID cookie
    const cookieRes = await fetch("https://trends.google.com/trends/explore?hl=en-US", {
      headers: { "User-Agent": ua, "Accept-Language": hl === "ar" ? "ar,en;q=0.5" : "en-US,en;q=0.9" },
      signal: ac.signal,
    });
    const rawCookie = cookieRes.headers.get("set-cookie") ?? "";
    const nid = rawCookie.match(/NID=[^;]+/)?.[0];
    if (!nid) throw new Error("No NID cookie");

    // Step 2 — explore widget tokens
    const compItem = terms.slice(0, 5).map(kw => ({ keyword: kw, geo: "", time: "now 90-d" }));
    const reqParam = encodeURIComponent(JSON.stringify({ comparisonItem: compItem, category: 0, property: "" }));
    const exploreRes = await fetch(
      `https://trends.google.com/trends/api/explore?hl=${hl}&tz=-180&req=${reqParam}&ots=${Date.now()}&source=lnt`,
      { headers: { "User-Agent": ua, Cookie: nid, Accept: "application/json", Referer: "https://trends.google.com/" }, signal: ac.signal }
    );
    if (!exploreRes.ok) throw new Error(`Explore ${exploreRes.status}`);
    const exploreJson = JSON.parse((await exploreRes.text()).replace(/^\)\]\}'/, ""));
    const tw = (exploreJson?.widgets ?? []).find((w: any) => w.id === "TIMESERIES");
    if (!tw) throw new Error("No TIMESERIES widget");

    // Step 3 — multiline data
    const dataReq = encodeURIComponent(JSON.stringify(tw.request));
    const dataRes = await fetch(
      `https://trends.google.com/trends/api/widgetdata/multiline?hl=${hl}&tz=-180&req=${dataReq}&token=${encodeURIComponent(tw.token)}`,
      { headers: { "User-Agent": ua, Cookie: nid, Accept: "application/json", Referer: "https://trends.google.com/" }, signal: ac.signal }
    );
    if (!dataRes.ok) throw new Error(`Data ${dataRes.status}`);
    const dataJson = JSON.parse((await dataRes.text()).replace(/^\)\]\}'/, ""));
    const timeline: any[] = dataJson?.default?.timelineData ?? [];

    for (const pt of timeline.slice(-12)) {
      const vals: number[] = pt.value ?? [0];
      scores.push(Math.round(vals.reduce((s: number, v: number) => s + v, 0) / vals.length));
    }
  } finally {
    clearTimeout(tid);
  }
  return scores;
}

// ── Cache read helper ────────────────────────────────────────────────────────
interface CachePayload {
  fetchedAt:   number;
  isSimulated: boolean;
  weeks:       { weekOf: string; score: number }[];
}

function readCache(): CachePayload | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as CachePayload;
  } catch {
    return null;
  }
}

function writeCache(p: CachePayload) {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(p)); } catch { /* ignore */ }
}

// ── Route ────────────────────────────────────────────────────────────────────
router.get("/demand", async (req, res) => {
  try {
    const user = await getUserFromToken(req.headers.authorization);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    // Serve cache if fresh
    const cached = readCache();
    if (cached) {
      const ttl = cached.isSimulated ? RETRY_TTL_MS : CACHE_TTL_MS;
      if (Date.now() - cached.fetchedAt < ttl) {
        res.json({ weeks: cached.weeks, isSimulated: cached.isSimulated, cachedAt: new Date(cached.fetchedAt).toISOString() });
        return;
      }
    }

    // Attempt live fetch — English + Arabic (up to 5 terms each)
    try {
      const [enScores, arScores] = await Promise.all([
        fetchTrends(EN_TERMS, "en-US"),
        fetchTrends(AR_TERMS, "ar"),
      ]);
      const count = Math.min(enScores.length, arScores.length, 12);
      const now   = new Date();
      const weeks = Array.from({ length: count }, (_, i) => {
        const d = new Date(now);
        d.setDate(now.getDate() - (count - 1 - i) * 7);
        d.setHours(0, 0, 0, 0);
        return { weekOf: d.toISOString().split("T")[0], score: Math.round((enScores[i] + arScores[i]) / 2) };
      });
      const payload: CachePayload = { weeks, isSimulated: false, fetchedAt: Date.now() };
      writeCache(payload);
      res.json({ weeks, isSimulated: false, cachedAt: new Date().toISOString() });
    } catch (trendErr: any) {
      console.warn("[Intel/demand] Google Trends unavailable:", trendErr?.message ?? String(trendErr));
      const weeks = buildSimulatedWeeks();
      const payload: CachePayload = { weeks, isSimulated: true, fetchedAt: Date.now() };
      writeCache(payload);
      res.json({ weeks, isSimulated: true, cachedAt: new Date().toISOString() });
    }
  } catch (err: any) {
    console.error("[Intel/demand]", err);
    res.status(500).json({ error: err?.message ?? "Internal error" });
  }
});

export default router;
