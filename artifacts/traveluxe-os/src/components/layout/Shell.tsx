import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  LayoutDashboard, Users, FileText, CalendarRange,
  Briefcase, PlaneTakeoff, Car, Calculator, MessageSquare,
  LineChart, Search, Settings, LogOut, Plus, X, Lock, Receipt, Layers
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { NotificationBell } from "@/components/notifications/NotificationBell";

const MORE_ITEMS = [
  { href: "/quotes",       label: "Quotes",       icon: FileText },
  { href: "/invoices",     label: "Invoices",     icon: Receipt },
  { href: "/flights",      label: "Flights",      icon: PlaneTakeoff },
  { href: "/drivers",      label: "Drivers",      icon: Car },
  { href: "/commissions",  label: "Commissions",  icon: Calculator },
  { href: "/messages",     label: "Messages",     icon: MessageSquare },
  { href: "/finance",      label: "Finance",      icon: LineChart, reqSuperAdmin: true },
  { href: "/admin",        label: "Admin",        icon: Settings, reqAdmin: true },
];

const SIDEBAR_ITEMS = [
  { href: "/",             label: "Dashboard",    icon: LayoutDashboard },
  { href: "/jobs",         label: "Jobs Board",   icon: Briefcase },
  { href: "/bookings",     label: "Bookings",     icon: CalendarRange },
  { href: "/services",     label: "Services",     icon: Layers },
  { href: "/clients",      label: "Clients",      icon: Users },
  { href: "/search",       label: "Search",       icon: Search },
  { href: "/quotes",       label: "Quotes",       icon: FileText },
  { href: "/invoices",     label: "Invoices",     icon: Receipt },
  { href: "/flights",      label: "Flights",      icon: PlaneTakeoff },
  { href: "/drivers",      label: "Drivers",      icon: Car },
  { href: "/commissions",  label: "Commissions",  icon: Calculator },
  { href: "/messages",     label: "Messages",     icon: MessageSquare },
  { href: "/finance",      label: "Finance",      icon: LineChart, reqSuperAdmin: true },
  { href: "/admin",        label: "Admin",        icon: Settings, reqAdmin: true },
];

