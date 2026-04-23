import { useState, useCallback } from "react";

/**
 * Reusable bulk-select state for any list page (clients, invoices, bookings,
 * suppliers, drivers, follow-ups, requests). The page renders cards in a loop
 * — wrap each card with a checkbox that calls `toggle(id)` and lights up if
 * `isSelected(id)`. When `selectMode` is true, treat card clicks as a toggle
 * instead of navigation.
 */
export function useBulkSelect() {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const enterSelectMode = useCallback(() => {
    setSelectMode(true);
    setSelected(new Set());
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelected(new Set(ids));
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);
  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  return {
    selectMode,
    selected,
    count: selected.size,
    enterSelectMode,
    exitSelectMode,
    toggle,
    selectAll,
    clear,
    isSelected,
    ids: Array.from(selected),
  };
}
