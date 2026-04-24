import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fmtLondon } from "@/lib/datetime";
import type { ActivityEntityType } from "./ActivityPanel";

type AuditEntry = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  entity_label: string | null;
  operator_id: string | null;
  operator_name: string | null;
  detail: string | null;
  created_at: string;
};

interface Props {
  entityType: ActivityEntityType;
  title?: string;
  limit?: number;
  className?: string;
}

export function RecentActivityFeed({
  entityType,
  title = "Recent activity",
  limit = 12,
  className,
}: Props) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const r = await fetch(
        `/api/audit-log?entity_type=${encodeURIComponent(entityType)}&limit=${limit}`,
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
  }, [entityType, limit]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const list = entries ?? [];
  const count = list.length;

  return (
    <Card
      className={`border-primary/10 bg-card ${className ?? ""}`}
      data-testid={`recent-activity-${entityType}`}
    >
      <CardHeader
        className="pb-2 cursor-pointer select-none hover:bg-muted/30 transition-colors rounded-t-xl"
        onClick={() => setIsOpen(o => !o)}
      >
        <CardTitle className="text-sm flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <History className="w-4 h-4" /> {title}
            {count > 0 && <Badge variant="outline" className="text-[10px]">{count}</Badge>}
          </span>
          <span className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => { e.stopPropagation(); fetchEntries(); }}
              disabled={loading}
              data-testid={`btn-recent-activity-refresh-${entityType}`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
            {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </span>
        </CardTitle>
      </CardHeader>
      {isOpen && (
        <CardContent className="space-y-1.5 pt-2">
          {error ? (
            <p className="text-xs text-destructive">Couldn't load activity. {error}</p>
          ) : loading && entries === null ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : count === 0 ? (
            <p className="text-xs text-muted-foreground">No recent activity.</p>
          ) : (
            <ul
              className="space-y-1.5"
              data-testid={`list-recent-activity-${entityType}`}
            >
              {list.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded-md border border-border/60 bg-background/40 p-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-foreground/90 truncate">
                      {entry.entity_label ?? entry.detail ?? entry.action.replace(/_/g, " ")}
                    </span>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {fmtLondon(entry.created_at, "d MMM · HH:mm")}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span className="truncate">{entry.action.replace(/_/g, " ")}</span>
                    <span className="whitespace-nowrap">
                      {entry.operator_name ?? "System"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      )}
    </Card>
  );
}
