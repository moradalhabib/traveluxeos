import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useGetClient, getGetClientQueryKey, useListClients } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { MessageSquare, Edit, ArrowLeft, Ban, Plus, CalendarRange, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";

export default function ClientDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const id = params.id as string;
  const qc = useQueryClient();
  const { token } = useAuth();

  const { data: client, isLoading } = useGetClient(id, {
    query: { enabled: !!id, queryKey: getGetClientQueryKey(id) }
  });

  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState("");
  const [editWhatsapp, setEditWhatsapp] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editNationality, setEditNationality] = useState("");
  const [editLanguage, setEditLanguage] = useState("");
  const [editVip, setEditVip] = useState("");
  const [editNotes, setEditNotes] = useState("");

  // Delete dialog state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const openEdit = () => {
    if (!client) return;
    setEditName(client.name || "");
    setEditWhatsapp((client as any).whatsapp || "");
    setEditEmail((client as any).email || "");
    setEditNationality((client as any).nationality || "");
    setEditLanguage((client as any).language_preference || "");
    setEditVip((client as any).vip_tier || "Standard");
    setEditNotes((client as any).notes || "");
    setEditOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: editName,
          whatsapp: editWhatsapp,
          email: editEmail || undefined,
          nationality: editNationality || undefined,
          language_preference: editLanguage || undefined,
          vip_tier: editVip || "Standard",
          notes: editNotes || undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      await qc.invalidateQueries({ queryKey: getGetClientQueryKey(id) });
      setEditOpen(false);
    } catch (e: any) {
      alert("Failed to save: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const err = await res.json();
        setDeleteError(err.error || "Delete failed");
        return;
      }
      await qc.invalidateQueries({ queryKey: ["/api/clients"] });
      setLocation("/clients");
    } catch (e: any) {
      setDeleteError(e.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleInactive = async () => {
    if (!client) return;
    const res = await fetch(`/api/clients/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ inactive: !(client as any).inactive }),
    });
    if (res.ok) {
      await qc.invalidateQueries({ queryKey: getGetClientQueryKey(id) });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[300px] w-full" />
      </div>
    );
  }

  if (!client) return <div>Client not found</div>;

  const getVipBadgeColor = (tier: string) => {
    switch (tier) {
      case 'VVIP': return 'bg-purple-500/20 text-purple-400 border-purple-500/50';
      case 'VIP': return 'bg-primary/20 text-primary border-primary/50';
      default: return 'bg-secondary text-secondary-foreground border-border';
    }
  };

  const waNumber = (client as any).whatsapp?.replace(/\D/g, '') || '';

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <Button variant="ghost" onClick={() => setLocation("/clients")} className="mb-2 -ml-2">
        <ArrowLeft className="w-4 h-4 mr-2" /> Back
      </Button>

      {/* Client header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{client.name}</h1>
          <Badge variant="outline" className={getVipBadgeColor((client as any).vip_tier)}>
            {(client as any).vip_tier}
          </Badge>
          {(client as any).inactive && <Badge variant="destructive">Inactive</Badge>}
        </div>
        <p className="text-muted-foreground">{(client as any).whatsapp}</p>
      </div>

      {/* PRIMARY ACTION — Book This Client */}
      <Link href={`/bookings/new?client_id=${client.id}`}>
        <div className="relative overflow-hidden rounded-2xl bg-primary p-5 cursor-pointer shadow-[0_0_20px_rgba(201,168,76,0.25)] hover:shadow-[0_0_35px_rgba(201,168,76,0.45)] transition-all active:scale-[0.99]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-primary-foreground/80 text-sm font-medium mb-0.5">Ready to go?</p>
              <p className="text-primary-foreground font-bold text-xl">Book {client.name.split(' ')[0]}</p>
            </div>
            <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center">
              <Plus className="w-7 h-7 text-primary-foreground" />
            </div>
          </div>
          <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full bg-white/10" />
        </div>
      </Link>

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-3">
        <a href={`https://wa.me/${waNumber}`} target="_blank" rel="noopener noreferrer">
          <Button className="w-full bg-green-900/20 text-green-500 hover:bg-green-900/40 border border-green-900/50">
            <MessageSquare className="w-4 h-4 mr-2" />
            WhatsApp
          </Button>
        </a>
        <Button variant="outline" onClick={openEdit}>
          <Edit className="w-4 h-4 mr-2" />
          Edit Client
        </Button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <div className="text-2xl font-bold text-foreground">{(client as any).total_bookings || 0}</div>
          <div className="text-xs text-muted-foreground mt-1">Bookings</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <div className="text-2xl font-bold text-primary">£{((client as any).total_spent || 0).toLocaleString()}</div>
          <div className="text-xs text-muted-foreground mt-1">Total Spent</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <div className="text-sm font-bold text-foreground">{(client as any).language_preference || '—'}</div>
          <div className="text-xs text-muted-foreground mt-1">Language</div>
        </div>
      </div>

      {/* Client info */}
      <Card className="border-primary/10 bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Client Details</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div>
              <span className="text-muted-foreground block mb-1 text-xs">Email</span>
              <span className="font-medium">{(client as any).email || 'N/A'}</span>
            </div>
            <div>
              <span className="text-muted-foreground block mb-1 text-xs">Nationality</span>
              <span className="font-medium">{(client as any).nationality || 'N/A'}</span>
            </div>
            <div>
              <span className="text-muted-foreground block mb-1 text-xs">Client Since</span>
              <span className="font-medium">{(client as any).created_at ? format(new Date((client as any).created_at), 'PPP') : 'N/A'}</span>
            </div>
            <div>
              <span className="text-muted-foreground block mb-1 text-xs">Status</span>
              <span className={`font-medium ${(client as any).inactive ? 'text-destructive' : 'text-green-400'}`}>
                {(client as any).inactive ? 'Inactive' : 'Active'}
              </span>
            </div>
          </div>
          {(client as any).notes && (
            <div className="pt-4 border-t border-border mt-4">
              <span className="text-muted-foreground block mb-1 text-xs">Notes</span>
              <p className="text-sm">{(client as any).notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Full Booking History */}
      <Card className="border-primary/10 bg-card">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Booking History</CardTitle>
            {(client as any).bookings && (client as any).bookings.length > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {(client as any).bookings.length} total booking{(client as any).bookings.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <Link href={`/bookings/new?client_id=${client.id}`}>
            <Button size="sm" variant="outline" className="text-xs h-8">
              <Plus className="w-3 h-3 mr-1" /> New
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="pt-0">
          {(client as any).bookings && (client as any).bookings.length > 0 ? (
            <div className="space-y-2">
              {[...(client as any).bookings]
                .sort((a: any, b: any) => {
                  if (!a.date_time) return 1;
                  if (!b.date_time) return -1;
                  return new Date(b.date_time).getTime() - new Date(a.date_time).getTime();
                })
                .map((booking: any) => (
                  <Link key={booking.id} href={`/bookings/${booking.id}`}>
                    <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-background/50 hover:border-primary/30 transition-colors cursor-pointer">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{booking.tvl_ref}</span>
                          {booking.service_type && (
                            <Badge variant="outline" className="text-[10px] shrink-0">{booking.service_type}</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {booking.date_time ? format(new Date(booking.date_time), 'dd MMM yyyy · HH:mm') : 'No date'}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="font-semibold text-sm text-primary">£{(booking.price || 0).toLocaleString()}</div>
                        <Badge variant="outline" className={`text-[10px] mt-0.5 ${
                          booking.status === 'Completed' ? 'text-green-400 border-green-400/30' :
                          booking.status === 'Cancelled' ? 'text-destructive border-destructive/30' :
                          'text-primary border-primary/30'
                        }`}>
                          {booking.status}
                        </Badge>
                      </div>
                    </div>
                  </Link>
                ))}
            </div>
          ) : (
            <div className="flex flex-col items-center py-8 text-center">
              <CalendarRange className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No booking history yet</p>
              <Link href={`/bookings/new?client_id=${client.id}`}>
                <Button size="sm" className="mt-4">
                  <Plus className="w-3 h-3 mr-1" /> Create First Booking
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Danger zone */}
      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={handleToggleInactive} className="text-amber-400 hover:bg-amber-400/10 border-amber-500/30">
          <Ban className="w-4 h-4 mr-2" />
          {(client as any).inactive ? 'Mark Active' : 'Flag Inactive'}
        </Button>
        <Button variant="outline" onClick={() => { setDeleteError(""); setDeleteOpen(true); }} className="text-destructive hover:bg-destructive/10 border-destructive/30">
          <Trash2 className="w-4 h-4 mr-2" />
          Delete Profile
        </Button>
      </div>

      {/* ── EDIT CLIENT DIALOG ── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Client</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Full Name *</p>
              <Input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Full name" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">WhatsApp / Mobile *</p>
              <Input value={editWhatsapp} onChange={e => setEditWhatsapp(e.target.value)} placeholder="+44..." />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Email</p>
              <Input value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="email@example.com" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Nationality</p>
                <Input value={editNationality} onChange={e => setEditNationality(e.target.value)} placeholder="e.g. British" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Language</p>
                <Input value={editLanguage} onChange={e => setEditLanguage(e.target.value)} placeholder="e.g. English" />
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">VIP Tier</p>
              <select
                value={editVip}
                onChange={e => setEditVip(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="Standard">Standard</option>
                <option value="VIP">VIP</option>
                <option value="VVIP">VVIP</option>
              </select>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Notes</p>
              <textarea
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                rows={3}
                placeholder="Internal notes..."
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !editName || !editWhatsapp}>
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── DELETE CONFIRMATION DIALOG ── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Client Profile</DialogTitle></DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              This will permanently delete <span className="font-semibold text-foreground">{client.name}</span>'s profile.
              This action cannot be undone.
            </p>
            <p className="text-xs text-muted-foreground bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              Clients with active bookings cannot be deleted. Cancel all their bookings first.
            </p>
            {deleteError && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-lg p-3">{deleteError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Yes, Delete Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
