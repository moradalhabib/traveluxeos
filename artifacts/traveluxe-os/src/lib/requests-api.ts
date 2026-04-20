import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

const API_BASE = "/api";

export type RequestStatus = "New" | "Following Up" | "Ready to Book" | "Converted" | "Declined" | "Expired";
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
};
