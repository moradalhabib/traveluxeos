import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ShieldAlert, Lock } from "lucide-react";

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 60;

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const [, setLocation] = useLocation();

  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Restore lock state from sessionStorage (persists across page refreshes but not browser close)
  useEffect(() => {
    const stored = sessionStorage.getItem("tvl_lock");
    if (stored) {
      const { until, count } = JSON.parse(stored);
      const now = Date.now();
      if (until > now) {
        setLockedUntil(until);
        setAttempts(count);
        setCountdown(Math.ceil((until - now) / 1000));
      } else {
        sessionStorage.removeItem("tvl_lock");
      }
    }
  }, []);

  // Countdown timer
  useEffect(() => {
    if (!lockedUntil) return;
    timerRef.current = setInterval(() => {
      const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setLockedUntil(null);
        setAttempts(0);
        setCountdown(0);
        sessionStorage.removeItem("tvl_lock");
        if (timerRef.current) clearInterval(timerRef.current);
      } else {
        setCountdown(remaining);
      }
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [lockedUntil]);

  const recordFailure = () => {
    const newCount = attempts + 1;
    setAttempts(newCount);
    if (newCount >= MAX_ATTEMPTS) {
      const until = Date.now() + LOCKOUT_SECONDS * 1000;
      setLockedUntil(until);
      setCountdown(LOCKOUT_SECONDS);
      sessionStorage.setItem("tvl_lock", JSON.stringify({ until, count: newCount }));
      setError(`Too many failed attempts. Access locked for ${LOCKOUT_SECONDS} seconds.`);
    } else {
      const remaining = MAX_ATTEMPTS - newCount;
      setError(`Invalid credentials. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before lockout.`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockedUntil) return;

    setError(null);
    setLoading(true);

    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError || !authData.session) {
        recordFailure();
        return;
      }

      const token = authData.session.access_token;

      // Fetch profile including active status
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("id, name, email, role, active")
        .eq("id", authData.user.id)
        .single();

      if (userError || !userData) {
        // Valid Supabase auth but not in our users table — deny access
        await supabase.auth.signOut();
        setError("Your account is not registered in the system. Contact your administrator.");
        return;
      }

      // Check active status — this is the gate for approved access
      if (userData.active === false) {
        await supabase.auth.signOut();
        setError("Your access has been suspended. Please contact your administrator.");
        return;
      }

      // All clear — grant access
      localStorage.setItem("traveluxe_token", token);
      sessionStorage.removeItem("tvl_lock");
      login({ id: userData.id, name: userData.name, email: userData.email, role: userData.role });

      // super_admin goes to admin panel
      if (userData.role === "super_admin") {
        setLocation("/admin");
      } else {
        setLocation("/");
      }
    } catch (err: any) {
      if (err?.message?.includes("VITE_SUPABASE_URL") || err?.message?.includes("VITE_SUPABASE_ANON_KEY")) {
        setError("Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Secrets.");
      } else {
        recordFailure();
      }
    } finally {
      setLoading(false);
    }
  };

  const isLocked = !!(lockedUntil && lockedUntil > Date.now());

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-primary/20 shadow-2xl">
        <CardHeader className="space-y-2 text-center pb-8">
          <img
            src="/TVL_logo_original.png"
            alt="Traveluxe"
            className="mx-auto h-24 w-auto object-contain mb-4 drop-shadow-[0_0_25px_rgba(201,168,76,0.25)]"
          />
          <CardTitle className="text-2xl font-bold tracking-tight uppercase text-foreground">
            Traveluxe OS
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Command Centre — Mayfair, London
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {isLocked ? (
              <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-5 text-center space-y-3">
                <Lock className="w-8 h-8 mx-auto text-destructive" />
                <div>
                  <p className="font-semibold text-destructive">Access Temporarily Locked</p>
                  <p className="text-sm text-muted-foreground mt-1">Too many failed attempts.</p>
                </div>
                <div className="text-3xl font-mono font-bold text-destructive">{countdown}s</div>
                <p className="text-xs text-muted-foreground">Locked until timer expires</p>
              </div>
            ) : (
              <>
                {error && (
                  <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-4 py-3 flex items-start gap-2">
                    <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="operator@traveluxelondon.com"
                    required
                    autoComplete="email"
                    className="h-12 border-primary/20 focus-visible:ring-primary"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="h-12 border-primary/20 focus-visible:ring-primary"
                  />
                </div>
              </>
            )}

            {!isLocked && (
              <Button
                type="submit"
                disabled={loading || isLocked}
                className="w-full h-12 text-lg font-medium shadow-[0_0_15px_rgba(201,168,76,0.3)] hover:shadow-[0_0_25px_rgba(201,168,76,0.5)] transition-all"
              >
                {loading ? "Verifying..." : "Sign In"}
              </Button>
            )}
          </form>

          {/* Security notice — no sign-up link, no password reset visible */}
          <div className="mt-6 pt-4 border-t border-border flex items-center justify-center gap-2">
            <ShieldAlert className="w-3.5 h-3.5 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground/50 text-center">
              Restricted access. Authorised personnel only.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
