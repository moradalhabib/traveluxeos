import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { format } from "date-fns";
import {
  AlertTriangle, MapPin, Car, Clock, Plane, Trash2, CheckSquare,
  Building2, MessageCircle,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getVipBadgeColor } from "@/lib/vip";
import { isSupplierDrivenJob } from "@/lib/supplierDriven";
import {
  useUpdateBookingStatus, useUpdateBooking, getListBookingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

const STATUS_COLORS: Record<string, string> = {
  Pending:   "bg-amber-500/20 text-amber-400 border-amber-500/50",
  Confirmed: "bg-blue-500/20 text-blue-400 border-blue-500/50",
  Active:    "bg-green-500/20 text-green-400 border-green-500/50",
  Completed: "bg-gray-500/20 text-gray-400 border-gray-500/50",
  Cancelled: "bg-destructive/20 text-destructive border-destructive/50",
};

const PAYMENT_COLORS: Record<string, string> = {
  Paid:    "text-green-400 border-green-500/40 bg-green-500/10",
  Partial: "text-blue-400  border-blue-500/40  bg-blue-500/10",
  Unpaid:  "text-amber-400 border-amber-500/40 bg-amber-500/10",
};

export type JobCardProps = {
  job: any;
  driversById: Map<string, any>;
  suppliersById: Map<string, any>;
  extras?: any[];
  selectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
  canDelete?: boolean;
  onDelete?: (id: string) => void;
  onLongPress?: (job: any) => void;
};

export function JobCard({
  job, driversById, suppliersById, extras = [],
  selectMode = false, isSelected = false, onToggleSelect,
  canDelete = false, onDelete, onLongPress,
}: JobCardProps) {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const updateStatus  = useUpdateBookingStatus();
  const updateBooking = useUpdateBooking();

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  // Confirmation flows: cancelling a booking (destructive) or completing a
  // supplier-driven booking that has no supplier_cost (financial accuracy).
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [supplierCostPromptOpen, setSupplierCostPromptOpen] = useState(false);
  const [supplierCostDraft, setSupplierCostDraft] = useState<string>("");
  // Force-remount the <select> after a cancelled change so its DOM value
  // resets back to job.status (controlled value alone isn't always enough
  // because the user's interaction already advanced the select).
  const [statusSelectNonce, setStatusSelectNonce] = useState(0);

  const startLongPress = () => {
    if (selectMode || !onLongPress) return;
    longPressFired.current = false;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try { (navigator as any).vibrate?.(20); } catch { /* noop */ }
      }
      onLongPress(job);
    }, 500);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };
  const handleCardClick = (e: React.MouseEvent) => {
    if (longPressFired.current) {
      e.preventDefault();
      e.stopPropagation();
      longPressFired.current = false;
      return;
    }
    if (selectMode) {
      onToggleSelect?.(job.id);
      return;
    }
    setLocation(`/bookings/${job.id}`);
  };

  const commitStatus = (status: string) => {
    updateStatus.mutate(
      { id: job.id, data: { status } },
      { onSuccess: () => qc.invalidateQueries({ queryKey: getListBookingsQueryKey({}) }) },
    );
  };

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const next = e.target.value;

    // Bug 2 — Cancelling a booking is destructive. Always require a
    // two-step confirmation before mutating.
    if (next === "Cancelled" && job.status !== "Cancelled") {
      setConfirmCancelOpen(true);
      setStatusSelectNonce((n: number) => n + 1);
      return;
    }

    // Bug 3 — Completing a booking that has a supplier assigned without a
    // supplier_cost would silently leave the supplier balance and P&L wrong.
    // Prompt for a cost (operator can still confirm £0 explicitly).
    const hasSupplier = !!(job as any).supplier_id;
    const cost = Number((job as any).supplier_cost ?? 0);
    if (next === "Completed" && hasSupplier && !(cost > 0)) {
      setSupplierCostDraft("");
      setSupplierCostPromptOpen(true);
      setStatusSelectNonce((n: number) => n + 1);
      return;
    }

    commitStatus(next);
  };

  const confirmCancelBooking = () => {
    setConfirmCancelOpen(false);
    commitStatus("Cancelled");
  };

  const submitSupplierCostThenComplete = () => {
    const raw = supplierCostDraft.trim();
    const num = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(num) || num < 0) return;
    setSupplierCostPromptOpen(false);
    // Send supplier_cost AND status in a single PUT so they either both land
    // or neither does — no risk of a stale balance vs status mismatch if the
    // network drops between two sequential calls.
    updateBooking.mutate(
      { id: job.id, data: { supplier_cost: num, status: "Completed" } as any },
      {
        onSuccess: () => qc.invalidateQueries({ queryKey: getListBookingsQueryKey({}) }),
      },
    );
  };

  const completeWithoutSupplierCost = () => {
    setSupplierCostPromptOpen(false);
    commitStatus("Completed");
  };
  const handlePaymentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.preventDefault();
    e.stopPropagation();
    updateBooking.mutate(
      { id: job.id, data: { payment_status: e.target.value } as any },
      { onSuccess: () => qc.invalidateQueries({ queryKey: getListBookingsQueryKey({}) }) },
    );
  };

  const jobSupplierDriven = isSupplierDrivenJob(job as any);
  const jobSupplier = jobSupplierDriven ? suppliersById.get((job as any).supplier_id) : null;

  return (
    <div className="space-y-1.5">
      <Card
        className={`border-border hover:border-primary/40 hover:bg-secondary/10 transition-all bg-card overflow-hidden cursor-pointer select-none ${
          selectMode && isSelected ? "ring-2 ring-primary border-primary" : ""
        }`}
        onClick={handleCardClick}
        onTouchStart={startLongPress}
        onTouchEnd={cancelLongPress}
        onTouchMove={cancelLongPress}
        onTouchCancel={cancelLongPress}
        onMouseDown={startLongPress}
        onMouseUp={cancelLongPress}
        onMouseLeave={cancelLongPress}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!selectMode && onLongPress) {
            onLongPress(job);
            longPressFired.current = true;
          }
        }}
        data-testid={selectMode ? `select-job-${job.id}` : `card-job-${job.id}`}
      >
        <CardContent className="p-3">
          {/* Row 1: ref + badges | time + status */}
          <div className="flex items-center gap-2 mb-1.5">
            <div className="flex items-center gap-1 flex-1 min-w-0 flex-wrap">
              {selectMode && (
                <div className={`flex-shrink-0 w-3.5 h-3.5 rounded border-2 flex items-center justify-center ${isSelected ? "bg-primary border-primary" : "border-muted-foreground/40"}`}>
                  {isSelected && <CheckSquare className="w-2 h-2 text-primary-foreground" />}
                </div>
              )}
              <span className="font-mono text-[10px] text-muted-foreground">{job.tvl_ref}</span>
              {job.service_type && (
                <Badge variant="outline" className="text-[9px] py-0 px-1 bg-secondary/40 text-foreground border-border">
                  {job.service_type}{(job as any).direction ? ` · ${(job as any).direction}` : ""}
                </Badge>
              )}
              {(job as any).flight_number && (() => {
                const fs = (job as any).flight_status;
                const st = fs?.status as string | undefined;
                const delayMins = fs?.delay_minutes ?? 0;
                const cls =
                  st === "Delayed"   ? "bg-amber-500/15 text-amber-400 border-amber-500/40" :
                  st === "Early"     ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40" :
                  st === "Cancelled" ? "bg-destructive/15 text-destructive border-destructive/40" :
                  st === "Landed"    ? "bg-blue-500/15 text-blue-400 border-blue-500/30" :
                  st === "On Time"   ? "bg-green-500/15 text-green-400 border-green-500/30" :
                                       "bg-blue-500/10 text-blue-400 border-blue-500/30";
                const note = st === "Delayed" && delayMins > 0 ? ` +${delayMins}m` :
                             st === "Early"   && delayMins < 0 ? ` ${Math.abs(delayMins)}m early` : "";
                return (
                  <Badge variant="outline" className={`text-[9px] py-0 px-1 flex items-center gap-0.5 ${cls}`}>
                    <Plane className="w-2 h-2" />{(job as any).flight_number}
                    {st && st !== "Unknown" && <span className="opacity-80">{st}{note}</span>}
                  </Badge>
                );
              })()}
              {(job as any).last_email_status === "sent" && (
                <Badge variant="outline" className="text-[9px] py-0 px-1 bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                  title={`Email sent${(job as any).last_email_kind ? ` · ${(job as any).last_email_kind.replace(/_/g, " ")}` : ""}`}>
                  ✓ Email
                </Badge>
              )}
              {(job as any).last_email_status === "failed" && (
                <Badge variant="outline" className="text-[9px] py-0 px-1 bg-destructive/10 text-destructive border-destructive/40">⚠ Email</Badge>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {job.date_time && (
                <div className="text-right">
                  <div className="text-xs font-bold text-foreground leading-none">{format(new Date(job.date_time), "HH:mm")}</div>
                  <div className="text-[9px] text-muted-foreground mt-0.5">{format(new Date(job.date_time), "EEE d MMM")}</div>
                </div>
              )}
              <select
                key={`status-${job.id}-${statusSelectNonce}`}
                value={job.status}
                onClick={(e) => e.stopPropagation()}
                onChange={handleStatusChange}
                disabled={job.status === "Cancelled"}
                className={`h-6 rounded-full border text-[10px] font-semibold px-1.5 appearance-none text-center ${job.status === "Cancelled" ? "opacity-60 cursor-not-allowed" : "cursor-pointer"} ${STATUS_COLORS[job.status] ?? "bg-secondary text-secondary-foreground border-border"}`}
              >
                <option value="Pending">Pending</option>
                <option value="Confirmed">Confirmed</option>
                <option value="Active">Active</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {/* Row 2: client name */}
          <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
            {job.client_id ? (
              <span className="font-semibold text-sm text-primary hover:underline cursor-pointer truncate"
                onClick={(e) => { e.stopPropagation(); setLocation(`/clients/${job.client_id}`); }}>
                {job.client_name || "Unknown Client"}
              </span>
            ) : (
              <span className="font-semibold text-sm text-foreground truncate">{job.client_name || "Unknown Client"}</span>
            )}
            {job.client_vip_tier && job.client_vip_tier !== "Standard" && (
              <Badge variant="outline" className={`text-[9px] py-0 px-1 flex-shrink-0 ${getVipBadgeColor(job.client_vip_tier)}`}>
                {job.client_vip_tier}
              </Badge>
            )}
          </div>

          {/* Row 3: route */}
          <div className="flex items-center gap-1 mb-2">
            <MapPin className="w-3 h-3 text-primary flex-shrink-0" />
            <span className="text-xs text-muted-foreground truncate">
              <span className="text-foreground">{job.pickup || "—"}</span>
              <span className="mx-1">→</span>
              <span className="text-foreground">{(job as any).dropoff || (job as any).destination || "—"}</span>
            </span>
          </div>

          {/* Row 4: driver / supplier | price + payment */}
          <div className="flex items-center justify-between border-t border-border pt-2">
            <div className="flex items-center gap-1.5 min-w-0">
              {jobSupplierDriven ? (
                <Building2 className="w-3 h-3 text-primary flex-shrink-0" />
              ) : (
                <Car className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              )}
              {jobSupplierDriven ? (
                <span
                  className="text-xs font-medium text-primary hover:underline cursor-pointer flex items-center gap-1 truncate"
                  onClick={(e) => {
                    e.stopPropagation();
                    if ((job as any).supplier_id) setLocation(`/suppliers/${(job as any).supplier_id}`);
                  }}
                  data-testid={`supplier-driven-${job.id}`}
                >
                  {jobSupplier?.name ?? "Supplier"}
                </span>
              ) : job.driver_name ? (
                job.driver_id ? (
                  <span className="text-xs font-medium text-primary hover:underline cursor-pointer flex items-center gap-1 truncate"
                    onClick={(e) => { e.stopPropagation(); setLocation(`/drivers/${job.driver_id}`); }}>
                    {(job as any).driver_staff_no && (
                      <span className="font-mono text-[10px] px-1 py-0 rounded bg-primary/15 text-primary border border-primary/30">
                        {(job as any).driver_staff_no}
                      </span>
                    )}
                    {job.driver_name}
                  </span>
                ) : (
                  <span className="text-xs font-medium text-foreground truncate">{job.driver_name}</span>
                )
              ) : (
                <span className="text-xs text-destructive font-medium flex items-center gap-0.5">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" /> No Driver
                </span>
              )}
              {jobSupplierDriven ? (() => {
                const phone = (jobSupplier?.whatsapp || jobSupplier?.phone || "").replace(/[^0-9+]/g, "");
                if (!phone) return null;
                const msg = `Hi ${jobSupplier?.contact_name ?? jobSupplier?.name ?? ""}, just confirming booking ${job.tvl_ref}. Please reply to confirm. Thanks.`;
                return (
                  <a href={`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()} className="text-green-500 hover:text-green-400 flex-shrink-0"
                    data-testid={`link-wa-supplier-${job.id}`}>
                    <MessageCircle className="w-3 h-3" />
                  </a>
                );
              })() : job.driver_id && (() => {
                const drv = driversById.get(job.driver_id);
                const phone = (drv?.whatsapp || drv?.phone || "").replace(/[^0-9+]/g, "");
                if (!phone) return null;
                const msg = `Hi ${drv?.name ?? job.driver_name ?? ""}, I've just sent you booking ${job.tvl_ref}. Please confirm receipt. Thanks.`;
                return (
                  <a href={`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()} className="text-green-500 hover:text-green-400 flex-shrink-0"
                    data-testid={`link-wa-driver-${job.id}`}>
                    <MessageCircle className="w-3 h-3" />
                  </a>
                );
              })()}
              {(job as any).client_notified_at && (
                <Badge variant="outline" className="text-[9px] py-0 px-1 bg-green-500/10 text-green-400 border-green-500/30 flex-shrink-0">
                  <MessageCircle className="w-2 h-2 mr-0.5" />C
                </Badge>
              )}
              {(job as any).driver_notified_at && (
                <Badge variant="outline" className="text-[9px] py-0 px-1 bg-amber-500/10 text-amber-400 border-amber-500/30 flex-shrink-0">
                  <Car className="w-2 h-2 mr-0.5" />D
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="text-xs font-bold text-foreground">£{job.price}</span>
              <select
                value={job.payment_status || "Unpaid"}
                onClick={(e) => e.stopPropagation()}
                onChange={handlePaymentChange}
                className={`h-6 rounded-full border text-[10px] font-semibold px-1.5 cursor-pointer appearance-none text-center ${PAYMENT_COLORS[job.payment_status || "Unpaid"] ?? "text-amber-400 border-amber-500/40 bg-amber-500/10"}`}
              >
                <option value="Unpaid">Unpaid</option>
                <option value="Partial">Partial</option>
                <option value="Paid">Paid</option>
              </select>
              {canDelete && !selectMode && (
                <AlertDialog>
                  <AlertDialogTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive/50 hover:text-destructive hover:bg-destructive/10"
                      data-testid={`button-delete-${job.id}`}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {job.tvl_ref}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Permanently removes the booking and all related records. Use Cancel status for real cancellations. Cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep job</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => onDelete?.(job.id)}
                        data-testid={`button-confirm-delete-${job.id}`}
                      >
                        Delete permanently
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Extra-vehicle sub-rows */}
      {extras.map((v: any, idx: number) => {
        const drv = v.driver_id ? driversById.get(v.driver_id) : null;
        const drvName = v.driver_name ?? drv?.name ?? null;
        const drvStaff = v.driver_staff_no ?? drv?.staff_no ?? null;
        const carNo = idx + 2;
        const legTimeIso = v.date_time ?? job.date_time ?? null;
        const legTime = legTimeIso ? new Date(legTimeIso) : null;
        const parentTime = job.date_time ? new Date(job.date_time) : null;
        const offsetMin =
          v.date_time && parentTime && legTime
            ? Math.round((legTime.getTime() - parentTime.getTime()) / 60000)
            : 0;
        return (
          <Card
            key={`${job.id}-veh-${v.id}`}
            className="ml-6 border-border/60 bg-secondary/5 hover:bg-secondary/15 transition-all cursor-pointer"
            onClick={(e) => { e.stopPropagation(); setLocation(`/bookings/${job.id}`); }}
            data-testid={`extra-vehicle-row-${v.id}`}
          >
            <CardContent className="p-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                    Car {carNo} · {job.tvl_ref}
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[9px] py-0 px-1.5 bg-primary/10 text-primary border-primary/30 uppercase tracking-wide"
                    data-testid={`badge-extra-car-${v.id}`}
                  >
                    Extra car
                  </Badge>
                  <Badge variant="outline" className="text-[9px] py-0 px-1.5 bg-secondary/40 text-foreground border-border">
                    {v.vehicle_type ?? "—"}
                  </Badge>
                  {legTime && (
                    <span
                      className={`flex items-center gap-1 font-semibold ${offsetMin !== 0 ? "text-amber-400" : "text-foreground"}`}
                      data-testid={`extra-vehicle-time-${v.id}`}
                      title={
                        offsetMin !== 0 && parentTime
                          ? `Picks up ${offsetMin > 0 ? `${offsetMin} min after` : `${Math.abs(offsetMin)} min before`} Car 1 (${format(parentTime, "HH:mm")})`
                          : "Same pickup time as Car 1"
                      }
                    >
                      <Clock className="w-3 h-3" />
                      {format(legTime, "HH:mm")}
                      {offsetMin !== 0 && (
                        <span className="text-[9px] font-normal">
                          ({offsetMin > 0 ? `+${offsetMin}` : offsetMin}m)
                        </span>
                      )}
                    </span>
                  )}
                  <span className="text-muted-foreground truncate">
                    {(v.pickup ?? job.pickup) || "—"} → {(v.dropoff ?? (job as any).dropoff ?? (job as any).destination) || "—"}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {drvName ? (
                    <span className="flex items-center gap-1 text-foreground">
                      <Car className="w-3 h-3 text-muted-foreground" />
                      {drvStaff && (
                        <span className="font-mono text-[9px] px-1 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
                          {drvStaff}
                        </span>
                      )}
                      {drvName}
                    </span>
                  ) : (
                    <span className="text-destructive flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> No Driver
                    </span>
                  )}
                  <span className="text-muted-foreground">£{v.client_share ?? 0}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* Bug 2 — Cancel-booking confirmation. Wording locked per spec. */}
      <AlertDialog open={confirmCancelOpen} onOpenChange={setConfirmCancelOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel booking {job.tvl_ref}?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this booking? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`button-keep-booking-${job.id}`}>
              Keep Booking
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmCancelBooking}
              data-testid={`button-confirm-cancel-${job.id}`}
            >
              Yes, Cancel Booking
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bug 3 — Supplier-cost prompt before marking Completed. Keeps the
          Supplier Balance Tracker and Finance P&L accurate. */}
      <Dialog open={supplierCostPromptOpen} onOpenChange={setSupplierCostPromptOpen}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Add supplier cost for {job.tvl_ref}?</DialogTitle>
            <DialogDescription>
              You haven't entered a supplier cost for this booking. Add one now to keep
              the supplier balance and P&amp;L accurate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor={`supplier-cost-${job.id}`}>Supplier cost (£)</Label>
            <Input
              id={`supplier-cost-${job.id}`}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              autoFocus
              value={supplierCostDraft}
              onChange={(e) => setSupplierCostDraft(e.target.value)}
              placeholder="0.00"
              data-testid={`input-supplier-cost-${job.id}`}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitSupplierCostThenComplete();
              }}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={completeWithoutSupplierCost}
              data-testid={`button-complete-without-cost-${job.id}`}
            >
              Complete without cost
            </Button>
            <Button
              onClick={submitSupplierCostThenComplete}
              disabled={updateBooking.isPending}
              data-testid={`button-save-cost-and-complete-${job.id}`}
            >
              {updateBooking.isPending ? "Saving…" : "Save cost & complete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
