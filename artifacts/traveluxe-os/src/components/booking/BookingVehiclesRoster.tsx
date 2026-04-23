import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Car, Users, Plus, Pencil, Trash2, Lock, LockOpen, X, Save } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useListDrivers, getListDriversQueryKey } from "@workspace/api-client-react";

type ExtraVehicle = {
  id: string;
  driver_id: string | null;
  driver_name: string | null;
  driver_staff_no: string | null;
  driver_vehicle: string | null;
  driver_plate: string | null;
  vehicle_type: string | null;
  client_share: number;
  cost_to_company: number;
  driver_receives: number;
  tvl_commission: number;
  commission_status: string;
  payout_status: string;
  notes: string | null;
};

type DraftRow = {
  id: string | null; // null = unsaved new row
  driver_id: string;
  vehicle_type: string;
  client_share: string;
  cost_to_company: string;
  driver_receives: string;
  tvl_commission: string;
  notes: string;
  commission_status: string;
  payout_status: string;
  driver_name: string | null;
  driver_staff_no: string | null;
  driver_vehicle: string | null;
  driver_plate: string | null;
};

interface Props {
  bookingId: string;
}

const blankDraft = (): DraftRow => ({
  id: null,
  driver_id: "",
  vehicle_type: "",
  client_share: "",
  cost_to_company: "",
  driver_receives: "",
  tvl_commission: "",
  notes: "",
  commission_status: "Outstanding",
  payout_status: "Pending",
  driver_name: null,
  driver_staff_no: null,
  driver_vehicle: null,
  driver_plate: null,
});

const isLocked = (r: { commission_status: string; payout_status: string }) =>
  r.commission_status === "Settled" || r.payout_status === "Paid";

const toDraft = (r: ExtraVehicle): DraftRow => ({
  id: r.id,
  driver_id: r.driver_id ?? "",
  vehicle_type: r.vehicle_type ?? "",
  client_share: String(r.client_share ?? ""),
  cost_to_company: String(r.cost_to_company ?? ""),
  driver_receives: String(r.driver_receives ?? ""),
  tvl_commission: String(r.tvl_commission ?? ""),
  notes: r.notes ?? "",
  commission_status: r.commission_status,
  payout_status: r.payout_status,
  driver_name: r.driver_name,
  driver_staff_no: r.driver_staff_no,
  driver_vehicle: r.driver_vehicle,
  driver_plate: r.driver_plate,
});

