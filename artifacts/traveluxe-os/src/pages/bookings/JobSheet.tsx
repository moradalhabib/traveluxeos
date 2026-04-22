import { useEffect, useMemo, useState } from "react";
import { useRoute, Link } from "wouter";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Languages, Share2, Phone, MapPin, Calendar, Clock,
  Plane, Users, Briefcase, Car, FileText, Hash, AlertCircle,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

// ─── Driver Job Sheet ──────────────────────────────────────────────────────
// Mobile-first, full-screen, NO financials. Designed to be opened on a phone
// (the operator shares it via WhatsApp, the driver opens it on the road).
// Bilingual EN ⇄ AR with full RTL flip on the Arabic view.
//
// Hidden by design:
//   price, supplier_cost, driver_cost, fuel_cost, extra_charges,
//   tvl_commission, payment_status, supplier_payment_*, referral_*,
//   commission_amount, commission_notes
//
// Visible on every job sheet:
//   tvl_ref, service_type, date_time, pickup, dropoff/destination,
//   flight_number, passengers, luggage, vehicle (preference + assigned car),
//   client name + WhatsApp, special_requests / notes, nameboard.

type Lang = "en" | "ar";

const T: Record<Lang, Record<string, string>> = {
  en: {
    title: "Driver Job Sheet",
    back: "Back",
    share: "Share via WhatsApp",
    switchLang: "العربية",
    ref: "Reference",
    service: "Service",
    when: "When",
    pickup: "Pickup",
    dropoff: "Drop-off",
    destination: "Destination",
    flight: "Flight",
    passengers: "Passengers",
    luggage: "Luggage",
    vehicle: "Vehicle",
    vehicleAssigned: "Assigned vehicle",
    vehiclePreferred: "Preferred",
    client: "Client",
    whatsapp: "WhatsApp",
    nameboard: "Nameboard",
    notes: "Notes & special requests",
    none: "—",
    notFound: "Job sheet not found.",
    backToBooking: "Back to booking",
    confidential: "For driver use only — do not share with clients.",
  },
  ar: {
    title: "ورقة مهمة السائق",
    back: "رجوع",
    share: "مشاركة عبر واتساب",
    switchLang: "English",
    ref: "المرجع",
    service: "الخدمة",
    when: "الموعد",
    pickup: "نقطة الانطلاق",
    dropoff: "نقطة الوصول",
    destination: "الوجهة",
    flight: "رقم الرحلة",
    passengers: "عدد الركاب",
    luggage: "الأمتعة",
    vehicle: "المركبة",
    vehicleAssigned: "المركبة المحددة",
    vehiclePreferred: "المفضلة",
    client: "العميل",
    whatsapp: "واتساب",
    nameboard: "اللوحة الاستقبالية",
    notes: "ملاحظات وطلبات خاصة",
    none: "—",
    notFound: "لم يتم العثور على ورقة المهمة.",
    backToBooking: "العودة إلى الحجز",
    confidential: "للسائق فقط — لا تتم مشاركتها مع العملاء.",
  },
};

async function authedFetch(path: string, init: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
  });
}

