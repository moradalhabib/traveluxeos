import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

const API_BASE = "/api";

export type RequestStatus = "New" | "Following Up" | "Ready to Book" | "Converted" | "Declined" | "Expired" | "Cancelled";

// Stock cancellation reasons offered in the cancel dialog. Operators can
// also free-type a fuller note. Persisted on the request row so dashboard
// drill-down + finance reporting can break down lost leads by cause.
export const CANCELLATION_REASONS = [
  "Price too high",
  "Client changed mind",
  "Booked elsewhere",
  "Out of budget",
  "Service unavailable",
  "Trip postponed",
  "No response from client",
  "Duplicate request",
  "Other",
] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];
export type RequestPriority = "Low" | "Medium" | "High" | "Urgent";
export type RequestServiceType = "Airport Transfer" | "Tour" | "Car Rental" | "Apartment" | "Hotel" | "Other";

export interface ClientRequest {
  id: string;
  client_id: string | null;
  client_name: string | null;
  client_whatsapp?: string | null;
  client_email?: string | null;
  service_type: RequestServiceType;
  priority: RequestPriority;
  requested_date_time: string | null;
  follow_up_date: string;
  status: RequestStatus;
  notes: string | null;
  estimated_price: number | null;
  converted_booking_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Present on Cancelled rows — hydrated from the users table by the list
  // endpoint using the same batched IN-lookup as the detail endpoint.
  cancelled_by_name?: string | null;
  cancelled_by_email?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
}

async function authFetch(path: string, init: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? "";
  const r = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  const body = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
  return body;
}

export interface ListRequestsParams {
  status?: RequestStatus | "";
  priority?: RequestPriority | "";
  client_id?: string;
  search?: string;
  sort?: "follow_up" | "created";
  cancellation_reason?: string;
}

const REQUESTS_KEY = (params: ListRequestsParams) => ["requests", params];

export function useListRequests(params: ListRequestsParams = {}) {
  return useQuery<ClientRequest[]>({
    queryKey: REQUESTS_KEY(params),
    queryFn: async () => {
      const q = new URLSearchParams();
      if (params.status) q.set("status", params.status);
      if (params.priority) q.set("priority", params.priority);
      if (params.client_id) q.set("client_id", params.client_id);
      if (params.search) q.set("search", params.search);
      if (params.sort) q.set("sort", params.sort);
      if (params.cancellation_reason) q.set("cancellation_reason", params.cancellation_reason);
      const qs = q.toString();
      return authFetch(`/requests${qs ? `?${qs}` : ""}`);
    },
  });
}

export function useRequest(id: string | undefined) {
  return useQuery<ClientRequest>({
    queryKey: ["request", id],
    enabled: !!id,
    queryFn: () => authFetch(`/requests/${id}`),
  });
}

export function useCreateRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<ClientRequest>) =>
      authFetch("/requests", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["requests"] }); },
  });
}

export function useUpdateRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<ClientRequest>) =>
      authFetch(`/requests/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["requests"] });
      qc.invalidateQueries({ queryKey: ["request", vars.id] });
    },
  });
}

export function useDeleteRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authFetch(`/requests/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["requests"] }); },
  });
}

export function useConvertRequest() {
  return useMutation({
    mutationFn: (id: string) => authFetch(`/requests/${id}/convert`, { method: "POST" }),
  });
}

// ── Style helpers ───────────────────────────────────────────────────────
export const PRIORITY_STYLES: Record<RequestPriority, string> = {
  Low:    "bg-slate-500/15 text-slate-300 border-slate-500/40",
  Medium: "bg-blue-500/15 text-blue-300 border-blue-500/40",
  High:   "bg-amber-500/15 text-amber-300 border-amber-500/40",
  Urgent: "bg-red-500/15 text-red-300 border-red-500/40",
};

export const STATUS_STYLES: Record<RequestStatus, string> = {
  "New":            "bg-blue-500/15 text-blue-300 border-blue-500/40",
  "Following Up":   "bg-amber-500/15 text-amber-300 border-amber-500/40",
  "Ready to Book":  "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  "Converted":      "bg-green-500/15 text-green-300 border-green-500/40",
  "Declined":       "bg-red-500/15 text-red-300 border-red-500/40",
  "Expired":        "bg-zinc-500/15 text-zinc-400 border-zinc-500/40",
  "Cancelled":      "bg-rose-500/15 text-rose-300 border-rose-500/40",
};

// ── Lost-lead reasons rollup ─────────────────────────────────────────────
// Aggregated server-side from cancelled requests + cancelled follow-ups
// for the Analytics page. Period drives a date window (this month is the
// default). NULL/blank reasons collapse into "Unspecified" so the chart
// always reflects total cancelled volume.
export type LostLeadPeriod = "this_month" | "last_30" | "this_year" | "all";

