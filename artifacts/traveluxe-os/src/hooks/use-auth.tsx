import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
  isLocked: boolean;
  unlock: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const ACTIVE_CHECK_INTERVAL = 5 * 60 * 1000; // re-validate every 5 minutes

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem("traveluxe_session");
    return stored ? JSON.parse(stored) : null;
  });
  const [isLocked, setIsLocked] = useState(false);
  const [, setLocation] = useLocation();

  const logout = useCallback(() => {
    setUser(null);
    setIsLocked(false);
    localStorage.removeItem("traveluxe_session");
    localStorage.removeItem("traveluxe_token");
    supabase.auth.signOut().catch(() => {});
    setLocation("/login");
  }, [setLocation]);

  // ── Validate Supabase session + active status on app load ────────────────
  useEffect(() => {
    const validateSession = async () => {
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error || !session) {
        // Token is expired or invalid — force logout
        if (user) logout();
        return;
      }

      // Re-fetch user profile to check active status
      const { data: profile, error: profileError } = await supabase
        .from("users")
        .select("id, name, email, role, active")
        .eq("id", session.user.id)
        .single();

      if (profileError || !profile || profile.active === false) {
        // Account deactivated or not found — boot immediately
        logout();
        return;
      }

      // Update session with latest profile in case role changed
      setUser({
        id: profile.id,
        name: profile.name,
        email: profile.email,
        role: profile.role,
      });
      localStorage.setItem("traveluxe_session", JSON.stringify({
        id: profile.id,
        name: profile.name,
        email: profile.email,
        role: profile.role,
      }));
    };

    // Run on mount (skip if no stored session)
    const stored = localStorage.getItem("traveluxe_session");
    if (stored) {
      validateSession();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Periodic active status re-check (every 5 min while app is open) ─────
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { logout(); return; }

      const { data: profile } = await supabase
        .from("users")
        .select("active")
        .eq("id", user.id)
        .single();

      if (!profile || profile.active === false) {
        logout();
      }
    }, ACTIVE_CHECK_INTERVAL);

    return () => clearInterval(interval);
  }, [user, logout]);

  // ── Inactivity lock ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    let timeout: NodeJS.Timeout;

    const resetTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        setIsLocked(true);
      }, INACTIVITY_TIMEOUT);
    };

    window.addEventListener("mousemove", resetTimeout);
    window.addEventListener("keydown", resetTimeout);
    window.addEventListener("click", resetTimeout);
    window.addEventListener("scroll", resetTimeout);
    window.addEventListener("touchstart", resetTimeout);

    resetTimeout();

    return () => {
      clearTimeout(timeout);
      window.removeEventListener("mousemove", resetTimeout);
      window.removeEventListener("keydown", resetTimeout);
      window.removeEventListener("click", resetTimeout);
      window.removeEventListener("scroll", resetTimeout);
      window.removeEventListener("touchstart", resetTimeout);
    };
  }, [user]);

  const login = (newUser: User) => {
    setUser(newUser);
    setIsLocked(false);
    localStorage.setItem("traveluxe_session", JSON.stringify(newUser));
  };

  const unlock = () => {
    setIsLocked(false);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLocked, unlock }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
