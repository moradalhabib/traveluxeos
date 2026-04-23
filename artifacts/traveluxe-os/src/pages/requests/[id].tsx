import { useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { format, parseISO } from "date-fns";
import {
  ArrowLeft, CalendarRange, Phone, Mail, Pencil, Save, X,
  Trash2, ArrowRight, Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  useRequest, useUpdateRequest, useDeleteRequest, useConvertRequest,
  PRIORITY_STYLES, STATUS_STYLES,
} from "@/lib/requests-api";
import { ActivityPanel } from "@/components/activity/ActivityPanel";

const SERVICE_TYPES = ["Airport Transfer","Tour","Car Rental","Apartment","Hotel","Other"];
const PRIORITIES = ["Low","Medium","High","Urgent"];
const ALL_STATUSES = ["New","Following Up","Ready to Book","Converted","Declined","Expired"];

export default function RequestDetail() {
  const [, params] = useRoute<{ id: string }>("/requests/:id");
  const [, setLocation] = useLocation();
  const id = params?.id;
  const { toast } = useToast();

  const { data: r, isLoading } = useRequest(id);
  const update = useUpdateRequest();
  const remove = useDeleteRequest();
  const convert = useConvertRequest();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<any>({});

  if (isLoading) return <Skeleton className="h-96" />;
  if (!r) return <div className="text-muted-foreground">Request not found.</div>;

  const startEdit = () => {
    setDraft({
      service_type: r.service_type,
      priority: r.priority,
      status: r.status,
      follow_up_date: r.follow_up_date,
      requested_date_time: r.requested_date_time?.slice(0, 16) ?? "",
      estimated_price: r.estimated_price ?? "",
      notes: r.notes ?? "",
      client_name: r.client_name ?? "",
    });
    setEditing(true);
  };

  const saveEdit = () => {
    if (!id) return;
    const patch: any = { ...draft };
    if (patch.requested_date_time === "") delete patch.requested_date_time;
    if (patch.estimated_price === "") patch.estimated_price = null;
    update.mutate({ id, ...patch }, {
      onSuccess: () => { setEditing(false); toast({ title: "Request updated" }); },
      onError: (e: any) => toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
    });
  };

  const handleDelete = () => {
    if (!id) return;
    if (!confirm("Delete this request? This cannot be undone.")) return;
    remove.mutate(id, {
      onSuccess: () => { toast({ title: "Request deleted" }); setLocation("/requests"); },
      onError: (e: any) => toast({ title: "Delete failed", description: e?.message, variant: "destructive" }),
    });
  };

  const handleConvert = () => {
    if (!id) return;
    convert.mutate(id, {
      onSuccess: (resp: any) => {
        const draft = resp?.draft ?? {};
        const params = new URLSearchParams();
        params.set("from_request", id);
        if (draft.client_id) params.set("client_id", draft.client_id);
        if (draft.client_name) params.set("client_name", draft.client_name);
        if (draft.service_type) params.set("service_type", draft.service_type);
        if (draft.date_time) params.set("date_time", draft.date_time);
        if (draft.notes) params.set("notes", draft.notes);
        if (draft.price) params.set("price", String(draft.price));
        setLocation(`/bookings/new?${params.toString()}`);
      },
      onError: (e: any) => toast({ title: "Convert failed", description: e?.message, variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={() => setLocation("/requests")} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> Back to Requests
        </Button>
        <div className="flex gap-2">
          {!editing && (
            <>
              <Button variant="outline" onClick={startEdit}>
                <Pencil className="w-4 h-4 mr-2" /> Edit
              </Button>
              <Button variant="outline" onClick={handleDelete} className="text-red-400 border-red-500/30 hover:bg-red-500/10">
                <Trash2 className="w-4 h-4 mr-2" /> Delete
              </Button>
            </>
          )}
          {editing && (
            <>
              <Button variant="outline" onClick={() => setEditing(false)}>
                <X className="w-4 h-4 mr-2" /> Cancel
              </Button>
              <Button onClick={saveEdit} disabled={update.isPending}>
                {update.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save
              </Button>
            </>
          )}
        </div>
      </div>

      <Card className="border-primary/10">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-2xl">
              {(r as any).client_id ? (
                <Link href={`/clients/${(r as any).client_id}`}>
                  <span className="text-primary hover:underline cursor-pointer">{r.client_name || "Unknown client"}</span>
                </Link>
              ) : (
                <>{r.client_name || "Unknown client"}</>
              )}
            </CardTitle>
            <div className="flex gap-2">
              <Badge variant="outline" className={PRIORITY_STYLES[r.priority]}>{r.priority}</Badge>
              <Badge variant="outline" className={STATUS_STYLES[r.status]}>{r.status}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">

          {!editing ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <Field label="Service">{r.service_type}</Field>
                <Field label="Follow-up">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarRange className="w-3.5 h-3.5 text-muted-foreground" />
                    {format(parseISO(r.follow_up_date), "EEE, d MMM yyyy")}
                  </span>
                </Field>
                <Field label="Requested for">
                  {r.requested_date_time ? format(parseISO(r.requested_date_time), "PPp") : "—"}
                </Field>
                <Field label="Estimated price">
                  {r.estimated_price != null ? `£${Number(r.estimated_price).toLocaleString()}` : "—"}
                </Field>
              </div>

              {(r.client_whatsapp || r.client_email) && (
                <div className="flex flex-wrap gap-3 pt-2 border-t border-border/40">
                  {r.client_whatsapp && (
                    <a href={`https://wa.me/${r.client_whatsapp.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="outline">
                        <Phone className="w-3.5 h-3.5 mr-1.5" /> WhatsApp
                      </Button>
                    </a>
                  )}
                  {r.client_email && (
                    <a href={`mailto:${r.client_email}`}>
                      <Button size="sm" variant="outline">
                        <Mail className="w-3.5 h-3.5 mr-1.5" /> Email
                      </Button>
                    </a>
                  )}
                </div>
              )}

              {r.notes && (
                <div>
                  <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Notes</h4>
                  <p className="text-sm whitespace-pre-wrap">{r.notes}</p>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Labelled label="Client name">
                  <Input value={draft.client_name ?? ""} onChange={e => setDraft({ ...draft, client_name: e.target.value })} />
                </Labelled>
                <Labelled label="Service type">
                  <Select value={draft.service_type} onValueChange={v => setDraft({ ...draft, service_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{SERVICE_TYPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </Labelled>
                <Labelled label="Priority">
                  <Select value={draft.priority} onValueChange={v => setDraft({ ...draft, priority: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </Labelled>
                <Labelled label="Status">
                  <Select value={draft.status} onValueChange={v => setDraft({ ...draft, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{ALL_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </Labelled>
                <Labelled label="Follow-up date">
                  <Input type="date" value={draft.follow_up_date ?? ""} onChange={e => setDraft({ ...draft, follow_up_date: e.target.value })} />
                </Labelled>
                <Labelled label="Requested date / time">
                  <Input type="datetime-local" value={draft.requested_date_time ?? ""} onChange={e => setDraft({ ...draft, requested_date_time: e.target.value })} />
                </Labelled>
                <Labelled label="Estimated price (£)">
                  <Input type="number" step="0.01" value={draft.estimated_price ?? ""} onChange={e => setDraft({ ...draft, estimated_price: e.target.value })} />
                </Labelled>
              </div>

              <Labelled label="Notes">
                <Textarea rows={4} value={draft.notes ?? ""} onChange={e => setDraft({ ...draft, notes: e.target.value })} />
              </Labelled>
            </div>
          )}

        </CardContent>
      </Card>

      {!editing && r.status !== "Converted" && r.status !== "Declined" && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-foreground">Ready to turn into a booking?</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                The booking form will open prefilled with these details.
              </p>
            </div>
            <Button onClick={handleConvert} disabled={convert.isPending} className="w-full sm:w-auto">
              {convert.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Convert to Booking <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Activity feed — same component used on client/driver/booking
          detail pages so operators see status changes, edits, and
          conversion history for this request in one place. */}
      {id && (
        <ActivityPanel
          entityType="request"
          entityId={id}
          title="Activity"
          description="Status changes, edits, and conversions for this request."
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</span>
      <span className="text-foreground font-medium">{children}</span>
    </div>
  );
}
function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
