import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import { supabase } from "@/lib/supabase";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
setBaseUrl(BASE || null);

// Always fetch a fresh (auto-refreshed) token from Supabase instead of
// reading the stale value stored in localStorage at login time.
setAuthTokenGetter(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
});

createRoot(document.getElementById("root")!).render(<App />);
