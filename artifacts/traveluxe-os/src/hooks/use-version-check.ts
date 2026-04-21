import { useEffect, useRef } from "react";
import { toast } from "sonner";

declare const __BUILD_VERSION__: string;

const POLL_INTERVAL_MS = 60_000;
const RELOAD_DELAY_MS = 3_000;

export function useVersionCheck() {
  const reloadingRef = useRef(false);
  const builtVersionRef = useRef<string>(
    typeof __BUILD_VERSION__ !== "undefined" ? __BUILD_VERSION__ : "dev",
  );

  useEffect(() => {
    if (builtVersionRef.current === "dev") return;

    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const url = `${import.meta.env.BASE_URL}version.json`;

    const check = async () => {
      if (cancelled || reloadingRef.current) return;
      try {
        const r = await fetch(`${url}?t=${Date.now()}`, {
          cache: "no-store",
          credentials: "omit",
        });
        if (!r.ok) return;
        const j = (await r.json()) as { version?: string };
        const remote = j?.version;
        if (!remote || remote === "dev") return;
        if (remote !== builtVersionRef.current) {
          reloadingRef.current = true;
          toast.success("A new version has been published — reloading…", {
            duration: RELOAD_DELAY_MS,
          });
          setTimeout(() => {
            window.location.reload();
          }, RELOAD_DELAY_MS);
        }
      } catch {
        /* network blip — retry next tick */
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };

    void check();
    timer = setInterval(check, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
