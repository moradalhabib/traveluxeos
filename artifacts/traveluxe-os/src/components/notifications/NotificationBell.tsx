import { useState } from "react";
import { useLocation } from "wouter";
import { Bell, BellRing, X, Check, Trash2, PlaneLanding, PlaneTakeoff, Calendar, RefreshCw, Car, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNotifications, type AppNotification, type NotifType } from "@/hooks/use-notifications";
import { format, isToday, isYesterday } from "date-fns";

function typeIcon(type: NotifType) {
  switch (type) {
    case "booking_new":    return <Calendar className="w-4 h-4 text-primary" />;
    case "booking_update": return <RefreshCw className="w-4 h-4 text-blue-400" />;
    case "driver_assigned":return <Car className="w-4 h-4 text-amber-400" />;
    case "flight_delay":   return <Clock className="w-4 h-4 text-red-400" />;
    case "flight_landed":  return <PlaneLanding className="w-4 h-4 text-green-400" />;
    case "flight_early":   return <PlaneLanding className="w-4 h-4 text-primary" />;
    case "flight_ontime":  return <PlaneTakeoff className="w-4 h-4 text-green-400" />;
    default: return <Bell className="w-4 h-4 text-muted-foreground" />;
  }
}

function typeColor(type: NotifType): string {
  switch (type) {
    case "booking_new":    return "border-l-primary";
    case "booking_update": return "border-l-blue-500";
    case "driver_assigned":return "border-l-amber-500";
    case "flight_delay":   return "border-l-red-500";
    case "flight_landed":  return "border-l-green-500";
    case "flight_early":   return "border-l-primary";
    case "flight_ontime":  return "border-l-green-500";
    default: return "border-l-border";
  }
}

function formatTs(ts: Date): string {
  if (isToday(ts)) return format(ts, "HH:mm");
  if (isYesterday(ts)) return "Yesterday " + format(ts, "HH:mm");
  return format(ts, "dd MMM HH:mm");
}

interface NotifItemProps {
  n: AppNotification;
  onDismiss: (id: string) => void;
  onNavigate: (link?: string) => void;
}

function NotifItem({ n, onDismiss, onNavigate }: NotifItemProps) {
  return (
    <div
      className={`relative flex gap-3 px-4 py-3.5 border-l-2 ${typeColor(n.type)} ${!n.read ? "bg-primary/5" : "bg-transparent"} hover:bg-secondary/20 transition-colors cursor-pointer group`}
      onClick={() => onNavigate(n.link)}
    >
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-secondary flex items-center justify-center mt-0.5">
        {typeIcon(n.type)}
      </div>
      <div className="flex-1 min-w-0 pr-6">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm font-semibold leading-tight ${!n.read ? "text-foreground" : "text-muted-foreground"}`}>
            {n.title}
          </p>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">{formatTs(n.timestamp)}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
      </div>
      {!n.read && (
        <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-primary flex-shrink-0" />
      )}
      <button
        className="absolute top-1.5 right-1.5 p-1 rounded hover:bg-secondary"
        onClick={(e) => { e.stopPropagation(); onDismiss(n.id); }}
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5 text-muted-foreground" />
      </button>
    </div>
  );
}

interface Props {
  className?: string;
}

export function NotificationBell({ className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { items, unreadCount, markAllRead, dismiss, clearAll } = useNotifications();

  const handleOpen = () => {
    setOpen(o => !o);
    if (!open && unreadCount > 0) markAllRead();
  };

  const handleNavigate = (link?: string) => {
    setOpen(false);
    if (link) setLocation(link);
  };

  const Trigger = (
    <button
      onClick={handleOpen}
      className={`relative p-2 rounded-xl hover:bg-secondary/60 transition-colors ${className}`}
    >
      {unreadCount > 0
        ? <BellRing className="w-5 h-5 text-primary animate-[wiggle_0.5s_ease-in-out]" />
        : <Bell className="w-5 h-5 text-muted-foreground" />}
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center shadow">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </button>
  );

  return (
    <div className="relative">
      {Trigger}

      {open && (
        <>
          {/* Backdrop — dim + blur the page so the panel reads cleanly.
              Without this the panel sat over a fully transparent overlay
              and the page content bled through, making both unreadable. */}
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Panel — bell sits in the left sidebar, so anchor the panel's
              left edge to the bell and extend rightward into the page.
              On mobile, fall back to fixed positioning near the top. */}
          <div className="fixed left-2 right-2 top-14 md:absolute md:left-full md:right-auto md:top-0 md:ml-3 z-50 md:w-[360px] max-h-[75vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
               style={{ backgroundColor: "hsl(var(--card))" }}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card sticky top-0">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-primary" />
                <span className="font-bold text-sm text-foreground">Notifications</span>
                {items.length > 0 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">{items.length}</Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                {items.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive" onClick={clearAll}>
                    <Trash2 className="w-3 h-3 mr-1" />
                    Clear
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setOpen(false)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* List */}
            <div className="overflow-y-auto flex-1">
              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                  <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mb-3">
                    <Check className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">All caught up</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">No new notifications</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {items.map(n => (
                    <NotifItem key={n.id} n={n} onDismiss={dismiss} onNavigate={handleNavigate} />
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {items.length > 0 && (
              <div className="border-t border-border px-4 py-2.5 bg-card/80">
                <p className="text-[10px] text-muted-foreground/60 text-center">
                  Flight status refreshes every 4 minutes · Realtime booking updates active
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
