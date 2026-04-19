import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import { supabase } from "@/lib/supabase";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
setBaseUrl(BASE || null);

// Always fetch a fresh token from Supabase. getSession() returns the cached
// session, so we proactively call refreshSession() when the access token is
// within 60s of expiry — this prevents intermittent 401 "Token expired" errors.
setAuthTokenGetter(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = session.expires_at ?? 0;
  if (expiresAt - nowSec < 60) {
    const { data: { session: refreshed } } = await supabase.auth.refreshSession();
    return refreshed?.access_token ?? session.access_token ?? null;
  }
  return session.access_token ?? null;
});

createRoot(document.getElementById("root")!).render(<App />);
