import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { 
  LayoutDashboard, Users, FileText, CalendarRange, 
  Briefcase, PlaneTakeoff, Car, Calculator, MessageSquare, 
  LineChart, Search, Settings, LogOut, Menu
} from "lucide-react";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, reqAdmin: false, showMobile: true },
  { href: "/jobs", label: "Jobs", icon: Briefcase, reqAdmin: false, showMobile: true },
  { href: "/clients", label: "Clients", icon: Users, reqAdmin: false, showMobile: true },
  { href: "/messages", label: "Messages", icon: MessageSquare, reqAdmin: false, showMobile: true },
  { href: "/bookings", label: "Bookings", icon: CalendarRange, reqAdmin: false, showMobile: false },
  { href: "/quotes", label: "Quotes", icon: FileText, reqAdmin: false, showMobile: false },
  { href: "/flights", label: "Flights", icon: PlaneTakeoff, reqAdmin: false, showMobile: false },
  { href: "/drivers", label: "Drivers", icon: Car, reqAdmin: false, showMobile: false },
  { href: "/commissions", label: "Commissions", icon: Calculator, reqAdmin: false, showMobile: false },
  { href: "/finance", label: "Finance", icon: LineChart, reqAdmin: true, showMobile: false },
  { href: "/search", label: "Search", icon: Search, reqAdmin: false, showMobile: false },
  { href: "/admin", label: "Admin", icon: Settings, reqAdmin: true, showMobile: true },
];

export function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  if (!user) return <>{children}</>;

  const filteredNav = NAV_ITEMS.filter(item => !item.reqAdmin || user.role === "admin");
  const mobileNav = filteredNav.filter(item => item.showMobile);

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-card border-r border-border h-screen sticky top-0">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-xl">T</span>
          </div>
          <span className="font-bold text-lg text-foreground tracking-wide uppercase">TRAVELUXE OS</span>
        </div>
        
        <nav className="flex-1 px-4 space-y-2 overflow-y-auto">
          {filteredNav.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-3 rounded-md transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
                <item.icon className="w-5 h-5" />
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

      {/* Main Content */}
      <main className="flex-1 pb-20 md:pb-0 min-h-screen overflow-x-hidden relative">
        <div className="p-4 md:p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50 flex items-center justify-around px-2 pb-safe">
        {mobileNav.map((item) => {
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href} className={`flex flex-col items-center justify-center w-16 h-16 min-h-[48px] ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
              <item.icon className="w-6 h-6 mb-1" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
