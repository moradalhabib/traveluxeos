import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API_BASE = `${BASE}/api`;
setBaseUrl(API_BASE);

setAuthTokenGetter(() => {
  const raw = localStorage.getItem("traveluxe_token");
  return raw ?? null;
});

createRoot(document.getElementById("root")!).render(<App />);