function LockScreen() {
  const { user, unlock, logout } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password,
      });
      if (authError) {
        setError("Incorrect password");
      } else {
        unlock();
      }
    } catch {
      setError("Unable to verify. Please try again.");
    } finally {
      setLoading(false);
      setPassword("");
    }
  };

  return (
    <div className="fixed inset-0 z-[999] bg-background/95 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-card border border-primary/20 rounded-2xl shadow-2xl p-8 space-y-6">
        <div className="text-center space-y-3">
          <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <Lock className="w-7 h-7 text-primary" />
          </div>
          <div>
            <h2 className="font-bold text-foreground text-lg">Session Locked</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Locked due to inactivity. Enter your password to continue.
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-secondary/30 px-4 py-3 text-center">
          <p className="text-sm font-medium text-foreground">{user?.name}</p>
          <p className="text-xs text-muted-foreground">{user?.email}</p>
        </div>

        <form onSubmit={handleUnlock} className="space-y-4">
          {error && (
            <p className="text-destructive text-xs text-center bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
            autoFocus
            className="h-12 border-primary/20 focus-visible:ring-primary"
          />
          <Button
            type="submit"
            className="w-full h-11 font-semibold"
            disabled={loading || !password}
          >
            {loading ? "Verifying..." : "Unlock"}
          </Button>
        </form>

        <button
          onClick={logout}
          className="w-full text-xs text-muted-foreground hover:text-destructive transition-colors text-center"
        >
          Sign out instead
        </button>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { user, logout, isLocked } = useAuth();
  const [location, setLocation] = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  if (!user) return <>{children}</>;

  const isSuperAdmin = user.role === "super_admin";

  if (isLocked) return <LockScreen />;

  const filteredSidebar = SIDEBAR_ITEMS.filter(item => {
    if ((item as any).reqSuperAdmin) return isSuperAdmin;
    if (item.reqAdmin) return user.role === "admin" || isSuperAdmin;
    return true;
  });
  const filteredMore = MORE_ITEMS.filter(item => {
    if ((item as any).reqSuperAdmin) return isSuperAdmin;
    if (item.reqAdmin) return user.role === "admin" || isSuperAdmin;
    return true;
  });

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-card border-r border-border h-screen sticky top-0">
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-xl">T</span>
            </div>
            <span className="font-bold text-lg text-foreground tracking-wide uppercase">TRAVELUXE OS</span>
          </div>
          <NotificationBell />
        </div>

        <div className="px-4 mb-4">
          <Link href="/bookings/new">
            <Button className="w-full h-11 font-semibold shadow-[0_0_15px_rgba(201,168,76,0.25)] hover:shadow-[0_0_25px_rgba(201,168,76,0.4)] transition-all">
              <Plus className="w-4 h-4 mr-2" />
              New Booking
            </Button>
          </Link>
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
          {filteredSidebar.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
                <item.icon className="w-5 h-5 flex-shrink-0" />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3 mb-4 px-3">
            <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-foreground font-medium uppercase">
              {user.name.charAt(0)}
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{user.name}</p>
              <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
            </div>
          </div>
          <Button variant="outline" className="w-full justify-start text-muted-foreground" onClick={logout}>
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>
      </aside>

      {/* Mobile: sticky header with notification bell */}
      <div className="md:hidden sticky top-0 z-40 flex items-center justify-between px-4 py-3 bg-card/95 backdrop-blur-sm border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-base">T</span>
          </div>
          <span className="font-bold text-sm text-foreground tracking-wider uppercase">Traveluxe OS</span>
        </div>
        <NotificationBell />
      </div>

      {/* Main Content */}
      <main className="flex-1 pb-24 md:pb-0 min-h-screen overflow-x-hidden relative">
        <div className="p-4 md:p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50 flex items-center justify-around px-1" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <Link href="/" className={`flex flex-col items-center justify-center w-14 h-16 ${location === '/' ? 'text-primary' : 'text-muted-foreground'}`}>
          <LayoutDashboard className="w-5 h-5 mb-1" />
          <span className="text-[10px] font-medium">Home</span>
        </Link>

        <Link href="/jobs" className={`flex flex-col items-center justify-center w-14 h-16 ${location.startsWith('/jobs') ? 'text-primary' : 'text-muted-foreground'}`}>
          <Briefcase className="w-5 h-5 mb-1" />
          <span className="text-[10px] font-medium">Jobs</span>
        </Link>

        {/* Centre New Booking */}
        <div className="flex flex-col items-center justify-center w-16 h-16 -mt-4">
          <Link href="/bookings/new">
            <button className="w-14 h-14 rounded-full bg-primary flex items-center justify-center shadow-[0_0_20px_rgba(201,168,76,0.5)] hover:shadow-[0_0_30px_rgba(201,168,76,0.7)] active:scale-95 transition-all">
              <Plus className="w-7 h-7 text-primary-foreground" />
            </button>
          </Link>
          <span className="text-[9px] font-medium text-primary mt-0.5">Book</span>
        </div>

        <Link href="/services" className={`flex flex-col items-center justify-center w-14 h-16 ${location.startsWith('/services') ? 'text-primary' : 'text-muted-foreground'}`}>
          <Layers className="w-5 h-5 mb-1" />
          <span className="text-[10px] font-medium">Services</span>
        </Link>

        <button
          onClick={() => setMoreOpen(true)}
          className={`flex flex-col items-center justify-center w-14 h-16 ${moreOpen ? 'text-primary' : 'text-muted-foreground'}`}
        >
          <div className="grid grid-cols-2 gap-0.5 w-5 h-5 mb-1">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-sm bg-current" />
            ))}
          </div>
          <span className="text-[10px] font-medium">More</span>
        </button>
      </nav>

      {/* More Drawer */}
      {moreOpen && (
        <>
          <div className="md:hidden fixed inset-0 bg-black/60 z-50 backdrop-blur-sm" onClick={() => setMoreOpen(false)} />
          <div className="md:hidden fixed bottom-0 left-0 right-0 bg-card rounded-t-2xl z-50 border-t border-border shadow-2xl">
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            <div className="flex items-center justify-between px-5 pb-4">
              <span className="font-bold text-foreground text-lg">All Modules</span>
              <button onClick={() => setMoreOpen(false)} className="text-muted-foreground p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mx-5 mb-4 p-3 rounded-xl bg-secondary/50 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold uppercase">
                {user.name.charAt(0)}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{user.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
              </div>
            </div>
            <div className="px-5 pb-3">
              <button
                onClick={() => { setLocation("/"); setMoreOpen(false); }}
                className={`w-full flex items-center justify-center gap-2.5 py-3 rounded-xl border transition-all font-semibold text-sm ${location === '/' ? 'bg-primary/10 border-primary/50 text-primary' : 'bg-primary/5 border-primary/20 text-primary hover:bg-primary/15'}`}
              >
                <LayoutDashboard className="w-4 h-4" />
                Return to Dashboard
              </button>
            </div>
            <div className="px-5 pb-4 grid grid-cols-3 gap-3">
              {filteredMore.map((item) => {
                const isActive = location === item.href || (item.href !== '/' && location.startsWith(item.href));
                return (
                  <button
                    key={item.href}
                    onClick={() => { setLocation(item.href); setMoreOpen(false); }}
                    className={`flex flex-col items-center justify-center gap-2 p-4 rounded-xl border transition-all ${isActive ? 'bg-primary/10 border-primary/50 text-primary' : 'bg-secondary/30 border-border text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
                  >
                    <item.icon className="w-5 h-5" />
                    <span className="text-[11px] font-medium">{item.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="px-5 pb-6">
              <button
                onClick={() => { logout(); setMoreOpen(false); }}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-destructive/30 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
