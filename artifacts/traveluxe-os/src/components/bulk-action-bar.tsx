import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, X, Loader2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface BulkActionBarProps {
  count: number;
  noun: string;            // e.g. "invoice", "client", "booking"
  onClear: () => void;
  onDelete: () => Promise<void> | void;
  /** Optional extra confirm copy. */
  warning?: string;
}

/**
 * Floating bottom-of-screen bar shown when one or more rows are selected
 * via the page-level bulk select hook. Renders a destructive-style delete
 * button gated by an AlertDialog confirm. Caller passes the actual delete
 * fan-out via `onDelete` (typically Promise.all of the resource's existing
 * single-delete mutation).
 */
export function BulkActionBar({ count, noun, onClear, onDelete, warning }: BulkActionBarProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  if (count === 0) return null;

  const plural = count === 1 ? noun : `${noun}s`;

  const handleDelete = async () => {
    setRunning(true);
    try {
      await onDelete();
    } finally {
      setRunning(false);
      setConfirmOpen(false);
    }
  };

  return (
    <>
      <div
        className="fixed bottom-4 inset-x-3 sm:inset-x-auto sm:right-6 sm:left-auto z-40 flex items-center gap-3 px-4 py-3 rounded-xl border border-primary/40 bg-card shadow-2xl shadow-primary/20"
        data-testid="bulk-action-bar"
      >
        <div className="flex-1 sm:flex-initial text-sm font-semibold text-foreground">
          {count} {plural} selected
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="h-9"
          data-testid="button-bulk-clear"
        >
          <X className="w-4 h-4 mr-1" /> Clear
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setConfirmOpen(true)}
          className="h-9"
          disabled={running}
          data-testid="button-bulk-delete"
        >
          {running ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />}
          Delete {count}
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {count} {plural}?</AlertDialogTitle>
            <AlertDialogDescription>
              {warning ?? `This permanently removes ${count} ${plural}. Each deletion is logged in the audit trail. This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={running}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={running}
              data-testid="button-bulk-delete-confirm"
            >
              {running ? "Deleting…" : `Delete ${count}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
