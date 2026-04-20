import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

let _cachedCount = 0;
const _listeners: Set<(n: number) => void> = new Set();

function notify(n: number) {
  _cachedCount = n;
  _listeners.forEach(fn => fn(n));
}

let _channelReady = false;

async function fetchAndBroadcast() {
  const today = new Date().toISOString().split("T")[0];
  try {
    const { count } = await supabase
      .from("follow_ups")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .or(`due_date.is.null,due_date.lte.${today}`);
    notify(count ?? 0);
  } catch {
    // table may not exist yet
  }
}

function ensureChannel() {
  if (_channelReady) return;
  _channelReady = true;
  supabase
    .channel("follow-ups-global-badge")
    .on("postgres_changes", { event: "*", schema: "public", table: "follow_ups" }, () => {
      fetchAndBroadcast();
    })
    .subscribe();
}

export function useFollowUpBadge() {
  const [count, setCount] = useState(_cachedCount);

  const onUpdate = useCallback((n: number) => setCount(n), []);

  useEffect(() => {
    _listeners.add(onUpdate);
    fetchAndBroadcast();
    ensureChannel();
    return () => { _listeners.delete(onUpdate); };
  }, [onUpdate]);

  return count;
}
