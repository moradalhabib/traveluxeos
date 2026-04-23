import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  History,
  LockOpen,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Mail,
  Receipt,
  PoundSterling,
  Star,
  Merge,
  AlertTriangle,
  Send,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fmtLondon } from "@/lib/datetime";

type AuditEntry = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  operator_id: string | null;
  operator_name: string | null;
  detail: string | null;
  created_at: string;
};

export type ActivityEntityType =
  | "booking"
  | "client"
  | "driver"
  | "invoice"
  | "supplier"
  | "supplier_product"
  | "request"
  | "task";

interface Props {
  entityType: ActivityEntityType;
  entityId: string;
  title?: string;
  description?: string;
  limit?: number;
}

type Tone = "create" | "update" | "delete" | "unlock" | "success" | "warn" | "info" | "default";

type Meta = { label: string; icon: React.ReactNode; tone: Tone };

const ICON_CLASS = "w-3.5 h-3.5";

const TONE_CLASSES: Record<Tone, string> = {
  unlock: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  create: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  update: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  delete: "border-destructive/40 bg-destructive/10 text-destructive",
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  info: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  default: "border-border bg-muted/40 text-muted-foreground",
};

// Per-entity action labels. Anything not listed falls through to a humanised
// version of the action key with a generic icon, so unfamiliar actions still
// render meaningfully.
const ACTION_META: Partial<Record<ActivityEntityType, Record<string, Meta>>> = {
  booking: {
    create_booking: { label: "Created booking", icon: <Plus className={ICON_CLASS} />, tone: "create" },
    amend_booking: { label: "Amended booking", icon: <Pencil className={ICON_CLASS} />, tone: "update" },
    cancel_booking: { label: "Cancelled booking", icon: <XCircle className={ICON_CLASS} />, tone: "delete" },
    status_change: { label: "Status changed", icon: <Pencil className={ICON_CLASS} />, tone: "update" },
    auto_active: { label: "Auto-activated", icon: <CheckCircle2 className={ICON_CLASS} />, tone: "success" },
    reminder_sent: { label: "Reminder sent", icon: <Mail className={ICON_CLASS} />, tone: "info" },
    driver_email_sent: { label: "Driver emailed", icon: <Send className={ICON_CLASS} />, tone: "info" },
    driver_declined: { label: "Driver declined", icon: <XCircle className={ICON_CLASS} />, tone: "warn" },
    add_waiting_time: { label: "Waiting time added", icon: <Pencil className={ICON_CLASS} />, tone: "update" },
    create_return_journey: { label: "Return journey created", icon: <Plus className={ICON_CLASS} />, tone: "create" },
    dismiss_return_followup: { label: "Return follow-up dismissed", icon: <XCircle className={ICON_CLASS} />, tone: "default" },
    arrangement_fee_updated: { label: "Arrangement fee updated", icon: <PoundSterling className={ICON_CLASS} />, tone: "update" },
    unlock_booking_vehicle: { label: "Unlocked vehicle", icon: <LockOpen className={ICON_CLASS} />, tone: "unlock" },
    create_booking_vehicle: { label: "Added vehicle", icon: <Plus className={ICON_CLASS} />, tone: "create" },
    update_booking_vehicle: { label: "Updated vehicle", icon: <Pencil className={ICON_CLASS} />, tone: "update" },
    delete_booking_vehicle: { label: "Removed vehicle", icon: <Trash2 className={ICON_CLASS} />, tone: "delete" },
  },
  client: {
    create_client: { label: "Created client", icon: <Plus className={ICON_CLASS} />, tone: "create" },
    update_client: { label: "Updated client", icon: <Pencil className={ICON_CLASS} />, tone: "update" },
    delete_client: { label: "Deleted client", icon: <Trash2 className={ICON_CLASS} />, tone: "delete" },
    merge_clients: { label: "Merged clients", icon: <Merge className={ICON_CLASS} />, tone: "info" },
  },
  driver: {
    create_driver: { label: "Created driver", icon: <Plus className={ICON_CLASS} />, tone: "create" },
    update_driver: { label: "Updated driver", icon: <Pencil className={ICON_CLASS} />, tone: "update" },
    delete_driver: { label: "Deleted driver", icon: <Trash2 className={ICON_CLASS} />, tone: "delete" },
    rate_driver: { label: "Rated driver", icon: <Star className={ICON_CLASS} />, tone: "info" },
    commission_settled: { label: "Commission settled", icon: <CheckCircle2 className={ICON_CLASS} />, tone: "success" },
    payout_made: { label: "Payout made", icon: <PoundSterling className={ICON_CLASS} />, tone: "success" },
  },
  invoice: {
    create_invoice: { label: "Created invoice", icon: <Plus className={ICON_CLASS} />, tone: "create" },
    update_invoice: { label: "Updated invoice", icon: <Pencil className={ICON_CLASS} />, tone: "update" },
    delete_invoice: { label: "Deleted invoice", icon: <Trash2 className={ICON_CLASS} />, tone: "delete" },
    update_invoice_status: { label: "Status changed", icon: <Receipt className={ICON_CLASS} />, tone: "update" },
    status_change: { label: "Status changed", icon: <Receipt className={ICON_CLASS} />, tone: "update" },
    invoice_paid: { label: "Marked paid", icon: <CheckCircle2 className={ICON_CLASS} />, tone: "success" },
    invoice_sent: { label: "Invoice sent", icon: <Send className={ICON_CLASS} />, tone: "info" },
  },
  supplier: {
    create_supplier: { label: "Created supplier", icon: <Plus className={ICON_CLASS} />, tone: "create" },
    update_supplier: { label: "Updated supplier", icon: <Pencil className={ICON_CLASS} />, tone: "update" },
    delete_supplier: { label: "Deleted supplier", icon: <Trash2 className={ICON_CLASS} />, tone: "delete" },
    deactivate_supplier: { label: "Deactivated supplier", icon: <AlertTriangle className={ICON_CLASS} />, tone: "warn" },
    supplier_balance_mark_paid: { label: "Balance marked paid", icon: <CheckCircle2 className={ICON_CLASS} />, tone: "success" },
    supplier_balance_unmark_paid: { label: "Balance reopened", icon: <LockOpen className={ICON_CLASS} />, tone: "warn" },
    create_supplier_product: { label: "Added product", icon: <Plus className={ICON_CLASS} />, tone: "create" },
    update_supplier_product: { label: "Updated product", icon: <Pencil className={ICON_CLASS} />, tone: "update" },
    delete_supplier_product: { label: "Removed product", icon: <Trash2 className={ICON_CLASS} />, tone: "delete" },
  },
};