export default function JobSheet() {
  const [, params] = useRoute("/bookings/:id/job-sheet");
  const id = params?.id;
  const [booking, setBooking] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window === "undefined") return "en";
    const v = window.localStorage.getItem("traveluxe.jobsheet.lang");
    return v === "ar" ? "ar" : "en";
  });
  const t = T[lang];
  const isAr = lang === "ar";

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("traveluxe.jobsheet.lang", lang);
    }
  }, [lang]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const res = await authedFetch(`/api/bookings/${id}`);
        if (res.ok) setBooking(await res.json());
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const formatted = useMemo(() => {
    if (!booking?.date_time) return null;
    try {
      const d = new Date(booking.date_time);
      return format(d, lang === "ar" ? "EEE d MMM yyyy · HH:mm" : "EEE d MMM yyyy 'at' HH:mm");
    } catch {
      return booking.date_time;
    }
  }, [booking, lang]);

  // Build a plain-text version for WhatsApp share. We deliberately respect
  // the current language so the driver receives the message in the same
  // language they're viewing the sheet in.
  const buildShareText = (): string => {
    if (!booking) return "";
    const lines: string[] = [];
    const push = (label: string, value?: string | null) => {
      if (value) lines.push(`${label}: ${value}`);
    };
    lines.push(`*${t.title}*`);
    push(t.ref, booking.tvl_ref);
    push(t.service, booking.service_type);
    push(t.when, formatted);
    push(t.pickup, booking.pickup);
    if (booking.service_type !== "As Directed") {
      push(booking.destination ? t.destination : t.dropoff, booking.dropoff || booking.destination);
    }
    push(t.flight, booking.flight_number);
    push(t.passengers, booking.passengers != null ? String(booking.passengers) : null);
    push(t.luggage, booking.luggage != null ? String(booking.luggage) : null);
    push(t.vehicle, [booking.vehicle_model, booking.plate].filter(Boolean).join(" · ") || booking.vehicle_type);
    push(t.client, booking.client_name);
    push(t.whatsapp, booking.client_whatsapp);
    push(t.nameboard, booking.nameboard);
    push(t.notes, booking.special_requests || booking.notes);
    return lines.join("\n");
  };

  const share = async () => {
    const text = buildShareText();
    // Prefer native share if available (driver phones support it). Fall back
    // to WhatsApp web link with the driver's number prefilled when known.
    if (typeof navigator !== "undefined" && (navigator as any).share) {
      try {
        await (navigator as any).share({ title: t.title, text });
        return;
      } catch {
        /* user cancelled — fall through to WhatsApp link */
      }
    }
    const driverNum = (booking?.driver_whatsapp || "").replace(/[^\d+]/g, "").replace(/^\+/, "");
    const url = driverNum
      ? `https://wa.me/${driverNum}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-3">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-center gap-4">
        <AlertCircle className="w-10 h-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t.notFound}</p>
        <Link href="/bookings"><Button variant="outline" size="sm">{t.backToBooking}</Button></Link>
      </div>
    );
  }

  const isAsDirected = booking.service_type === "As Directed";

  return (
    <div
      className="min-h-screen bg-background"
      dir={isAr ? "rtl" : "ltr"}
      data-testid="job-sheet-root"
    >
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
          <Link href={`/bookings/${id}`}>
            <Button variant="ghost" size="sm" className="gap-1" data-testid="btn-jobsheet-back">
              <ArrowLeft className={`w-4 h-4 ${isAr ? "rotate-180" : ""}`} />
              <span className="hidden sm:inline">{t.back}</span>
            </Button>
          </Link>
          <div className="text-sm font-bold text-foreground truncate">{t.title}</div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => setLang(isAr ? "en" : "ar")}
              data-testid="btn-jobsheet-lang">
              <Languages className="w-3.5 h-3.5 mr-1" /> {t.switchLang}
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-3">
        {/* Confidential banner — operator should know this is driver-only */}
        <div className="text-[11px] text-muted-foreground italic text-center">
          {t.confidential}
        </div>

        {/* Reference + service + status */}
        <Card className="bg-card border-primary/30">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Hash className="w-4 h-4 text-primary" />
                <span className="font-mono text-base font-bold">{booking.tvl_ref}</span>
              </div>
              <Badge variant="outline" className="text-xs">{booking.service_type}</Badge>
            </div>
            {formatted && (
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span className="font-semibold">{formatted}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Route */}
        <Card className="bg-card border-border">
          <CardContent className="p-4 space-y-3">
            <Field icon={MapPin} label={t.pickup} value={booking.pickup} />
            {!isAsDirected && (
              <Field icon={MapPin}
                label={booking.destination ? t.destination : t.dropoff}
                value={booking.dropoff || booking.destination} />
            )}
            {booking.flight_number && (
              <Field icon={Plane} label={t.flight} value={booking.flight_number} />
            )}
            {isAsDirected && booking.check_out_date && (
              <Field icon={Clock} label={t.when}
                value={`${formatted} → ${format(new Date(booking.check_out_date), "EEE d MMM")}`} />
            )}
          </CardContent>
        </Card>

        {/* Vehicle + passengers */}
        <Card className="bg-card border-border">
          <CardContent className="p-4 grid grid-cols-2 gap-3">
            <Field icon={Users} label={t.passengers}
              value={booking.passengers != null ? String(booking.passengers) : t.none} />
            <Field icon={Briefcase} label={t.luggage}
              value={booking.luggage != null ? String(booking.luggage) : t.none} />
            {(booking.vehicle_model || booking.plate) && (
              <Field className="col-span-2" icon={Car} label={t.vehicleAssigned}
                value={[
                  booking.vehicle_model,
                  booking.vehicle_year ? `(${booking.vehicle_year})` : null,
                  booking.plate ? `· ${booking.plate}` : null,
                ].filter(Boolean).join(" ")} />
            )}
            {booking.vehicle_type && !booking.vehicle_model && (
              <Field className="col-span-2" icon={Car} label={t.vehiclePreferred} value={booking.vehicle_type} />
            )}
          </CardContent>
        </Card>

        {/* Client contact */}
        {(booking.client_name || booking.client_whatsapp || booking.nameboard) && (
          <Card className="bg-card border-border">
            <CardContent className="p-4 space-y-3">
              <Field icon={Users} label={t.client} value={booking.client_name || t.none} />
              {booking.client_whatsapp && (
                <a
                  href={`https://wa.me/${booking.client_whatsapp.replace(/[^\d+]/g, "").replace(/^\+/, "")}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-emerald-400 font-medium hover:underline"
                  data-testid="link-jobsheet-client-wa"
                >
                  <Phone className="w-4 h-4" /> {booking.client_whatsapp}
                </a>
              )}
              {booking.nameboard && (
                <Field icon={FileText} label={t.nameboard} value={booking.nameboard} highlight />
              )}
            </CardContent>
          </Card>
        )}

        {/* Notes */}
        {(booking.special_requests || booking.notes) && (
          <Card className="bg-amber-500/5 border-amber-500/30">
            <CardContent className="p-4 space-y-2">
              <div className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" /> {t.notes}
              </div>
              {booking.special_requests && (
                <p className="text-sm whitespace-pre-wrap">{booking.special_requests}</p>
              )}
              {booking.notes && (
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">{booking.notes}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Sticky share bar */}
        <div className="sticky bottom-0 left-0 right-0 -mx-4 px-4 py-3 bg-background/95 backdrop-blur border-t border-border">
          <Button onClick={share} className="w-full" size="lg" data-testid="btn-jobsheet-share">
            <Share2 className="w-4 h-4 mr-2" /> {t.share}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Small presentational helper to keep the body tight and consistent.
function Field({
  icon: Icon,
  label,
  value,
  className,
  highlight,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: string | null;
  className?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`space-y-0.5 ${className ?? ""}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className={`text-sm font-medium ${highlight ? "text-amber-300 font-bold" : "text-foreground"}`}>
        {value || "—"}
      </div>
    </div>
  );
}
