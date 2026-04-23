import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History, LockOpen, Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
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

interface Props {
  bookingId: string;
}

const VEHICLE_ROW_ACTIONS = new Set([
  "unlock_booking_vehicle",
  "create_booking_vehicle",
  "update_booking_vehicle",
  "delete_booking_vehicle",
]);

function actionMeta(action: string): { label: string; icon: React.ReactNode; tone: "unlock" | "create" | "update" | "delete" | "default" } {
  switch (action) {
    case "unlock_booking_vehicle":
      return { label: "Unlocked vehicle", icon: <LockOpen className="w-3.5 h-3.5" />, tone: "unlock" };
    case "create_booking_vehicle":
      return { label: "Added vehicle", icon: <Plus className="w-3.5 h-3.5" />, tone: "create" };
    case "update_booking_vehicle":
      return { label: "Updated vehicle", icon: <Pencil className="w-3.5 h-3.5" />, tone: "update" };
    case "delete_booking_vehicle":
      return { label: "Removed vehicle", icon: <Trash2 className="w-3.5 h-3.5" />, tone: "delete" };
    default:
      return { label: action.replace(/_/g, " "), icon: <History className="w-3.5 h-3.5" />, tone: "default" };
  }
}

const toneClasses: Record<string, string> = {
  unlock: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  create: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  update: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  delete: "border-destructive/40 bg-destructive/10 text-destructive",
  default: "border-border bg-muted/40 text-muted-foreground",
};

export function BookingActivityPanel({ bookingId }: Props) {
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
        `/api/audit-log?entity_type=booking&entity_id=${encodeURIComponent(bookingId)}&limit=25`,
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
  }, [bookingId]);

  useEffect(() => {
    setEntries(null);
    fetchEntries();
  }, [bookingId, fetchEntries]);

  if (loading && entries === null) {
    return (
      <Card className="border-primary/10 bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="w-4 h-4" /> Activity
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
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="p-3 flex items-center justify-between gap-3">
          <div className="text-xs text-destructive">Couldn't load activity. {error}</div>
          <Button size="sm" variant="outline" onClick={fetchEntries}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  const list = entries ?? [];
  if (list.length === 0) return null;

  const unlockCount = list.filter(e => e.action === "unlock_booking_vehicle").length;

  return (
    <Card className="border-primary/10 bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <History className="w-4 h-4" /> Activity
            <Badge variant="outline" className="text-xs">{list.length}</Badge>
            {unlockCount > 0 && (
              <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400">
                <LockOpen className="w-3 h-3" /> {unlockCount} unlock{unlockCount === 1 ? "" : "s"}
              </Badge>
            )}
          </span>
          <Button size="sm" variant="ghost" onClick={fetchEntries} data-testid="btn-activity-refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Recent audit entries for this booking. Unlock events reopen settled or paid vehicle rows and are highlighted.
        </p>
        <ul className="space-y-1.5" data-testid="list-activity">
          {list.map((entry) => {
            const meta = actionMeta(entry.action);
            const isUnlock = entry.action === "unlock_booking_vehicle";
            return (
              <li
                key={entry.id}
                className={`rounded-md border p-2 text-xs ${isUnlock ? "border-amber-500/40 bg-amber-500/5" : "border-border/60 bg-background/40"}`}
                data-testid={`activity-${entry.action}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className={`text-[10px] gap-1 ${toneClasses[meta.tone]}`}
                    >
                      {meta.icon}
                      {meta.label}
                    </Badge>
                    {VEHICLE_ROW_ACTIONS.has(entry.action) && !isUnlock && (
                      <span className="text-[10px] text-muted-foreground">vehicle row</span>
                    )}
                  </div>
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
