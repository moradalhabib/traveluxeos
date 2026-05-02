/**
 * SLA helper — computes a small "tone + label" pair for the SLA pill
 * shown on the Requests and Follow-ups list pages.
 *
 * Thresholds live here (and only here) so an operator can later ask to
 * tune them in a single place without hunting across components.
 *
 * Computed on the client from existing fields — no new column, no new
 * endpoint, no schedule jobs.
 */

export type SlaTone = "neutral" | "amber" | "red";

export interface SlaState {
  tone: SlaTone | null;
  label: string | null;
}

// Defaults — kept simple per the task. A single threshold across all
// priorities for now; per-priority SLAs are explicitly out of scope.
export const SLA_THRESHOLDS = {
  request: {
    amberHours: 4,   // New + 4h → amber pill
    redHours: 12,    // New + 12h → red pill ("Overdue")
  },
  followUp: {
    // Amber on the calendar day the follow-up is due, red once the due
    // date has slipped by a full calendar day.
  },
} as const;

const TERMINAL_STATUSES = new Set([
  // Requests
  "Cancelled", "Converted", "Declined", "Expired", "Booked", "Ready to Book",
  // Follow-ups
  "done", "booked_return", "no_response", "cancelled",
]);

/**
 * Compact age formatter — "5m" / "3h" / "2d". Mirrors the short style
 * the task asked for ("2h", "1d", "Overdue 2d") rather than the verbose
 * "2 hours ago" output of date-fns.
 */
function compactAge(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function parseDateOnly(s: string): Date {
  // Accepts both "YYYY-MM-DD" and full ISO strings; collapses to local
  // midnight so the calendar-day comparisons used for follow-ups don't
  // jump a day across timezones.
  const datePart = s.length >= 10 ? s.slice(0, 10) : s;
  return new Date(`${datePart}T00:00:00`);
}

export interface GetSlaStateInput {
  createdAt?: string | null;
  followUpDate?: string | null;
  status?: string | null;
  /** Injectable for tests. Defaults to `Date.now()`. */
  now?: number;
}

/**
 * Pure function: given a row's creation time / follow-up due date /
 * status, returns the SLA pill tone and label. Returns `{ tone: null,
 * label: null }` for terminal rows so the caller can render nothing.
 */
export function getSlaState({
  createdAt,
  followUpDate,
  status,
  now = Date.now(),
}: GetSlaStateInput): SlaState {
  if (status && TERMINAL_STATUSES.has(status)) {
    return { tone: null, label: null };
  }

  // ── Follow-ups (status === "pending") ───────────────────────────────
  // Driven by the row's due date. Amber on the day it's due, red once
  // it's overdue by a full calendar day, neutral grey while still in
  // the future (so operators get a quiet "in 2d" signal too).
  if (status === "pending" && followUpDate) {
    const due = startOfDay(parseDateOnly(followUpDate));
    const today = startOfDay(new Date(now));
    const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
    if (diffDays < 0) {
      const overdue = Math.abs(diffDays);
      return { tone: "red", label: `Overdue ${overdue}d` };
    }
    if (diffDays === 0) return { tone: "amber", label: "Due today" };
    return { tone: "neutral", label: `in ${diffDays}d` };
  }

  // ── Requests (status === "New" / "Following Up") ────────────────────
  // Driven by created_at. Only `New` triggers amber/red breach (a
  // request that's been sitting unactioned). `Following Up` rows still
  // get a neutral pill so the elapsed time is visible at a glance — an
  // operator already engaged with the lead doesn't need a colour alarm.
  if (createdAt) {
    const createdMs = new Date(createdAt).getTime();
    if (Number.isFinite(createdMs)) {
      const ageMs = Math.max(0, now - createdMs);
      const ageHours = ageMs / 3_600_000;
      const label = compactAge(ageMs);
      if (status === "New") {
        if (ageHours >= SLA_THRESHOLDS.request.redHours) {
          return { tone: "red", label: `Overdue ${label}` };
        }
        if (ageHours >= SLA_THRESHOLDS.request.amberHours) {
          return { tone: "amber", label };
        }
        return { tone: "neutral", label };
      }
      if (status === "Following Up") {
        return { tone: "neutral", label };
      }
    }
  }

  return { tone: null, label: null };
}
