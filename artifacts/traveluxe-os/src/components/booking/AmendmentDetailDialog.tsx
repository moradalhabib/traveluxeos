import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Pencil } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fmtLondon } from "@/lib/datetime";

type AmendRow = {
  id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  change_type: string | null;
  reason: string | null;
  changed_at: string;
  changed_by_name: string | null;
};

interface Props {
  open: boolean;
  onClose: () => void;
  bookingId: string;
  auditCreatedAt: string;
  operatorName?: string | null;
}

export function AmendmentDetailDialog({ open, onClose, bookingId, auditCreatedAt, operatorName }: Props) {
  const [rows, setRows] = useState<AmendRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? "";
        const r = await fetch(`/api/amendments?booking_id=${encodeURIComponent(bookingId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(await r.text());
        const all: AmendRow[] = (await r.json()) ?? [];
        const auditMs = new Date(auditCreatedAt).getTime();
        const matched = all.filter((a) => {
          const diff = Math.abs(new Date(a.changed_at).getTime() - auditMs);
          return diff <= 90_000;
        });
        if (!cancelled) setRows(matched);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load details");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, bookingId, auditCreatedAt]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm w-[92vw]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Pencil className="w-4 h-4 text-primary" />
            What was amended
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2.5">
          <p className="text-[10px] text-muted-foreground">
            {fmtLondon(auditCreatedAt, "d MMM yyyy · HH:mm")}
            {operatorName ? ` · ${operatorName}` : ""}
          </p>

          {loading && (
            <p className="text-xs text-muted-foreground py-2">Loading changes…</p>
          )}
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
          {!loading && !error && rows.length === 0 && (
            <p className="text-xs text-muted-foreground italic py-2">
              No field-level detail recorded for this amendment.
            </p>
          )}
          {!loading && rows.length > 0 && (
            <ul className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="rounded-md border border-border/60 bg-background/50 px-2.5 py-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-semibold text-foreground">{row.field_name}</span>
                    {row.change_type && (
                      <Badge variant="outline" className="text-[9px] py-0 px-1.5 capitalize shrink-0">
                        {row.change_type.replace(/_/g, " ")}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-start gap-1.5 text-[11px] leading-relaxed">
                    <span className="text-muted-foreground line-through break-all min-w-0">
                      {row.old_value ?? "—"}
                    </span>
                    <span className="text-muted-foreground shrink-0 mt-px">→</span>
                    <span className="text-foreground font-medium break-all min-w-0">
                      {row.new_value ?? "—"}
                    </span>
                  </div>
                  {row.reason && (
                    <p className="mt-1 text-[10px] text-amber-400 italic">
                      Note: {row.reason}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
