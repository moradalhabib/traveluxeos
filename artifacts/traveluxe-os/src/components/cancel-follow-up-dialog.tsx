import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Ban } from "lucide-react";

export const FOLLOW_UP_CANCEL_REASONS = [
  "Client booked elsewhere",
  "Client changed plans",
  "Trip postponed",
  "Pricing too high",
  "No response after multiple attempts",
  "Service unavailable",
  "Duplicate follow-up",
  "Other",
] as const;

interface CancelFollowUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: (reason: string, notes: string) => void | Promise<void>;
}

/**
 * Reason + free-text dialog reused for both the per-row Cancel action and
 * the bulk "Cancel selected" action on the Follow-Ups page. The visual
 * language is intentionally identical so operators see one consistent
 * pattern regardless of how many rows they're cancelling.
 */
export function CancelFollowUpDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  busy,
  onConfirm,
}: CancelFollowUpDialogProps) {
  const [reason, setReason] = useState<string>(FOLLOW_UP_CANCEL_REASONS[0]);
  const [notes, setNotes] = useState("");

  // Reset to defaults each time the dialog re-opens so a previous
  // selection (e.g. "Other" with notes) doesn't bleed across invocations.
  useEffect(() => {
    if (open) {
      setReason(FOLLOW_UP_CANCEL_REASONS[0]);
      setNotes("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              Why is this follow-up being cancelled?
            </label>
            <div className="grid grid-cols-1 gap-1.5">
              {FOLLOW_UP_CANCEL_REASONS.map(r => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  className={`text-left text-sm px-3 py-2 rounded-lg border transition-colors ${
                    reason === r
                      ? "bg-rose-500/10 border-rose-500/50 text-rose-300"
                      : "border-border text-foreground hover:bg-secondary/30"
                  }`}
                  data-testid={`cancel-reason-${r.replace(/\s+/g, "-").toLowerCase()}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              Additional notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any extra context for the audit log…"
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-rose-500/30 resize-none"
              data-testid="input-cancel-notes"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Keep follow-up
          </Button>
          <Button
            onClick={() => onConfirm(reason, notes)}
            disabled={busy}
            className="bg-rose-500 hover:bg-rose-600 text-white"
            data-testid="button-confirm-cancel-followup"
          >
            <Ban className="w-4 h-4 mr-1.5" /> {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
