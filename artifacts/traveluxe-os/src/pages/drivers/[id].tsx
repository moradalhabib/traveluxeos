import { useParams, useLocation, Link } from "wouter";
import { useState, useEffect } from "react";
import { useGetDriver, useUpdateDriver, getGetDriverQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Edit, ArrowLeft, Star, Calculator, Car, Save, X, Loader2 } from "lucide-react";
import { format } from "date-fns";

export default function DriverDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const id = params.id as string;
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: driver, isLoading } = useGetDriver(id, {
    query: { enabled: !!id, queryKey: getGetDriverQueryKey(id) }
  });

  const updateDriver = useUpdateDriver();

  // Edit state — initialised from the loaded driver, then editable in-place.
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: "",
    whatsapp: "",
    vehicle_model: "",
    vehicle_year: "" as string | number,
    plate: "",
    notes: "",
  });

  // Sync the form whenever the driver loads or the user re-enters edit mode.
  useEffect(() => {
    if (!driver) return;
    setForm({
      name: driver.name ?? "",
      whatsapp: (driver as any).whatsapp ?? "",
      vehicle_model: (driver as any).vehicle_model ?? "",
      vehicle_year: (driver as any).vehicle_year ?? "",
      plate: (driver as any).plate ?? "",
      notes: (driver as any).notes ?? "",
    });
  }, [driver, editing]);

  const handleSave = () => {
    const payload: any = {
      name: form.name.trim(),
      whatsapp: form.whatsapp.trim(),
      vehicle_model: form.vehicle_model.trim() || null,
      vehicle_year: form.vehicle_year === "" || form.vehicle_year == null
        ? null
        : Number(form.vehicle_year),
      plate: form.plate.trim() || null,
      notes: form.notes.trim() || null,
    };
    if (!payload.name || !payload.whatsapp) {
      toast({ title: "Driver name and WhatsApp number are required", variant: "destructive" });
      return;
    }
    if (payload.vehicle_year && (payload.vehicle_year < 1990 || payload.vehicle_year > 2030)) {
      toast({ title: "Vehicle year must be between 1990 and 2030", variant: "destructive" });
      return;
    }
    updateDriver.mutate(
      { id, data: payload },
      {
        onSuccess: () => {
          toast({ title: "Driver profile updated" });
          qc.invalidateQueries({ queryKey: getGetDriverQueryKey(id) });
          qc.invalidateQueries({ queryKey: ["/drivers"] });
          setEditing(false);
        },
        onError: (err: any) => {
          toast({
            title: "Failed to update driver",
            description: err?.response?.data?.error ?? err?.message ?? "Try again",
            variant: "destructive",
          });
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[300px] w-full" />
      </div>
    );
  }

  if (!driver) {
    return <div>Driver not found</div>;
  }

  // Display string for the vehicle line in the header.
  const vehicleLine = [
    (driver as any).vehicle_year,
    (driver as any).vehicle_model,
  ].filter(Boolean).join(" ");

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Button variant="ghost" onClick={() => setLocation("/drivers")} className="mb-4">
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Drivers
      </Button>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{driver.name}</h1>
            {(driver as any).staff_no && (
              <span className="font-mono text-sm px-2.5 py-1 rounded bg-primary/10 text-primary border border-primary/30 font-semibold">
                {(driver as any).staff_no}
              </span>
            )}
            <Badge variant="outline" className={driver.status === 'Active' ? 'bg-green-500/20 text-green-500 border-green-500/50' : 'bg-secondary text-secondary-foreground border-border'}>
              {driver.status}
            </Badge>
          </div>
          {vehicleLine && (
            <div className="flex items-center gap-2 mt-1 mb-1">
              <Car className="w-4 h-4 text-primary" />
              <span className="text-primary font-semibold text-lg">{vehicleLine}</span>
              {(driver as any).plate && (
                <span className="font-mono text-sm text-muted-foreground bg-secondary px-2 py-0.5 rounded">
                  {(driver as any).plate}
                </span>
              )}
            </div>
          )}
          <p className="text-muted-foreground">{(driver as any).whatsapp}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {(driver as any).whatsapp && !editing && (
            <a href={`https://wa.me/${(driver as any).whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">
              <Button className="bg-green-900/20 text-green-500 hover:bg-green-900/40 border border-green-900/50">
                <MessageSquare className="w-4 h-4 mr-2" />
                WhatsApp
              </Button>
            </a>
          )}
          {!editing && (
            <Button
              variant="outline"
              onClick={() => setEditing(true)}
              data-testid="button-edit-driver"
            >
              <Edit className="w-4 h-4 mr-2" /> Edit
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-primary/10 bg-card md:col-span-2">
          <CardHeader>
            <CardTitle>Driver Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {editing ? (
              // ── Edit form ─────────────────────────────────────────────
              // Exactly the six fields the operator needs: name, phone,
              // vehicle make+model, vehicle year, license plate, notes.
              <div className="space-y-4">
                <div>
                  <Label htmlFor="name">Driver Name *</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    data-testid="input-name"
                  />
                </div>
                <div>
                  <Label htmlFor="whatsapp">Phone / WhatsApp Number *</Label>
                  <Input
                    id="whatsapp"
                    type="tel"
                    placeholder="+44 7700 000000"
                    value={form.whatsapp}
                    onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                    data-testid="input-whatsapp"
                  />
                </div>
                <div>
                  <Label htmlFor="vehicle_model">Vehicle Make &amp; Model</Label>
                  <Input
                    id="vehicle_model"
                    placeholder="e.g. Range Rover Vogue, Mercedes E Class"
                    value={form.vehicle_model}
                    onChange={(e) => setForm({ ...form, vehicle_model: e.target.value })}
                    data-testid="input-vehicle-model"
                  />
                </div>
                <div>
                  <Label htmlFor="vehicle_year">Vehicle Year</Label>
                  <Input
                    id="vehicle_year"
                    type="number"
                    inputMode="numeric"
                    min={1990}
                    max={2030}
                    placeholder="e.g. 2024"
                    value={form.vehicle_year}
                    onChange={(e) => setForm({ ...form, vehicle_year: e.target.value })}
                    data-testid="input-vehicle-year"
                  />
                </div>
                <div>
                  <Label htmlFor="plate">License Plate / Registration Number</Label>
                  <Input
                    id="plate"
                    placeholder="e.g. CX73 KTP"
                    value={form.plate}
                    onChange={(e) => setForm({ ...form, plate: e.target.value })}
                    className="font-mono uppercase"
                    data-testid="input-plate"
                  />
                </div>
                <div>
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    rows={3}
                    placeholder="Internal notes — preferences, availability, etc."
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    data-testid="input-notes"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={handleSave}
                    disabled={updateDriver.isPending}
                    className="flex-1"
                    data-testid="button-save-driver"
                  >
                    {updateDriver.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    <Save className="w-4 h-4 mr-2" /> Save Changes
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setEditing(false)}
                    disabled={updateDriver.isPending}
                    data-testid="button-cancel-edit"
                  >
                    <X className="w-4 h-4 mr-2" /> Cancel
                  </Button>
                </div>
              </div>
            ) : (
              // ── Read-only view ────────────────────────────────────────
              <>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground block mb-1">Vehicle Make &amp; Model</span>
                    <span className="font-medium">{(driver as any).vehicle_model || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Vehicle Year</span>
                    <span className="font-medium">{(driver as any).vehicle_year || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">License Plate</span>
                    <span className="font-medium">{(driver as any).plate || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Total Jobs</span>
                    <span className="font-medium">{driver.total_jobs || 0}</span>
                  </div>
                </div>
                {(driver as any).notes && (
                  <div className="pt-4 border-t border-border mt-4">
                    <span className="text-muted-foreground block mb-1 text-sm">Notes</span>
                    <p className="text-sm whitespace-pre-wrap">{(driver as any).notes}</p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-primary/10 bg-card">
          <CardHeader className="pb-2 text-center">
            <CardTitle className="text-muted-foreground text-sm font-normal">Average Rating</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <div className="text-5xl font-bold text-primary flex items-center justify-center gap-2 mb-2">
              {driver.avg_rating?.toFixed(1) || '0.0'} <Star className="w-8 h-8 fill-primary" />
            </div>
            <div className="text-xs text-muted-foreground">{(driver as any).ratings?.length || 0} total ratings</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 mt-6">
        <Card className="border-primary/10 bg-card">
          <CardHeader>
            <CardTitle className="flex justify-between items-center">
              <span>Commission Ledger</span>
              <Calculator className="w-5 h-5 text-muted-foreground" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(driver as any).commission_ledger && (driver as any).commission_ledger.length > 0 ? (
              <div className="space-y-4">
                {(driver as any).commission_ledger.map((entry: any, idx: number) => (
                  <Link
                    key={idx}
                    href={entry.booking_id ? `/bookings/${entry.booking_id}` : "#"}
                  >
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center p-3 rounded-lg border border-border bg-background/50 gap-2 hover:border-primary/40 hover:bg-secondary/10 transition-colors cursor-pointer">
                    <div>
                      <div className="font-medium font-mono text-xs text-primary hover:underline">{entry.tvl_ref}</div>
                      <div className="text-sm">{entry.client_name || 'Booking'}</div>
                      <div className="text-xs text-muted-foreground">{entry.date ? format(new Date(entry.date), 'PP') : ''}</div>
                    </div>
                    <div className="text-right flex flex-row sm:flex-col justify-between sm:justify-start items-center sm:items-end gap-2">
                      <div className="text-sm">
                        <span className="text-muted-foreground">TVL: </span>
                        <span className="font-bold text-primary">£{entry.tvl_commission}</span>
                      </div>
                      <Badge variant="outline" className={entry.commission_status === 'Settled' || entry.payout_status === 'Paid' ? 'text-green-500' : 'text-amber-500'}>
                        {entry.payment_method === 'Cash' ? entry.commission_status : entry.payout_status}
                      </Badge>
                    </div>
                  </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm border border-dashed rounded-lg">
                No commission history
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