export function BookingVehiclesRoster({ bookingId }: Props) {
  const [rows, setRows] = useState<ExtraVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ idx: number; id: string } | null>(null);
  const [confirmUnlock, setConfirmUnlock] = useState<{ idx: number; id: string; commission_status: string; payout_status: string } | null>(null);
  const [unlockingIdx, setUnlockingIdx] = useState<number | null>(null);

  const { user } = useAuth();
  const { toast } = useToast();
  const canEdit = user?.role === "operator" || user?.role === "admin" || user?.role === "super_admin";
  // Unlocking a settled/paid row reopens the financial ledger entry, so
  // restrict to admin roles only — regular operators must still go via
  // the Commissions page.
  const canUnlock = user?.role === "admin" || user?.role === "super_admin";
  const { data: drivers } = useListDrivers(
    {},
    { query: { enabled: canEdit, queryKey: getListDriversQueryKey({}) } },
  );

  // Versioned fetch guard: every fetch increments fetchSeq; the resolver
  // checks its own ticket against fetchSeq.current and bails if a newer
  // request has started (e.g. bookingId changed mid-flight).
  const fetchSeq = useRef(0);

  const fetchRows = useCallback(async (): Promise<ExtraVehicle[] | null> => {
    const ticket = ++fetchSeq.current;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const r = await fetch(`/api/booking-vehicles?booking_id=${encodeURIComponent(bookingId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(await r.text());
      const data = (await r.json()) as ExtraVehicle[];
      if (ticket !== fetchSeq.current) return null; // stale
      setRows(data ?? []);
      setLoadError(null);
      return data;
    } catch (e: any) {
      if (ticket !== fetchSeq.current) return null;
      console.warn("[BookingVehiclesRoster] fetch failed", e);
      setLoadError(e?.message ?? "Failed to load roster");
      return null;
    } finally {
      if (ticket === fetchSeq.current) setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => {
    // Reset state on bookingId change so we never show another booking's data.
    setRows([]);
    setDrafts([]);
    setEditing(false);
    setLoading(true);
    setLoadError(null);
    fetchRows();
  }, [bookingId, fetchRows]);

  const enterEdit = () => {
    setDrafts(rows.map(toDraft));
    setEditing(true);
  };

  const cancelEdit = () => {
    setDrafts([]);
    setEditing(false);
  };

  const updateDraft = (idx: number, patch: Partial<DraftRow>) => {
    setDrafts(prev => prev.map((d, i) => i === idx ? { ...d, ...patch } : d));
  };

  const addRow = () => {
    setDrafts(prev => [...prev, blankDraft()]);
  };

  const authToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? "";
  };

  // Operators only enter two numbers per extra car: the Cost (what the client
  // pays for this leg — flows into the booking's invoice/total) and the TVL
  // Commission (what TVL keeps). Everything else is derived so the existing
  // commissions/payouts pipeline keeps working untouched:
  //   client_share     = cost   (added to the client's bill)
  //   cost_to_company  = cost   (TVL has to fund the whole leg)
  //   driver_receives  = cost − commission
  //   tvl_commission   = commission
  const buildPayload = (d: DraftRow) => {
    const cost = Number(d.cost_to_company) || 0;
    const commission = Number(d.tvl_commission) || 0;
    const driverPay = Math.max(0, cost - commission);
    return {
      booking_id: bookingId,
      driver_id: d.driver_id || null,
      vehicle_type: d.vehicle_type || null,
      client_share: cost,
      cost_to_company: cost,
      driver_receives: driverPay,
      tvl_commission: commission,
      notes: d.notes || null,
    };
  };

  const saveRow = async (idx: number) => {
    const d = drafts[idx];
    if (!d) return;
    setSavingIdx(idx);
    try {
      const token = await authToken();
      const isNew = !d.id;
      const url = isNew ? "/api/booking-vehicles" : `/api/booking-vehicles/${d.id}`;
      const r = await fetch(url, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(buildPayload(d)),
      });
      if (!r.ok) {
        const errText = await r.text().catch(() => "");
        toast({
          title: isNew ? "Couldn't add vehicle" : "Couldn't save vehicle",
          description: errText || "Please try again.",
          variant: "destructive",
        });
        return;
      }
      const saved: ExtraVehicle = await r.json();
      toast({ title: isNew ? "Vehicle added" : "Vehicle saved" });
      // Refresh the list so the read-only view stays in sync, but DO NOT
      // wipe other unsaved drafts — only replace the saved row in-place.
      // Other rows the user is still editing stay exactly as they typed.
      await fetchRows();
      setDrafts(prev => prev.map((row, i) => (i === idx ? toDraft(saved) : row)));
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSavingIdx(null);
    }
  };

  const performDelete = async (idx: number, id: string) => {
    try {
      const token = await authToken();
      const r = await fetch(`/api/booking-vehicles/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok && r.status !== 204) {
        const errText = await r.text().catch(() => "");
        toast({ title: "Couldn't remove vehicle", description: errText, variant: "destructive" });
        return;
      }
      toast({ title: "Vehicle removed" });
      // Refresh server state, but only drop THIS row from drafts; preserve
      // any unsaved edits the user has in progress on other rows.
      await fetchRows();
      setDrafts(prev => prev.filter((_, i) => i !== idx));
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setConfirmDelete(null);
    }
  };

  const performUnlock = async (idx: number, id: string, commission_status: string, payout_status: string) => {
    setUnlockingIdx(idx);
    try {
      const token = await authToken();
      // Status-only PATCH: only flip the fields that are actually locked.
      // Settled → Outstanding for commission, Paid → Pending for payout.
      // Sending only these keys keeps the server's "status-only" branch
      // active so the lock guard doesn't reject the request.
      const patch: Record<string, string> = {};
      if (commission_status === "Settled") patch.commission_status = "Outstanding";
      if (payout_status === "Paid") patch.payout_status = "Pending";
      if (Object.keys(patch).length === 0) {
        setConfirmUnlock(null);
        return;
      }
      const r = await fetch(`/api/booking-vehicles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(patch),
      });
      if (!r.ok) {
        const errText = await r.text().catch(() => "");
        toast({ title: "Couldn't unlock vehicle", description: errText || "Please try again.", variant: "destructive" });
        return;
      }
      const saved: ExtraVehicle = await r.json();
      toast({ title: "Vehicle unlocked", description: "The row is back in the pending pool — edit and re-settle as needed." });
      await fetchRows();
      setDrafts(prev => prev.map((row, i) => (i === idx ? toDraft(saved) : row)));
    } catch (e: any) {
      toast({ title: "Unlock failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setUnlockingIdx(null);
      setConfirmUnlock(null);
    }
  };

  const removeUnsaved = (idx: number) => {
    setDrafts(prev => prev.filter((_, i) => i !== idx));
  };

  if (loading) return null;

  // If the initial fetch failed, show a small error card with retry so the
  // operator knows the roster might be stale rather than empty.
  if (loadError) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="p-3 flex items-center justify-between gap-3">
          <div className="text-xs text-destructive">
            Couldn't load multi-vehicle roster. {loadError}
          </div>
          <Button size="sm" variant="outline" onClick={() => { setLoading(true); setLoadError(null); fetchRows(); }}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Hide entirely when there's nothing AND user can't edit / isn't editing.
  if (rows.length === 0 && !editing && !canEdit) return null;

  // ─── VIEW MODE ──────────────────────────────────────────────────────────
  if (!editing) {
    if (rows.length === 0) {
      // Empty + canEdit: render a small "Add additional vehicle" CTA only.
      return (
        <Card className="border-dashed border-border/60 bg-card/40">
          <CardContent className="p-3 flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              Single-car booking. Add an additional vehicle if a second car is needed.
            </div>
            <Button size="sm" variant="outline" onClick={enterEdit} data-testid="btn-roster-add-first">
              <Plus className="w-3.5 h-3.5 mr-1" /> Add vehicle
            </Button>
          </CardContent>
        </Card>
      );
    }
    return (
      <Card className="border-primary/10 bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Users className="w-4 h-4" /> Multi-Vehicle Roster
              <Badge variant="outline" className="ml-1 text-xs">{rows.length + 1} cars</Badge>
            </span>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={enterEdit} data-testid="btn-roster-edit">
                <Pencil className="w-3.5 h-3.5 mr-1" /> Edit roster
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Primary driver above is car #1. Below are the additional cars on this booking — each with their own driver and pay.
          </p>
          {rows.map((row, idx) => (
            <div key={row.id} className="rounded-md border border-border/60 bg-background/50 p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-primary">Car #{idx + 2}</div>
                <div className="flex items-center gap-1.5">
                  <Badge variant={row.commission_status === "Settled" ? "secondary" : "outline"} className="text-[10px]">
                    Comm: {row.commission_status}
                  </Badge>
                  <Badge variant={row.payout_status === "Paid" ? "secondary" : "outline"} className="text-[10px]">
                    Payout: {row.payout_status}
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Driver</p>
                  {row.driver_id ? (
                    <Link href={`/drivers/${row.driver_id}`}>
                      <span className="font-semibold text-primary hover:underline cursor-pointer">
                        {row.driver_staff_no ? `${row.driver_staff_no} · ` : ""}{row.driver_name ?? "—"}
                      </span>
                    </Link>
                  ) : (
                    <span className="font-medium text-destructive">Unassigned</span>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Car className="w-3 h-3" /> Vehicle</p>
                  <p className="font-medium">
                    {row.vehicle_type || row.driver_vehicle || "—"}
                    {row.driver_plate ? <span className="text-xs text-muted-foreground"> · {row.driver_plate}</span> : null}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 text-xs pt-1.5 border-t border-border/40">
                <div>
                  <span className="text-muted-foreground block">Client £</span>
                  <span className="font-semibold">£{Number(row.client_share).toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Cost £</span>
                  <span className="font-semibold">£{Number(row.cost_to_company).toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Driver pay</span>
                  <span className="font-semibold">£{Number(row.driver_receives).toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">TVL comm</span>
                  <span className="font-semibold">£{Number(row.tvl_commission).toFixed(2)}</span>
                </div>
              </div>

              {row.notes && (
                <p className="text-xs text-muted-foreground pt-1.5 border-t border-border/40">
                  {row.notes}
                </p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  // ─── EDIT MODE ──────────────────────────────────────────────────────────
  return (
    <Card className="border-primary/30 bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Users className="w-4 h-4" /> Edit Vehicle Roster
            <Badge variant="outline" className="ml-1 text-xs">{drafts.length + 1} cars</Badge>
          </span>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={addRow} data-testid="btn-roster-add">
              <Plus className="w-3.5 h-3.5 mr-1" /> Add vehicle
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelEdit} data-testid="btn-roster-done">
              <X className="w-3.5 h-3.5 mr-1" /> Done
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Edit each car independently. Rows that have already been settled or paid are locked{canUnlock ? " — admins can unlock them here, or reopen them from the Commissions page" : " — reopen them on the Commissions page first"}.
        </p>

        {drafts.length === 0 && (
          <div className="text-xs text-muted-foreground italic">No additional vehicles yet. Click "Add vehicle" to create one.</div>
        )}

        {drafts.map((d, idx) => {
          const locked = !!d.id && isLocked(d);
          return (
            <div
              key={d.id ?? `new-${idx}`}
              className={`rounded-md border p-3 space-y-2 ${locked ? "border-border/40 bg-muted/30 opacity-75" : "border-primary/20 bg-background/50"}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="text-xs font-semibold text-primary">Car #{idx + 2}</div>
                  {locked && (
                    <Badge variant="secondary" className="text-[10px] gap-1">
                      <Lock className="w-3 h-3" /> Locked: {d.commission_status === "Settled" ? "settled" : "paid out"}
                    </Badge>
                  )}
                  {!d.id && (
                    <Badge variant="outline" className="text-[10px]">Unsaved</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {locked && canUnlock && d.id && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={() => setConfirmUnlock({
                        idx,
                        id: d.id!,
                        commission_status: d.commission_status,
                        payout_status: d.payout_status,
                      })}
                      disabled={unlockingIdx === idx}
                      data-testid={`btn-roster-unlock-${idx}`}
                    >
                      <LockOpen className="w-3.5 h-3.5 mr-1" />
                      {unlockingIdx === idx ? "Unlocking…" : "Unlock"}
                    </Button>
                  )}
                  {!locked && (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="default"
                        className="h-7"
                        onClick={() => saveRow(idx)}
                        disabled={savingIdx === idx}
                        data-testid={`btn-roster-save-${idx}`}
                      >
                        <Save className="w-3.5 h-3.5 mr-1" />
                        {savingIdx === idx ? "Saving…" : (d.id ? "Save" : "Add")}
                      </Button>
                      {d.id ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 text-destructive hover:text-destructive"
                          onClick={() => setConfirmDelete({ idx, id: d.id! })}
                          data-testid={`btn-roster-delete-${idx}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7"
                          onClick={() => removeUnsaved(idx)}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium">Driver</label>
                  <Select
                    value={d.driver_id || "unassigned"}
                    disabled={locked}
                    onValueChange={(val) => {
                      const drv = (drivers as any[] | undefined)?.find((x: any) => x.id === val);
                      updateDraft(idx, {
                        driver_id: val === "unassigned" ? "" : val,
                        vehicle_type: d.vehicle_type || (drv?.vehicle_model || drv?.vehicle_type || ""),
                      });
                    }}
                  >
                    <SelectTrigger className="h-9" data-testid={`roster-driver-${idx}`}>
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    {/* Long driver lists need to be scrollable — without a
                        max-height the popover can extend past the viewport
                        and the operator can't reach lower drivers on a
                        phone. */}
                    <SelectContent className="max-h-[300px] overflow-y-auto">
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {(drivers as any[] | undefined)?.map((driver: any) => (
                        <SelectItem key={driver.id} value={driver.id}>
                          {driver.staff_no ? `${driver.staff_no} · ` : ""}{driver.name} · {driver.vehicle_model || driver.vehicle_type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium">Vehicle</label>
                  <Input
                    className="h-9"
                    placeholder="e.g. MB V Class"
                    disabled={locked}
                    value={d.vehicle_type}
                    onChange={(e) => updateDraft(idx, { vehicle_type: e.target.value })}
                  />
                </div>
              </div>

              {/* Simplified to two numbers per operator request:
                  Cost = what the client pays for this leg (added to invoice)
                  TVL Commission = what TVL keeps. Driver pay derives as
                  (Cost − Commission) on save, so the existing payout +
                  commissions pages keep working. The live preview below
                  shows what the driver will actually receive. */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium">Cost £ <span className="text-muted-foreground font-normal">(adds to client invoice)</span></label>
                  <Input
                    className="h-9"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    placeholder="0.00"
                    disabled={locked}
                    value={d.cost_to_company}
                    onChange={(e) => updateDraft(idx, { cost_to_company: e.target.value })}
                    data-testid={`roster-cost-${idx}`}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium">TVL commission £</label>
                  <Input
                    className="h-9"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    placeholder="0.00"
                    disabled={locked}
                    value={d.tvl_commission}
                    onChange={(e) => updateDraft(idx, { tvl_commission: e.target.value })}
                    data-testid={`roster-commission-${idx}`}
                  />
                </div>
              </div>

              <div className="text-[11px] text-muted-foreground">
                Driver pay (auto): £{Math.max(0, (Number(d.cost_to_company) || 0) - (Number(d.tvl_commission) || 0)).toFixed(2)}
              </div>

              <div>
                <label className="text-xs font-medium">Notes</label>
                <Input
                  className="h-9"
                  placeholder="Optional"
                  disabled={locked}
                  value={d.notes}
                  onChange={(e) => updateDraft(idx, { notes: e.target.value })}
                />
              </div>
            </div>
          );
        })}
      </CardContent>

      <AlertDialog open={!!confirmUnlock} onOpenChange={(open) => !open && setConfirmUnlock(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlock this vehicle row?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmUnlock?.commission_status === "Settled" && confirmUnlock?.payout_status === "Paid"
                ? "This row's commission is settled and the driver has been paid out. Unlocking it will reset the commission to Outstanding and the payout to Pending — the row will reappear in both the Commissions and Payouts pending pools and you'll need to re-settle/re-pay it."
                : confirmUnlock?.commission_status === "Settled"
                ? "This row's commission has been settled. Unlocking will reset it to Outstanding — the row will reappear in the Commissions pending pool and you'll need to re-settle it."
                : "This row has been paid out to the driver. Unlocking will reset the payout to Pending — the row will reappear in the Payouts pending pool and you'll need to re-pay it."}
              {" "}This action is recorded in the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmUnlock && performUnlock(
                confirmUnlock.idx,
                confirmUnlock.id,
                confirmUnlock.commission_status,
                confirmUnlock.payout_status,
              )}
              data-testid="btn-roster-unlock-confirm"
            >
              Unlock row
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this vehicle?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the additional vehicle from this booking. The primary driver on the booking is not affected. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmDelete && performDelete(confirmDelete.idx, confirmDelete.id)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