function humanise(action: string): string {
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function metaFor(entityType: ActivityEntityType, action: string): Meta {
  const fromEntity = ACTION_META[entityType]?.[action];
  if (fromEntity) return fromEntity;
  // Fallback heuristics so unfamiliar actions still get a reasonable tone.
  if (action.startsWith("create_") || action.startsWith("add_")) {
    return { label: humanise(action), icon: <Plus className={ICON_CLASS} />, tone: "create" };
  }
  if (action.startsWith("update_") || action.startsWith("amend_") || action.startsWith("edit_")) {
    return { label: humanise(action), icon: <Pencil className={ICON_CLASS} />, tone: "update" };
  }
  if (action.startsWith("delete_") || action.startsWith("remove_") || action.startsWith("cancel_")) {
    return { label: humanise(action), icon: <Trash2 className={ICON_CLASS} />, tone: "delete" };
  }
  if (action.startsWith("unlock_") || action.includes("reopen")) {
    return { label: humanise(action), icon: <LockOpen className={ICON_CLASS} />, tone: "unlock" };
  }
  return { label: humanise(action), icon: <History className={ICON_CLASS} />, tone: "default" };
}

export function ActivityPanel({ entityType, entityId, title = "Activity", description, limit = 25 }: Props) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const r = await fetch(
        `/api/audit-log?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}&limit=${limit}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!r.ok) throw new Error(await r.text());
      const data = (await r.json()) as AuditEntry[];
      setEntries(data ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId, limit]);

  useEffect(() => {
    setEntries(null);
    fetchEntries();
  }, [entityType, entityId, fetchEntries]);

  if (loading && entries === null) {
    return (
      <Card className="border-primary/10 bg-card" data-testid={`activity-panel-${entityType}`}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="w-4 h-4" /> {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/40 bg-destructive/5" data-testid={`activity-panel-${entityType}`}>
        <CardContent className="p-3 flex items-center justify-between gap-3">
          <div className="text-xs text-destructive">Couldn't load activity. {error}</div>
          <Button size="sm" variant="outline" onClick={fetchEntries}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  const list = entries ?? [];
  if (list.length === 0) return null;

  return (
    <Card className="border-primary/10 bg-card" data-testid={`activity-panel-${entityType}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <History className="w-4 h-4" /> {title}
            <Badge variant="outline" className="text-xs">{list.length}</Badge>
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={fetchEntries}
            data-testid={`btn-activity-refresh-${entityType}`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        <ul className="space-y-1.5" data-testid={`list-activity-${entityType}`}>
          {list.map((entry) => {
            const meta = metaFor(entityType, entry.action);
            return (
              <li
                key={entry.id}
                className="rounded-md border border-border/60 bg-background/40 p-2 text-xs"
                data-testid={`activity-${entry.action}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className={`text-[10px] gap-1 ${TONE_CLASSES[meta.tone]}`}>
                    {meta.icon}
                    {meta.label}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {fmtLondon(entry.created_at, "d MMM · HH:mm")}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-foreground/90">{entry.detail || "—"}</span>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {entry.operator_name ?? "System"}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