export interface LostLeadRow {
  reason: string;
  request_count: number;
  follow_up_count: number;
  total: number;
}

export interface LostLeadStats {
  period: LostLeadPeriod;
  since: string;
  rows: LostLeadRow[];
  total_request: number;
  total_follow_up: number;
  total_all: number;
}

export function useLostLeadStats(period: LostLeadPeriod) {
  return useQuery<LostLeadStats>({
    queryKey: ["lost-lead-stats", period],
    queryFn: () => authFetch(`/dashboard/lost-leads?period=${period}`),
  });
}

// Helper exposed for the cancel dialog so the route can mark a request
// Cancelled and capture the reason in one PUT — keeps the audit log
// row consistent with the badge shown across the app.
export function useCancelRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      authFetch(`/requests/${id}`, {
        method: "PUT",
        body: JSON.stringify({ status: "Cancelled", cancellation_reason: reason }),
      }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["requests"] });
      qc.invalidateQueries({ queryKey: ["request", vars.id] });
    },
  });
}

// Re-open a previously Cancelled request back to the New queue. The PUT
// route detects the Cancelled→New transition server-side and appends an
// "Re-opened (…) — was cancelled for: <reason>" audit line to notes.
// cancellation_reason / cancelled_at are intentionally preserved so the
// lost-lead reporting still sees the original loss.
export function useReopenRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authFetch(`/requests/${id}`, {
        method: "PUT",
        body: JSON.stringify({ status: "New" }),
      }),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["requests"] });
      qc.invalidateQueries({ queryKey: ["request", id] });
      qc.invalidateQueries({ queryKey: ["lost-lead-stats"] });
    },
  });
}

// Bulk-cancel a batch of requests with one shared reason. Hits the dedicated
// POST /requests/bulk-cancel route which mirrors the per-row PUT cancel logic
// server-side (notes appended, never overwritten; already-Cancelled rows
// silently skipped). The response carries a summary so the caller can show
// "12 cancelled, 2 already cancelled" in the toast.
export interface BulkCancelRequestsResult {
  cancelled: number;
  skipped: number;
  failed: number;
  missing: number;
  ids: {
    cancelled: string[];
    skipped: string[];
    failed: string[];
    missing: string[];
  };
}

export function useBulkCancelRequests() {
  const qc = useQueryClient();
  return useMutation<BulkCancelRequestsResult, Error, { ids: string[]; cancellation_reason: string }>({
    mutationFn: ({ ids, cancellation_reason }) =>
      authFetch("/requests/bulk-cancel", {
        method: "POST",
        body: JSON.stringify({ ids, cancellation_reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["requests"] });
      qc.invalidateQueries({ queryKey: ["lost-lead-stats"] });
    },
  });
}

// Bulk-cancel a batch of follow-ups with one shared reason. Hits the
// dedicated POST /follow-ups/bulk-cancel route which loops the same
// per-row cancel logic server-side (notes appended, never overwritten;
// already-cancelled rows silently skipped). The response carries a
// summary so the caller can show "12 cancelled, 2 already cancelled" in
// the toast. Lives next to useReopenFollowUp so the cancellation-
// lifecycle helpers stay in one place.
export interface BulkCancelFollowUpsResult {
  cancelled: number;
  skipped: number;
  failed: number;
  missing: number;
  ids: {
    cancelled: string[];
    skipped: string[];
    failed: string[];
    missing: string[];
  };
}

export function useBulkCancelFollowUps() {
  const qc = useQueryClient();
  return useMutation<BulkCancelFollowUpsResult, Error, { ids: string[]; cancellation_reason: string }>({
    mutationFn: ({ ids, cancellation_reason }) =>
      authFetch("/follow-ups/bulk-cancel", {
        method: "POST",
        body: JSON.stringify({ ids, cancellation_reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lost-lead-stats"] });
      // The follow-ups page itself doesn't use react-query for its list,
      // so it triggers fetchData() on success. Other consumers that DO
      // use react-query keys for follow-ups will pick up the change via
      // the page's broader qc.invalidateQueries() call.
    },
  });
}

// Same shape for follow-ups. The PATCH route detects cancelled→pending,
// appends the audit line server-side, clears completed_at/_by, and
// preserves cancellation_reason / cancelled_at. Lives here (alongside
// useReopenRequest) so the cancellation-lifecycle helpers stay in one
// place even though the follow-ups page otherwise uses a raw fetch helper.
export function useReopenFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authFetch(`/follow-ups/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "pending" }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lost-lead-stats"] });
      // Broad invalidation for the follow-ups page (which doesn't use
      // react-query for its list) is unnecessary — that page calls
      // fetchData() after the mutation. The dashboard summary key is
      // also invalidated by the page's own success path, so we only need
      // the cross-page lost-lead rollup here.
    },
  });
}
