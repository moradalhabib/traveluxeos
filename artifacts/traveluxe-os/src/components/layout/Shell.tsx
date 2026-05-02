import { ReactNode, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  LayoutDashboard, Users, ClipboardList, CalendarRange,
  Briefcase, PlaneTakeoff, Car, Calculator, MessageSquare,
  LineChart, Search, Settings, LogOut, Plus, X, Lock, Receipt, Layers, Home,
  Megaphone, PhoneCall, Building2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { CommandPalette } from "@/components/command-palette";
import { useFollowUpBadge } from "@/hooks/use-follow-up-badge";
import { useListBookings, getListBookingsQueryKey } from "@workspace/api-client-react";

// ─── Nav definitions per role ───────────────────────────────────────────────

// Roles:
//   super_admin → everything (incl. Profit tab)
//   admin       → everything (Commissions, Finance and Admin Panel now open per operational matrix)
//   operator    → everything EXCEPT user-mgmt section + Profit tab
//   viewer      → READ-ONLY on Clients, Bookings, Jobs only
//   residence_manager → kept (apartments only)

const OPERATOR_SIDEBAR = [
  { href: "/",             label: "Dashboard",    icon: LayoutDashboard },
  { href: "/jobs",         label: "Jobs Board",   icon: Briefcase },
  { href: "/bookings",     label: "Bookings",     icon: CalendarRange },
  { href: "/follow-ups",   label: "Follow-Ups",   icon: PhoneCall, badge: true },
  { href: "/services",     label: "Service",      icon: Layers },
  { href: "/clients",      label: "Clients",      icon: Users },
  { href: "/analytics",    label: "Intel",        icon: LineChart },
  { href: "/search",       label: "Search",       icon: Search },
  { href: "/requests",     label: "Requests",     icon: ClipboardList },
  { href: "/invoices",     label: "Invoices",     icon: Receipt },
  { href: "/flights",      label: "Flights",      icon: PlaneTakeoff },
  { href: "/drivers",      label: "Drivers",      icon: Car },
  { href: "/suppliers",    label: "Suppliers",    icon: Building2 },
  { href: "/commissions",  label: "Commissions",  icon: Calculator },
  { href: "/messages",     label: "Messages",     icon: MessageSquare },
  { href: "/finance",      label: "Finance",      icon: LineChart },
  { href: "/marketing",    label: "Marketing",    icon: Megaphone },
  { href: "/admin",        label: "Admin",        icon: Settings },
];

const OPERATOR_MORE = [
  { href: "/follow-ups",   label: "Follow-Ups",   icon: PhoneCall, badge: true },
  { href: "/analytics",    label: "Intel",        icon: LineChart },
  { href: "/requests",     label: "Requests",     icon: ClipboardList },
  { href: "/invoices",     label: "Invoices",     icon: Receipt },
  { href: "/flights",      label: "Flights",      icon: PlaneTakeoff },
  { href: "/drivers",      label: "Drivers",      icon: Car },
  { href: "/suppliers",    label: "Suppliers",    icon: Building2 },
  { href: "/commissions",  label: "Commissions",  icon: Calculator },
  { href: "/messages",     label: "Messages",     icon: MessageSquare },
  { href: "/finance",      label: "Finance",      icon: LineChart },
  { href: "/marketing",    label: "Marketing",    icon: Megaphone },
  { href: "/admin",        label: "Admin",        icon: Settings },
];

// Residence Manager: only Apartment bookings + Clients (view)
const RM_SIDEBAR = [
  { href: "/bookings", label: "Apartments",  icon: Home },
  { href: "/clients",  label: "Clients",     icon: Users },
];

// Viewer: read-only on Clients, Bookings, Jobs only
const VIEWER_SIDEBAR = [
  { href: "/jobs",     label: "Jobs Board", icon: Briefcase },
  { href: "/bookings", label: "Bookings",   icon: CalendarRange },
  { href: "/clients",  label: "Clients",    icon: Users },
];

// ─── Role helpers ────────────────────────────────────────────────────────────

function formatRole(role: string) {
  switch (role) {
    case "super_admin":       return "Super Admin";
    case "admin":             return "Admin";
    case "operator":          return "Operator";
    case "viewer":            return "Viewer";
    case "residence_manager": return "Residence Manager";
    default:                  return role;
  }
}

// ─── Lock screen ─────────────────────────────────────────────────────────────

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

// ─── Shell ────────────────────────────────────────────────────────────────────

export function Shell({ children }: { children: ReactNode }) {
  const { user, logout, isLocked } = useAuth();
  const [location, setLocation] = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const followUpBadge = useFollowUpBadge();

  // Global Cmd/Ctrl+K shortcut. Mounted at the shell level so it's available
  // on every authenticated page. Skipped when there's no user, when the
  // session is locked, or for residence_manager (whose nav is intentionally
  // limited to apartments + clients — palette would surface out-of-scope rows).
  useEffect(() => {
    if (!user || isLocked) return;
    if (user.role === "residence_manager") return;
    const onKey = (e: KeyboardEvent) => {
      const isK = e.key === "k" || e.key === "K";
      if (isK && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [user, isLocked]);

  // Live count of unassigned-driver bookings for the Jobs tab badge.
  // Cheap because the bookings list is already cached by other pages.
  const { data: bookingsForBadge } = useListBookings(
    {},
    { query: { enabled: !!user, queryKey: getListBookingsQueryKey({}), refetchInterval: 60000 } }
  );
  const unassignedCount = (bookingsForBadge ?? []).filter(
    (b: any) => !b.driver_id && b.status !== 'Completed' && b.status !== 'Cancelled'
  ).length;

  if (!user) return <>{children}</>;

  const isSuperAdmin       = user.role === "super_admin";
  const isAdminRole        = user.role === "admin"; // ONLY admin (not super_admin)
  const isResidenceManager = user.role === "residence_manager";
  const isViewer           = user.role === "viewer";
  const canWrite           = !isViewer; // viewers are read-only

  if (isLocked) return <LockScreen />;

  // Filter helper for operator/admin nav: skip items flagged blockAdmin when user is admin
  const filterForRole = (items: typeof OPERATOR_SIDEBAR) => items.filter(item => {
    if ((item as any).blockAdmin && isAdminRole) return false;
    return true;
  });

  // Pick the right nav set
  let sidebarItems: typeof OPERATOR_SIDEBAR;
  if (isResidenceManager)   sidebarItems = RM_SIDEBAR as any;
  else if (isViewer)        sidebarItems = VIEWER_SIDEBAR as any;
  else                      sidebarItems = filterForRole(OPERATOR_SIDEBAR);

  const moreItems = (isResidenceManager || isViewer) ? [] : filterForRole(OPERATOR_MORE);

  // Mobile bottom nav tabs (5 max for operators, 2 for residence_manager)
  const mobileBottomTabs = isResidenceManager
    ? [
        { href: "/bookings", label: "Apartments", icon: Home },
        { href: "/clients",  label: "Clients",    icon: Users },
      ]
    : null; // null = use default operator bottom nav

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-card border-r border-border h-screen sticky top-0">
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-xl">T</span>
            </div>
            <span className="font-bold text-base text-foreground tracking-wide uppercase whitespace-nowrap">TRAVELUXE OS</span>
          </div>
          <NotificationBell />
        </div>

        {/* New Booking button — hidden for Residence Manager and Viewer */}
        {!isResidenceManager && canWrite && (
          <div className="px-4 mb-4">
            <Link href="/bookings/new">
              <Button className="w-full h-11 font-semibold shadow-[0_0_15px_rgba(201,168,76,0.25)] hover:shadow-[0_0_25px_rgba(201,168,76,0.4)] transition-all">
                <Plus className="w-4 h-4 mr-2" />
                New Booking
              </Button>
            </Link>
          </div>
        )}

        {/* Viewer banner */}
        {isViewer && (
          <div className="px-4 mb-4">
            <div className="px-3 py-2 rounded-md bg-secondary/40 border border-border text-center">
              <p className="text-xs text-muted-foreground font-medium">Read-Only Access</p>
              <p className="text-[10px] text-muted-foreground/70 mt-0.5">View bookings, clients & jobs</p>
            </div>
          </div>
        )}

        {isResidenceManager && (
          <div className="px-4 mb-4">
            <div className="px-3 py-2 rounded-md bg-primary/5 border border-primary/10 text-center">
              <p className="text-xs text-primary font-medium">Apartments</p>
              <p className="text-[10px] text-muted-foreground">View &amp; manage apartment bookings</p>
            </div>
          </div>
        )}

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
          {sidebarItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            const showBadge = (item as any).badge && followUpBadge > 0;
            return (
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
                <item.icon className="w-5 h-5 flex-shrink-0" />
                <span className="font-medium flex-1">{item.label}</span>
                {showBadge && (
                  <span className="ml-auto flex-shrink-0 min-w-[18px] h-[18px] rounded-full bg-destructive text-[10px] font-bold text-white flex items-center justify-center px-1">
                    {followUpBadge > 9 ? "9+" : followUpBadge}
                  </span>
                )}
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
              <p className="text-xs text-muted-foreground">{formatRole(user.role)}</p>
            </div>
          </div>
          <Button variant="outline" className="w-full justify-start text-muted-foreground" onClick={logout}>
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>
      </aside>

      {/* Mobile: sticky header */}
      <div className="md:hidden sticky top-0 z-40 flex items-center justify-between px-4 py-3 bg-card/95 backdrop-blur-sm border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-base">T</span>
          </div>
          <span className="font-bold text-sm text-foreground tracking-wider uppercase">
            {isResidenceManager ? "Apartments" : "Traveluxe OS"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Mobile entry point for the global Cmd/K palette — keyboard
              shortcuts don't apply on phones, so the topbar icon is the
              only discoverable way for mobile operators to open it. */}
          {!isResidenceManager && (
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="w-9 h-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary flex items-center justify-center transition-colors"
              aria-label="Open global search"
              data-testid="button-open-palette"
            >
              <Search className="w-5 h-5" />
            </button>
          )}
          <NotificationBell />
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 pb-24 md:pb-0 min-h-screen overflow-x-hidden relative">
        <div className="p-4 md:p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>

      {/* ── Residence Manager: minimal 2-tab bottom nav ── */}
      {isResidenceManager && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50 flex items-center justify-around px-1" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <Link href="/bookings" className={`flex flex-col items-center justify-center flex-1 h-16 ${location.startsWith('/bookings') ? 'text-primary' : 'text-muted-foreground'}`}>
            <Home className="w-5 h-5 mb-1" />
            <span className="text-[10px] font-medium">Apartments</span>
          </Link>
          <Link href="/clients" className={`flex flex-col items-center justify-center flex-1 h-16 ${location.startsWith('/clients') ? 'text-primary' : 'text-muted-foreground'}`}>
            <Users className="w-5 h-5 mb-1" />
            <span className="text-[10px] font-medium">Clients</span>
          </Link>
          <button
            onClick={() => { logout(); }}
            className="flex flex-col items-center justify-center flex-1 h-16 text-muted-foreground hover:text-destructive transition-colors"
          >
            <LogOut className="w-5 h-5 mb-1" />
            <span className="text-[10px] font-medium">Sign Out</span>
          </button>
        </nav>
      )}

      {/* ── Viewer: read-only 4-tab bottom nav ── */}
      {isViewer && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50 flex items-center justify-around px-1" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <Link href="/jobs" className={`flex flex-col items-center justify-center flex-1 h-16 ${location.startsWith('/jobs') ? 'text-primary' : 'text-muted-foreground'}`}>
            <Briefcase className="w-5 h-5 mb-1" />
            <span className="text-[10px] font-medium">Jobs</span>
          </Link>
          <Link href="/bookings" className={`flex flex-col items-center justify-center flex-1 h-16 ${location.startsWith('/bookings') ? 'text-primary' : 'text-muted-foreground'}`}>
            <CalendarRange className="w-5 h-5 mb-1" />
            <span className="text-[10px] font-medium">Bookings</span>
          </Link>
          <Link href="/clients" className={`flex flex-col items-center justify-center flex-1 h-16 ${location.startsWith('/clients') ? 'text-primary' : 'text-muted-foreground'}`}>
            <Users className="w-5 h-5 mb-1" />
            <span className="text-[10px] font-medium">Clients</span>
          </Link>
          <button
            onClick={() => { logout(); }}
            className="flex flex-col items-center justify-center flex-1 h-16 text-muted-foreground hover:text-destructive transition-colors"
          >
            <LogOut className="w-5 h-5 mb-1" />
            <span className="text-[10px] font-medium">Sign Out</span>
          </button>
        </nav>
      )}

      {/* ── Operator/Admin: full bottom nav ── */}
      {!isResidenceManager && !isViewer && (
        <>
          <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50 flex items-center justify-around px-1" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
            <Link href="/" className={`flex flex-col items-center justify-center w-14 h-16 ${location === '/' ? 'text-primary' : 'text-muted-foreground'}`}>
              <LayoutDashboard className="w-5 h-5 mb-1" />
              <span className="text-[10px] font-medium">Home</span>
            </Link>

            <Link href="/jobs" className={`relative flex flex-col items-center justify-center w-14 h-16 ${location.startsWith('/jobs') ? 'text-primary' : 'text-muted-foreground'}`}>
              <div className="relative">
                <Briefcase className="w-5 h-5 mb-1" />
                {unassignedCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-destructive text-[9px] font-bold text-white flex items-center justify-center leading-none ring-1 ring-card">
                    {unassignedCount > 9 ? '9+' : unassignedCount}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium">Jobs</span>
            </Link>

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
              <span className="text-[10px] font-medium">Service</span>
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
                {/*
                  Sign Out lives INSIDE the user identity card now (icon
                  button on the right). The previous full-width destructive
                  button at the bottom of the sheet sat right where your
                  thumb naturally rests when reaching for the bottom nav,
                  so it kept getting hit by accident. Tucking it into the
                  identity card moves it well away from any reflex tap and
                  also makes contextual sense — it acts on the signed-in
                  user shown in the same card. A confirm dialog is added
                  so even an accidental tap on the icon doesn't drop you
                  straight to the login screen.
                */}
                <div className="mx-5 mb-4 p-3 rounded-xl bg-secondary/50 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold uppercase">
                    {user.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{user.name}</p>
                    <p className="text-xs text-muted-foreground">{formatRole(user.role)}</p>
                  </div>
                  <button
                    onClick={() => {
                      if (window.confirm("Sign out of Traveluxe OS?")) {
                        logout();
                        setMoreOpen(false);
                      }
                    }}
                    className="shrink-0 w-9 h-9 rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 flex items-center justify-center transition-colors"
                    title="Sign out"
                    aria-label="Sign out"
                    data-testid="button-sign-out"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
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
                  {moreItems.map((item) => {
                    const isActive = location === item.href || (item.href !== '/' && location.startsWith(item.href));
                    const showBadge = (item as any).badge && followUpBadge > 0;
                    return (
                      <button
                        key={item.href}
                        onClick={() => { setLocation(item.href); setMoreOpen(false); }}
                        className={`relative flex flex-col items-center justify-center gap-2 p-4 rounded-xl border transition-all ${isActive ? 'bg-primary/10 border-primary/50 text-primary' : 'bg-secondary/30 border-border text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
                      >
                        {showBadge && (
                          <span className="absolute top-2 right-2 min-w-[16px] h-4 rounded-full bg-destructive text-[9px] font-bold text-white flex items-center justify-center px-1">
                            {followUpBadge > 9 ? "9+" : followUpBadge}
                          </span>
                        )}
                        <item.icon className="w-5 h-5" />
                        <span className="text-[11px] font-medium">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
                {/*
                  Bottom Sign Out button removed — moved up into the user
                  identity card to prevent accidental taps next to the
                  bottom nav.
                */}
                <div className="pb-4" />
              </div>
            </>
          )}
        </>
      )}

      {/* Global Cmd/Ctrl+K command palette. Always mounted (cheap when
          closed) so the keyboard shortcut and the mobile search button can
          flip a single piece of state. Hidden for residence_manager. */}
      {!isResidenceManager && (
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      )}
    </div>
  );
}
