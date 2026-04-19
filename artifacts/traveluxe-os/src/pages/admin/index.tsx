import { useState, useRef, useCallback, useEffect } from "react";
import { useListUsers, getListUsersQueryKey, useListAuditLog, getListAuditLogQueryKey, useListDrivers, getListDriversQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import {
  Upload, Download, FileText, Users, ShieldCheck,
  CheckCircle2, XCircle, AlertTriangle, Loader2, Database, RefreshCw, Car, Plug, Copy, Check,
  Plus, Pencil, Trash2, GripVertical, ChevronDown, ChevronUp, LayoutDashboard
} from "lucide-react";
import { Link } from "wouter";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

// ─── CSV utilities ────────────────────────────────────────────────────────────
function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(current.trim().replace(/^"|"$/g, '')); current = ''; }
    else { current += ch; }
  }
  result.push(current.trim().replace(/^"|"$/g, ''));
  return result;
}

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCSVRow(lines[0]);
  const rows = lines.slice(1).map(line => {
    const values = parseCSVRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (values[i] || '').trim(); });
    return row;
  }).filter(row => Object.values(row).some(v => v));
  return { headers, rows };
}

function buildCSV(headers: string[], rows: any[][]): string {
  const escape = (v: any) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Auto-detect Odoo/common column patterns ─────────────────────────────────
const FIELD_PATTERNS: Record<string, RegExp[]> = {
  name:    [/^name$/i, /^full.?name$/i, /^contact.?name$/i, /^client.?name$/i, /^customer$/i],
  whatsapp:[/^mobile$/i, /^whatsapp$/i, /^mobile.?phone$/i, /^cell$/i, /^phone$/i],
  email:   [/^email$/i, /^email.?address$/i, /^e-mail$/i],
  nationality: [/^country$/i, /^nationality$/i, /^country.?name$/i, /^nation$/i],
  vip_tier: [/^vip/i, /^tier$/i, /^category$/i, /^type$/i],
};

function autoMap(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const [field, patterns] of Object.entries(FIELD_PATTERNS)) {
    for (const header of headers) {
      if (patterns.some(p => p.test(header.trim()))) {
        if (!mapping[field]) mapping[field] = header;
      }
    }
  }
  return mapping;
}

// ─── Import tab ──────────────────────────────────────────────────────────────
function ImportTab() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const data = parseCSV(text);
      setParsed(data);
      setMapping(autoMap(data.headers));
      setResults(null);
    };
    reader.readAsText(file);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  const runImport = async () => {
    if (!parsed || !mapping.name || !mapping.whatsapp) return;
    setImporting(true);
    const errors: string[] = [];
    let imported = 0, skipped = 0;

    const batch: any[] = [];
    for (const row of parsed.rows) {
      const name = row[mapping.name]?.trim();
      const whatsapp = row[mapping.whatsapp]?.replace(/\s/g, '').trim();
      if (!name || !whatsapp) { skipped++; continue; }
      batch.push({
        name,
        whatsapp,
        email: mapping.email ? row[mapping.email]?.trim() || null : null,
        nationality: mapping.nationality ? row[mapping.nationality]?.trim() || null : null,
        vip_tier: (() => {
          if (!mapping.vip_tier) return 'Standard';
          const raw = row[mapping.vip_tier]?.trim().toUpperCase();
          if (raw === 'VVIP') return 'VVIP';
          if (raw === 'VIP') return 'VIP';
          return 'Standard';
        })(),
        inactive: false,
      });
    }

    // Insert in chunks of 50
    for (let i = 0; i < batch.length; i += 50) {
      const chunk = batch.slice(i, i + 50);
      const { error } = await supabase
        .from('clients')
        .upsert(chunk, { onConflict: 'whatsapp', ignoreDuplicates: true });
      if (error) {
        errors.push(`Batch ${Math.floor(i / 50) + 1}: ${error.message}`);
      } else {
        imported += chunk.length;
      }
    }

    setResults({ imported, skipped, errors });
    setImporting(false);
    toast({ title: `Import complete — ${imported} clients imported` });
  };

  const NONE = '__none__';

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-semibold text-foreground mb-1">Import Clients from CSV</h2>
        <p className="text-sm text-muted-foreground">
          Works with Odoo exports, Excel exports, and any CSV file. From Odoo: Contacts → Export → select fields → Download CSV.
        </p>
      </div>

      {/* Drop zone */}
      {!parsed && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${dragOver ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50 hover:bg-secondary/20'}`}
        >
          <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
          <p className="font-semibold text-foreground">Drop CSV file here</p>
          <p className="text-sm text-muted-foreground mt-1">or tap to browse</p>
          <p className="text-xs text-muted-foreground mt-3">Supported: Odoo export, Excel CSV, Google Sheets export</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </div>
      )}

      {/* Mapping */}
      {parsed && !results && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-foreground">{parsed.rows.length} rows detected</p>
              <p className="text-xs text-muted-foreground">{parsed.headers.length} columns · Map your columns below</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => { setParsed(null); setMapping({}); }}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Change file
            </Button>
          </div>

          {/* Column mapping */}
          <Card className="border-primary/20">
            <CardHeader className="pb-3"><CardTitle className="text-sm">Column Mapping</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {[
                { field: 'name', label: 'Client Name *', required: true },
                { field: 'whatsapp', label: 'WhatsApp / Mobile *', required: true },
                { field: 'email', label: 'Email', required: false },
                { field: 'nationality', label: 'Nationality / Country', required: false },
                { field: 'vip_tier', label: 'VIP Tier (VIP/VVIP)', required: false },
              ].map(({ field, label, required }) => (
                <div key={field} className="flex items-center gap-3">
                  <div className="w-40 text-sm font-medium text-foreground flex-shrink-0">
                    {label}
                    {required && <span className="text-destructive ml-1">*</span>}
                  </div>
                  <Select value={mapping[field] || NONE} onValueChange={(v) => setMapping(m => ({ ...m, [field]: v === NONE ? '' : v }))}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— Not mapped —</SelectItem>
                      {parsed.headers.map(h => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {mapping[field] && mapping[field] !== NONE ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                  ) : required ? (
                    <XCircle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Preview */}
          <Card className="border-border">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Preview (first 5 rows)</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {['Name', 'WhatsApp', 'Email', 'Nationality'].map(h => (
                      <th key={h} className="text-left py-2 pr-4 text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-2 pr-4 font-medium">{mapping.name ? row[mapping.name] : '—'}</td>
                      <td className="py-2 pr-4">{mapping.whatsapp ? row[mapping.whatsapp] : '—'}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{mapping.email ? row[mapping.email] : '—'}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{mapping.nationality ? row[mapping.nationality] : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {(!mapping.name || !mapping.whatsapp) && (
            <div className="flex items-center gap-2 text-amber-500 text-sm">
              <AlertTriangle className="w-4 h-4" />
              Map "Client Name" and "WhatsApp / Mobile" before importing
            </div>
          )}

          <Button
            className="w-full h-12 font-semibold"
            onClick={runImport}
            disabled={importing || !mapping.name || !mapping.whatsapp}
          >
            {importing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
            {importing ? `Importing ${parsed.rows.length} clients...` : `Import ${parsed.rows.length} Clients`}
          </Button>
        </div>
      )}

      {/* Results */}
      {results && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-center">
              <div className="text-3xl font-bold text-green-400">{results.imported}</div>
              <div className="text-sm text-muted-foreground mt-1">Clients Imported</div>
            </div>
            <div className="rounded-xl border border-border bg-muted/20 p-4 text-center">
              <div className="text-3xl font-bold text-foreground">{results.skipped}</div>
              <div className="text-sm text-muted-foreground mt-1">Skipped (no name/number)</div>
            </div>
          </div>
          {results.errors.length > 0 && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
              <p className="font-semibold text-destructive text-sm mb-2">Errors during import:</p>
              {results.errors.map((e, i) => <p key={i} className="text-xs text-destructive">{e}</p>)}
            </div>
          )}
          <Button variant="outline" className="w-full" onClick={() => { setParsed(null); setMapping({}); setResults(null); }}>
            Import Another File
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Export tab ───────────────────────────────────────────────────────────────
function ExportTab() {
  const { toast } = useToast();
  const [loading, setLoading] = useState<string | null>(null);

  const exportClients = async () => {
    setLoading('clients');
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, whatsapp, email, nationality, language_preference, vip_tier, notes, inactive, created_at')
      .order('name');
    if (error || !data) { toast({ title: 'Export failed', variant: 'destructive' }); setLoading(null); return; }
    const csv = buildCSV(
      ['ID', 'Name', 'WhatsApp', 'Email', 'Nationality', 'Language', 'VIP Tier', 'Notes', 'Inactive', 'Created At'],
      data.map(c => [c.id, c.name, c.whatsapp, c.email || '', c.nationality || '', c.language_preference || '', c.vip_tier, c.notes || '', c.inactive ? 'Yes' : 'No', c.created_at])
    );
    downloadFile(csv, `traveluxe-clients-${format(new Date(), 'yyyy-MM-dd')}.csv`, 'text/csv');
    toast({ title: `${data.length} clients exported` });
    setLoading(null);
  };

  const exportBookings = async () => {
    setLoading('bookings');
    const { data, error } = await supabase
      .from('bookings')
      .select('tvl_ref, service_type, status, date_time, pickup, dropoff, destination, flight_number, direction, nameboard, passengers, luggage, vehicle_type, price, tvl_commission, driver_receives, payment_status, payment_method, source, notes, created_at, clients(name, vip_tier), drivers(name)')
      .order('date_time', { ascending: false });
    if (error || !data) { toast({ title: 'Export failed', variant: 'destructive' }); setLoading(null); return; }
    const csv = buildCSV(
      ['Ref', 'Client', 'VIP Tier', 'Service', 'Status', 'Date/Time', 'Pickup', 'Dropoff/Dest', 'Flight', 'Direction', 'Nameboard', 'Pax', 'Luggage', 'Vehicle', 'Price (£)', 'Commission (£)', 'Driver Gets (£)', 'Payment', 'Method', 'Driver', 'Source', 'Notes', 'Created'],
      data.map((b: any) => [
        b.tvl_ref, b.clients?.name || '', b.clients?.vip_tier || '',
        b.service_type, b.status,
        b.date_time ? format(new Date(b.date_time), 'dd/MM/yyyy HH:mm') : '',
        b.pickup || '', b.dropoff || b.destination || '',
        b.flight_number || '', b.direction || '', b.nameboard || '',
        b.passengers || '', b.luggage || '', b.vehicle_type || '',
        b.price || 0, b.tvl_commission || 0, b.driver_receives || 0,
        b.payment_status || '', b.payment_method || '',
        b.drivers?.name || '',
        b.source || '', b.notes || '',
        b.created_at ? format(new Date(b.created_at), 'dd/MM/yyyy') : ''
      ])
    );
    downloadFile(csv, `traveluxe-bookings-${format(new Date(), 'yyyy-MM-dd')}.csv`, 'text/csv');
    toast({ title: `${data.length} bookings exported` });
    setLoading(null);
  };

  const exportDrivers = async () => {
    setLoading('drivers');
    const { data, error } = await supabase
      .from('drivers')
      .select('id, name, whatsapp, email, vehicle_type, vehicle_reg, license_number, active, rating, total_jobs, created_at')
      .order('name');
    if (error || !data) { toast({ title: 'Export failed', variant: 'destructive' }); setLoading(null); return; }
    const csv = buildCSV(
      ['ID', 'Name', 'WhatsApp', 'Email', 'Vehicle Type', 'Vehicle Reg', 'Licence', 'Active', 'Rating', 'Total Jobs', 'Created'],
      data.map(d => [d.id, d.name, d.whatsapp || '', d.email || '', d.vehicle_type || '', d.vehicle_reg || '', d.license_number || '', d.active ? 'Yes' : 'No', d.rating || '', d.total_jobs || 0, d.created_at])
    );
    downloadFile(csv, `traveluxe-drivers-${format(new Date(), 'yyyy-MM-dd')}.csv`, 'text/csv');
    toast({ title: `${data.length} drivers exported` });
    setLoading(null);
  };

  const exportFullBackup = async () => {
    setLoading('backup');
    const [clients, bookings, drivers, commissions] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('bookings').select('*').order('date_time', { ascending: false }),
      supabase.from('drivers').select('*').order('name'),
      supabase.from('commissions').select('*').order('created_at', { ascending: false }),
    ]);
    const backup = {
      exported_at: new Date().toISOString(),
      version: '1.0',
      data: {
        clients: clients.data || [],
        bookings: bookings.data || [],
        drivers: drivers.data || [],
        commissions: commissions.data || [],
      },
    };
    downloadFile(JSON.stringify(backup, null, 2), `traveluxe-backup-${format(new Date(), 'yyyy-MM-dd')}.json`, 'application/json');
    toast({ title: 'Full backup downloaded' });
    setLoading(null);
  };

  const exportOptions = [
    {
      id: 'clients',
      icon: Users,
      title: 'Export Clients',
      description: 'All client records — name, WhatsApp, email, nationality, VIP tier',
      format: 'CSV',
      action: exportClients,
    },
    {
      id: 'bookings',
      icon: FileText,
      title: 'Export Bookings',
      description: 'Full booking history — dates, routes, financials, driver, status',
      format: 'CSV',
      action: exportBookings,
    },
    {
      id: 'drivers',
      icon: ShieldCheck,
      title: 'Export Drivers',
      description: 'Driver roster — contact, vehicle, ratings, job count',
      format: 'CSV',
      action: exportDrivers,
    },
    {
      id: 'backup',
      icon: Database,
      title: 'Full Backup',
      description: 'Everything — clients, bookings, drivers, commissions in one file',
      format: 'JSON',
      action: exportFullBackup,
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-semibold text-foreground mb-1">Export &amp; Backup</h2>
        <p className="text-sm text-muted-foreground">Download your data at any time. CSV files open in Excel and Google Sheets.</p>
      </div>

      <div className="space-y-3">
        {exportOptions.map(({ id, icon: Icon, title, description, format: fmt, action }) => (
          <div key={id} className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:border-primary/30 transition-all">
            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Icon className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-foreground text-sm">{title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Badge variant="outline" className="text-[10px]">{fmt}</Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={action}
                disabled={loading === id}
                className="border-primary/30 hover:bg-primary/10 hover:text-primary"
              >
                {loading === id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Privacy note</p>
        <p>Exports include operational data only. Driver and client phone numbers are included so you can restore this data if needed. Store backup files securely.</p>
      </div>
    </div>
  );
}

// ─── Users tab ────────────────────────────────────────────────────────────────
function UsersTab({ currentUserId }: { currentUserId?: string }) {
  const { toast } = useToast();
  const { data: users, isLoading, refetch } = useListUsers(
    { query: { enabled: true, queryKey: getListUsersQueryKey() } }
  );
  const [toggling, setToggling] = useState<string | null>(null);

  const toggleActive = async (userId: string, currentActive: boolean) => {
    if (userId === currentUserId) {
      toast({ title: "You cannot deactivate your own account", variant: "destructive" });
      return;
    }
    setToggling(userId);
    const { error } = await supabase
      .from("users")
      .update({ active: !currentActive })
      .eq("id", userId);
    if (error) {
      toast({ title: "Failed to update user", variant: "destructive" });
    } else {
      toast({ title: currentActive ? "Account suspended" : "Account reactivated" });
      refetch();
    }
    setToggling(null);
  };

  const roleColor = (role: string) => {
    if (role === "super_admin") return "border-amber-500 text-amber-500";
    if (role === "admin") return "border-primary text-primary";
    return "border-border text-muted-foreground";
  };

  const roleLabel = (role: string) => {
    if (role === "super_admin") return "Super Admin";
    if (role === "admin") return "Admin";
    return "Operator";
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-semibold text-foreground mb-1">Access Control</h2>
        <p className="text-sm text-muted-foreground">
          Activate or suspend operator accounts instantly. Suspended users are blocked at the database level — they cannot access any data even with a valid session.
        </p>
      </div>

      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2 text-sm">
        <p className="font-semibold text-foreground">How to add a new member</p>
        <ol className="text-muted-foreground space-y-1 list-decimal list-inside text-xs">
          <li>Go to your <strong className="text-foreground">Supabase Dashboard</strong> → Authentication → Users</li>
          <li>Click <strong className="text-foreground">Invite User</strong> and enter their email</li>
          <li>They receive an invite link to set their password</li>
          <li>Their account appears here — set their role via SQL if needed</li>
          <li>Activate their account using the toggle below</li>
        </ol>
        <p className="text-xs text-muted-foreground mt-2">
          To set a role: <code className="bg-secondary px-1 rounded text-foreground">UPDATE public.users SET role = 'admin' WHERE email = '...';</code>
        </p>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          [...Array(3)].map((_, i) => <Skeleton key={i} className="h-20" />)
        ) : !users?.length ? (
          <div className="text-center py-8 text-muted-foreground border border-dashed rounded-xl text-sm">No users found</div>
        ) : (
          users.map((u) => {
            const isCurrentUser = u.id === currentUserId;
            return (
              <div
                key={u.id}
                className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
                  !u.active ? "border-destructive/30 bg-destructive/5" : "border-border bg-card"
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-foreground font-bold uppercase flex-shrink-0">
                  {u.name?.charAt(0) || "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-foreground">{u.name}</span>
                    {isCurrentUser && <span className="text-[10px] text-muted-foreground">(you)</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className={`${roleColor(u.role)} text-[10px]`}>
                      {roleLabel(u.role)}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={u.active ? "text-green-500 border-green-500/30 text-[10px]" : "text-destructive border-destructive/30 text-[10px]"}
                    >
                      {u.active ? "Active" : "Suspended"}
                    </Badge>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={u.active ? "destructive" : "outline"}
                  disabled={isCurrentUser || toggling === u.id}
                  onClick={() => toggleActive(u.id, u.active ?? true)}
                  className={`text-xs flex-shrink-0 ${!u.active ? "border-green-500/30 text-green-500 hover:bg-green-500/10" : ""}`}
                >
                  {toggling === u.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : u.active ? "Suspend" : "Activate"}
                </Button>
              </div>
            );
          })
        )}
      </div>

      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-xs text-muted-foreground space-y-1">
        <p className="font-semibold text-destructive">Security Note</p>
        <p>Suspending an account takes effect immediately. The user is blocked at the database level — their existing session cannot access any data. They are also automatically signed out within 5 minutes.</p>
      </div>
    </div>
  );
}

// ─── Fleet tab ────────────────────────────────────────────────────────────────
function FleetTab() {
  const { data: drivers, isLoading } = useListDrivers(
    {},
    { query: { enabled: true, queryKey: getListDriversQueryKey({}) } }
  );

  const byClass: Record<string, any[]> = {};
  drivers?.forEach((d: any) => {
    const cls = d.vehicle_type || "Other";
    if (!byClass[cls]) byClass[cls] = [];
    byClass[cls].push(d);
  });

  const total = drivers?.length || 0;
  const active = drivers?.filter((d: any) => d.status === "Active").length || 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-semibold text-foreground mb-1">Fleet Overview</h2>
        <p className="text-sm text-muted-foreground">All vehicles assigned to drivers. Edit a driver's profile to update their vehicle.</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <div className="text-2xl font-bold text-primary">{total}</div>
          <div className="text-xs text-muted-foreground mt-1">Total Vehicles</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <div className="text-2xl font-bold text-green-500">{active}</div>
          <div className="text-xs text-muted-foreground mt-1">Active</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <div className="text-2xl font-bold text-foreground">{total - active}</div>
          <div className="text-xs text-muted-foreground mt-1">Inactive</div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : Object.keys(byClass).length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border border-dashed rounded-xl">
          <Car className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No vehicles in fleet yet.</p>
          <p className="text-xs mt-1">Add drivers to build the fleet.</p>
        </div>
      ) : (
        Object.entries(byClass).map(([cls, group]) => (
          <div key={cls}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{cls}</span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">{group.length}</span>
            </div>
            <div className="space-y-2">
              {group.map((d: any) => (
                <div key={d.id} className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Car className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-foreground">{d.vehicle_model || d.vehicle_type || "—"}</p>
                    <p className="text-xs text-muted-foreground">{d.name}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {d.plate && <p className="font-mono text-sm text-foreground uppercase">{d.plate}</p>}
                    <Badge
                      variant="outline"
                      className={d.status === "Active" ? "text-green-500 border-green-500/30 text-[10px]" : "text-muted-foreground text-[10px]"}
                    >
                      {d.status || "Active"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground mb-1">How to update vehicles</p>
        <p>Go to <strong>Drivers</strong> and open a driver's profile. Edit their <em>Vehicle Make &amp; Model</em> field — changes reflect here instantly and appear on all job sheets.</p>
      </div>
    </div>
  );
}

// ─── Integration Hub tab ──────────────────────────────────────────────────────
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} className="ml-2 p-1 rounded text-muted-foreground hover:text-primary transition-colors">
      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function IntegrationTab() {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
  const apiBase = `${supabaseUrl}/rest/v1`;
  const realtimeUrl = `${supabaseUrl}/realtime/v1`;

  const endpoints = [
    { method: "GET", path: "/clients", desc: "List all clients (name, WhatsApp, VIP tier, nationality)" },
    { method: "POST", path: "/clients", desc: "Create a new client" },
    { method: "GET", path: "/clients?id=eq.{id}", desc: "Get client by ID" },
    { method: "PATCH", path: "/clients?id=eq.{id}", desc: "Update client record" },
    { method: "GET", path: "/bookings", desc: "List all bookings (transfers, tours, apartments) with client + driver joins" },
    { method: "POST", path: "/bookings", desc: "Create a booking — service_type: Airport Transfer | Tour | City Tour | Chauffeur Tour | Apartment / Accommodation | As Directed | Event Transfer" },
    { method: "GET", path: "/bookings?status=eq.Confirmed", desc: "Filter bookings by status" },
    { method: "GET", path: "/bookings?service_type=eq.Tour", desc: "Filter by service type (e.g. Tour, City Tour, Apartment / Accommodation)" },
    { method: "GET", path: "/quotes", desc: "List all quotes" },
    { method: "POST", path: "/quotes", desc: "Create a quote" },
    { method: "GET", path: "/drivers", desc: "List all drivers and their vehicles" },
    { method: "GET", path: "/commissions", desc: "Commission ledger" },
  ];

  const methodColor = (m: string) => {
    if (m === "GET") return "text-blue-400 bg-blue-500/10";
    if (m === "POST") return "text-green-400 bg-green-500/10";
    if (m === "PATCH") return "text-amber-400 bg-amber-500/10";
    if (m === "DELETE") return "text-red-400 bg-red-500/10";
    return "text-muted-foreground bg-secondary";
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold text-foreground mb-1">CRM Integration</h2>
        <p className="text-sm text-muted-foreground">
          Share this page with your development team. Everything they need to connect your CRM to Traveluxe OS is below.
        </p>
      </div>

      {/* Architecture overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: "Database", value: "Supabase (PostgreSQL)", icon: Database },
          { label: "API Standard", value: "REST + JSON", icon: FileText },
          { label: "Realtime", value: "WebSocket (Supabase)", icon: Plug },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Icon className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="font-semibold text-sm text-foreground">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Base URL */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Base API URL</p>
        <div className="flex items-center gap-2 bg-background rounded-lg px-3 py-2 border border-border">
          <code className="text-xs text-primary flex-1 break-all">{apiBase}</code>
          <CopyButton value={apiBase} />
        </div>
        <div className="flex items-center gap-2 bg-background rounded-lg px-3 py-2 border border-border">
          <div className="flex-1">
            <p className="text-[10px] text-muted-foreground mb-0.5">Realtime WebSocket</p>
            <code className="text-xs text-foreground break-all">{realtimeUrl}</code>
          </div>
          <CopyButton value={realtimeUrl} />
        </div>
      </div>

      {/* Authentication */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
        <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Authentication</p>
        <p className="text-xs text-muted-foreground">All requests require two headers:</p>
        <div className="space-y-2">
          {[
            { header: "apikey", value: "YOUR_SUPABASE_ANON_KEY", desc: "Public anon key from Supabase → Settings → API" },
            { header: "Authorization", value: "Bearer {user_access_token}", desc: "JWT from supabase.auth.signInWithPassword() — Row Level Security enforced" },
            { header: "Content-Type", value: "application/json", desc: "For POST/PATCH requests" },
            { header: "Prefer", value: "return=representation", desc: "Returns the created/updated record in response" },
          ].map(({ header, value, desc }) => (
            <div key={header} className="bg-background rounded-lg p-3 border border-border">
              <div className="flex items-center gap-2 mb-1">
                <code className="text-xs text-primary">{header}:</code>
                <code className="text-xs text-foreground">{value}</code>
              </div>
              <p className="text-[10px] text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Endpoints */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Available Endpoints</p>
        {endpoints.map(({ method, path, desc }) => (
          <div key={`${method}${path}`} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded font-mono flex-shrink-0 ${methodColor(method)}`}>
              {method}
            </span>
            <div className="flex-1 min-w-0">
              <code className="text-xs text-foreground">{path}</code>
              <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>
            </div>
            <CopyButton value={`${apiBase}${path}`} />
          </div>
        ))}
      </div>

      {/* Realtime example */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <p className="text-xs font-semibold text-foreground">Realtime Sync (for live CRM updates)</p>
        <p className="text-xs text-muted-foreground">Subscribe to any table change using the Supabase client. Your CRM will receive instant updates when a booking is created, a client is added, or status changes.</p>
        <div className="bg-background rounded-lg p-3 border border-border overflow-x-auto">
          <pre className="text-[10px] text-green-400 whitespace-pre">{`supabase
  .channel('crm-sync')
  .on('postgres_changes', {
    event: '*',          // INSERT | UPDATE | DELETE | *
    schema: 'public',
    table: 'bookings',   // or 'clients', 'quotes', etc.
  }, (payload) => {
    console.log('Change received:', payload)
  })
  .subscribe()`}</pre>
        </div>
      </div>

      {/* Filtering & sorting */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <p className="text-xs font-semibold text-foreground">Query Examples</p>
        <div className="space-y-2">
          {[
            { label: "Filter by status", ex: `${apiBase}/bookings?status=eq.Confirmed` },
            { label: "Get VIP clients only", ex: `${apiBase}/clients?vip_tier=eq.VVIP` },
            { label: "Sort + limit bookings", ex: `${apiBase}/bookings?order=date_time.desc&limit=50` },
            { label: "Search by WhatsApp", ex: `${apiBase}/clients?whatsapp=eq.+447700000000` },
            { label: "Join client on booking", ex: `${apiBase}/bookings?select=*,clients(name,vip_tier)` },
          ].map(({ label, ex }) => (
            <div key={label} className="bg-background rounded-lg p-3 border border-border">
              <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
              <div className="flex items-center gap-2">
                <code className="text-[10px] text-primary flex-1 break-all">{ex}</code>
                <CopyButton value={ex} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground space-y-1">
        <p className="font-semibold text-foreground">For your developers</p>
        <p>Use the official <strong className="text-foreground">Supabase JavaScript client</strong> (<code>@supabase/supabase-js</code>) or any HTTP client. All data access is protected by Row Level Security — your CRM must authenticate as an active Traveluxe OS operator to read or write data.</p>
        <p className="mt-2">Recommended integration pattern: create a dedicated <strong className="text-foreground">service account</strong> in Traveluxe OS (operator role) for your CRM. This keeps CRM traffic audited separately from human operators.</p>
      </div>
    </div>
  );
}

// ─── Products Management tab ──────────────────────────────────────────────────
const PRODUCT_CATEGORIES = ["Vehicle", "Meet & Greet", "Tour", "Add-on", "Accommodation"];
const ALL_SERVICE_TYPES = ["Airport Transfer", "As Directed", "Tour", "Hotel", "Apartment"];
const CATEGORY_DEFAULT_SERVICE_TYPES: Record<string, string[]> = {
  "Vehicle":       ["Airport Transfer", "As Directed", "Tour"],
  "Meet & Greet":  ["Airport Transfer"],
  "Tour":          ["Tour"],
  "Add-on":        ["Airport Transfer", "As Directed", "Tour", "Hotel", "Apartment"],
  "Accommodation": ["Apartment"],
};
const CATEGORY_ICONS: Record<string, string> = {
  "Vehicle": "🚘", "Meet & Greet": "✨", "Tour": "🗺", "Add-on": "➕", "Accommodation": "🏠",
};

function ProductsTab({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { toast } = useToast();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("Vehicle");
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchProducts = async () => {
    setLoading(true);
    const { data } = await supabase.from("products").select("*").order("category").order("sort_order");
    setProducts(data ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchProducts(); }, []);

  const filtered = products.filter(p => p.category === activeCategory);
  const categories = PRODUCT_CATEGORIES.filter(c => products.some(p => p.category === c));

  const startNew = () => setEditing({
    id: null, name: "", category: activeCategory, description: "", unit_price: 0, active: true,
    sort_order: filtered.length * 10 + 10,
    service_types: CATEGORY_DEFAULT_SERVICE_TYPES[activeCategory] ?? ALL_SERVICE_TYPES,
  });
  
  const toggleServiceType = (svc: string) => {
    const current: string[] = editing?.service_types ?? [];
    const next = current.includes(svc) ? current.filter((s: string) => s !== svc) : [...current, svc];
    setEditing((v: any) => ({ ...v, service_types: next }));
  };

  const startEdit = (p: any) => setEditing({
    ...p,
    service_types: p.service_types ?? CATEGORY_DEFAULT_SERVICE_TYPES[p.category] ?? ALL_SERVICE_TYPES,
  });

  const saveProduct = async () => {
    if (!editing?.name) return;
    setSaving(true);
    const payload: any = {
      name: editing.name,
      category: editing.category,
      description: editing.description || null,
      unit_price: editing.unit_price ?? 0,
      active: editing.active ?? true,
      sort_order: editing.sort_order ?? 0,
      updated_at: new Date().toISOString(),
    };
    // Only include service_types if the column exists (graceful — won't fail if column missing)
    if (editing.service_types !== undefined) {
      payload.service_types = editing.service_types;
    }
    let error;
    if (editing.id) {
      ({ error } = await supabase.from("products").update(payload).eq("id", editing.id));
    } else {
      ({ error } = await supabase.from("products").insert(payload));
    }
    if (error) {
      toast({ title: "Failed: " + error.message, variant: "destructive" });
    } else {
      toast({ title: editing.id ? "Product updated" : "Product added" });
      setEditing(null);
      fetchProducts();
    }
    setSaving(false);
  };

  const deleteProduct = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    await supabase.from("products").delete().eq("id", id);
    toast({ title: `${name} removed` });
    fetchProducts();
  };

  const toggleActive = async (p: any) => {
    await supabase.from("products").update({ active: !p.active }).eq("id", p.id);
    fetchProducts();
  };

  if (loading) return <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>;

  if (editing) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setEditing(null)} className="-ml-2">← Back</Button>
          <h2 className="font-semibold">{editing.id ? "Edit Product" : "New Product"}</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Name *</label>
            <input className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary"
              value={editing.name} onChange={e => setEditing((v: any) => ({ ...v, name: e.target.value }))} placeholder="e.g. Mercedes Benz E Class" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Category</label>
            <Select value={editing.category} onValueChange={v => setEditing((e: any) => ({ ...e, category: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRODUCT_CATEGORIES.map(c => <SelectItem key={c} value={c}>{CATEGORY_ICONS[c]} {c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Description</label>
            <textarea className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary resize-none"
              rows={3} value={editing.description ?? ""} onChange={e => setEditing((v: any) => ({ ...v, description: e.target.value }))} placeholder="Description visible to operators" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Unit Price (£) <span className="text-muted-foreground/60">(use 0 for "Included" items)</span></label>
            <input type="number" step="0.01" className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary"
              value={editing.unit_price} onChange={e => setEditing((v: any) => ({ ...v, unit_price: Number(e.target.value) }))} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Available for Service Types</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {ALL_SERVICE_TYPES.map(svc => {
                const active = (editing.service_types ?? CATEGORY_DEFAULT_SERVICE_TYPES[editing.category] ?? ALL_SERVICE_TYPES).includes(svc);
                return (
                  <button
                    key={svc}
                    type="button"
                    onClick={() => toggleServiceType(svc)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {svc}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Run migration-service-types.sql in Supabase to enable filtering</p>
          </div>
          <div className="flex items-center gap-3 pt-2 border-t border-border">
            <label className="text-sm text-foreground flex-1">Active</label>
            <button onClick={() => setEditing((v: any) => ({ ...v, active: !v.active }))}
              className={`relative w-11 h-6 rounded-full transition-colors ${editing.active ? 'bg-primary' : 'bg-border'}`}>
              <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all" style={{ left: editing.active ? '22px' : '2px' }} />
            </button>
          </div>
        </div>
        <Button className="w-full h-12 font-semibold" onClick={saveProduct} disabled={saving || !editing.name}>
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
          {saving ? "Saving..." : "Save Product"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-foreground">Products Catalogue</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Vehicles, Meet &amp; Greet tiers, tours and add-ons — selectable during booking creation.
            {!isSuperAdmin && " Admins can view and add. Only Super Admin can delete."}
          </p>
        </div>
        {(isSuperAdmin || true) && (
          <Button size="sm" onClick={startNew} className="text-xs h-8 flex-shrink-0">
            <Plus className="w-3 h-3 mr-1" /> Add
          </Button>
        )}
      </div>

      {products.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-border rounded-xl text-muted-foreground">
          <p className="text-sm">No products found. Run migration-products.sql in Supabase first.</p>
        </div>
      ) : (
        <>
          {/* Category filter */}
          <div className="flex overflow-x-auto gap-2 pb-1">
            {categories.map(cat => (
              <button key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all flex-shrink-0 border ${
                  activeCategory === cat ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {CATEGORY_ICONS[cat]} {cat} ({products.filter(p => p.category === cat).length})
              </button>
            ))}
          </div>

          {/* Product list */}
          <div className="space-y-2">
            {filtered.length === 0 && (
              <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border rounded-xl">
                No products in this category
              </div>
            )}
            {filtered.map(product => (
              <div key={product.id} className={`flex items-center gap-3 p-3 rounded-xl border ${product.active ? 'border-border bg-card' : 'border-border/40 bg-card opacity-50'}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-foreground">{product.name}</span>
                    {!product.active && <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>}
                  </div>
                  {product.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{product.description}</p>}
                  {product.service_types && product.service_types.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(product.service_types as string[]).map((s: string) => (
                        <span key={s} className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary/70 border border-primary/20">{s}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-bold text-primary">{product.unit_price > 0 ? `£${product.unit_price.toLocaleString()}` : 'Incl.'}</div>
                </div>
                {isSuperAdmin && (
                  <div className="flex gap-1 flex-shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(product)} className="h-7 w-7 p-0">
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => toggleActive(product)}
                      className={`h-7 w-7 p-0 ${product.active ? 'text-amber-500' : 'text-green-500'}`}>
                      {product.active ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteProduct(product.id, product.name)} className="h-7 w-7 p-0 text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Services Management tab (super_admin) ────────────────────────────────────
const DEFAULT_ADD_ON = { name: "", description: "", price: 0 };

const SERVICE_ICONS: Record<string, string> = {
  "Airport Transfer": "✈",
  "Chauffeuring": "🚘",
  "Tour": "🗺",
  "Apartments": "🏠",
  "Hotel Bookings": "🏨",
  "Open Space": "🌿",
  "Yacht Charter": "⛵",
};

function ServicesTab({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { toast } = useToast();
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [bookingStats, setBookingStats] = useState<Record<string, { count: number; total: number }>>({});

  const fetchServices = async () => {
    setLoading(true);
    const { data } = await supabase.from("service_types").select("*").order("sort_order");
    setServices(data ?? []);
    setLoading(false);
  };

  const fetchStats = async () => {
    const { data } = await supabase
      .from("bookings")
      .select("service_type, price")
      .neq("status", "Cancelled");
    if (!data) return;
    const stats: Record<string, { count: number; total: number }> = {};
    data.forEach(b => {
      const key = b.service_type || "Other";
      if (!stats[key]) stats[key] = { count: 0, total: 0 };
      stats[key].count++;
      stats[key].total += Number(b.price || 0);
    });
    setBookingStats(stats);
  };

  useEffect(() => { fetchServices(); fetchStats(); }, []);

  const startEdit = (svc: any) => {
    setEditing({
      ...svc,
      add_ons: (svc.add_ons ?? []).map((a: any) => ({ ...a })),
    });
  };

  const startNew = () => {
    setEditing({
      id: null,
      name: "",
      description: "",
      base_price_guidance: "",
      add_ons: [],
      active: true,
      sort_order: (services.length + 1) * 10,
    });
  };

  const saveService = async () => {
    if (!editing?.name) return;
    setSaving(true);
    const payload = {
      name: editing.name,
      description: editing.description || null,
      base_price_guidance: editing.base_price_guidance || null,
      add_ons: editing.add_ons ?? [],
      active: editing.active ?? true,
      sort_order: editing.sort_order ?? 0,
      updated_at: new Date().toISOString(),
    };
    let error;
    if (editing.id) {
      ({ error } = await supabase.from("service_types").update(payload).eq("id", editing.id));
    } else {
      ({ error } = await supabase.from("service_types").insert(payload));
    }
    if (error) {
      toast({ title: "Save failed: " + error.message, variant: "destructive" });
    } else {
      toast({ title: editing.id ? "Service updated" : "Service created" });
      setEditing(null);
      fetchServices();
    }
    setSaving(false);
  };

  const deleteService = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    const { error } = await supabase.from("service_types").delete().eq("id", id);
    if (error) {
      toast({ title: "Delete failed: " + error.message, variant: "destructive" });
    } else {
      toast({ title: `${name} deleted` });
      fetchServices();
    }
  };

  const toggleActive = async (svc: any) => {
    await supabase.from("service_types").update({ active: !svc.active }).eq("id", svc.id);
    fetchServices();
  };

  const updateAddOn = (idx: number, field: string, value: any) => {
    setEditing((e: any) => {
      const addOns = [...e.add_ons];
      addOns[idx] = { ...addOns[idx], [field]: value };
      return { ...e, add_ons: addOns };
    });
  };

  if (loading) return <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>;

  if (editing) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setEditing(null)} className="-ml-2">
            ← Back
          </Button>
          <h2 className="font-semibold text-foreground">{editing.id ? "Edit Service" : "New Service"}</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Service Name *</label>
            <input
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary"
              value={editing.name}
              onChange={e => setEditing((v: any) => ({ ...v, name: e.target.value }))}
              placeholder="e.g. Airport Transfer"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Description</label>
            <textarea
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary resize-none"
              rows={3}
              value={editing.description ?? ""}
              onChange={e => setEditing((v: any) => ({ ...v, description: e.target.value }))}
              placeholder="Short description for operators"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Pricing Guidance</label>
            <input
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary"
              value={editing.base_price_guidance ?? ""}
              onChange={e => setEditing((v: any) => ({ ...v, base_price_guidance: e.target.value }))}
              placeholder="e.g. From £95 based on vehicle class"
            />
          </div>

          {/* Add-ons */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-muted-foreground">Add-ons / Extras</label>
              <Button
                size="sm" variant="outline"
                className="text-xs h-7 border-primary/30 text-primary hover:bg-primary/10"
                onClick={() => setEditing((v: any) => ({ ...v, add_ons: [...v.add_ons, { ...DEFAULT_ADD_ON }] }))}
              >
                <Plus className="w-3 h-3 mr-1" /> Add Extra
              </Button>
            </div>
            <div className="space-y-3">
              {editing.add_ons.map((addon: any, idx: number) => (
                <div key={idx} className="p-3 rounded-xl border border-border bg-card space-y-2">
                  <div className="flex gap-2">
                    <input
                      className="flex-1 bg-background border border-border rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
                      placeholder="Extra name (e.g. Meet & Greet)"
                      value={addon.name}
                      onChange={e => updateAddOn(idx, "name", e.target.value)}
                    />
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground text-sm">£</span>
                      <input
                        type="number"
                        className="w-20 bg-background border border-border rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
                        placeholder="0"
                        value={addon.price}
                        onChange={e => updateAddOn(idx, "price", Number(e.target.value))}
                      />
                    </div>
                    <Button
                      size="sm" variant="ghost"
                      className="text-destructive hover:bg-destructive/10 h-8 w-8 p-0"
                      onClick={() => setEditing((v: any) => ({ ...v, add_ons: v.add_ons.filter((_: any, i: number) => i !== idx) }))}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <input
                    className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground focus:outline-none focus:border-primary"
                    placeholder="Short description (optional)"
                    value={addon.description ?? ""}
                    onChange={e => updateAddOn(idx, "description", e.target.value)}
                  />
                </div>
              ))}
              {editing.add_ons.length === 0 && (
                <div className="text-center py-4 text-xs text-muted-foreground border border-dashed border-border rounded-xl">
                  No add-ons yet. Tap "Add Extra" to add one.
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2 border-t border-border">
            <label className="text-sm text-foreground flex-1">Active (visible in booking form)</label>
            <button
              onClick={() => setEditing((v: any) => ({ ...v, active: !v.active }))}
              className={`relative w-11 h-6 rounded-full transition-colors ${editing.active ? 'bg-primary' : 'bg-border'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${editing.active ? 'left-5.5' : 'left-0.5'} translate-x-${editing.active ? '5' : '0'}`}
                style={{ left: editing.active ? '22px' : '2px' }}
              />
            </button>
          </div>
        </div>

        <Button className="w-full h-12 font-semibold" onClick={saveService} disabled={saving || !editing.name}>
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
          {saving ? "Saving..." : "Save Service"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-foreground">Service Catalogue</h2>
          {isSuperAdmin && (
            <Button size="sm" onClick={startNew} className="text-xs h-8">
              <Plus className="w-3 h-3 mr-1" /> Add Service
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          All services offered by Traveluxe. Click a service card to expand its add-ons and pricing guidance.
          {!isSuperAdmin && " Only Super Admins can edit."}
        </p>
      </div>

      {/* Odoo-style service stat cards */}
      {services.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {services.filter(s => s.active).map(svc => {
            const stats = bookingStats[svc.name] ?? { count: 0, total: 0 };
            const icon = SERVICE_ICONS[svc.name] || "📋";
            return (
              <button
                key={svc.id}
                onClick={() => setExpanded(expanded === svc.id ? null : svc.id)}
                className={`text-left p-4 rounded-2xl border transition-all ${
                  expanded === svc.id
                    ? "border-primary bg-primary/5 shadow-[0_0_14px_rgba(201,168,76,0.15)]"
                    : "border-border bg-card hover:border-primary/40 hover:bg-card/80"
                }`}
              >
                <div className="text-2xl mb-2">{icon}</div>
                <div className="font-semibold text-sm text-foreground leading-tight line-clamp-2">{svc.name}</div>
                {svc.base_price_guidance && (
                  <div className="text-[11px] text-primary mt-1 font-medium">{svc.base_price_guidance}</div>
                )}
                <div className="mt-3 pt-2 border-t border-border/60 space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Bookings</span>
                    <span className="text-sm font-bold text-foreground">{stats.count}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Revenue</span>
                    <span className="text-sm font-bold text-primary">
                      {stats.total > 0 ? `£${stats.total.toLocaleString()}` : "—"}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {services.length === 0 && (
        <div className="text-center py-10 border border-dashed border-border rounded-xl text-muted-foreground">
          <p className="text-sm">No services found. Run the migration to add default services.</p>
          <code className="text-xs mt-2 block">migration-service-types.sql</code>
        </div>
      )}

      <div className="space-y-3">
        {services.map(svc => (
          <div key={svc.id} className={`rounded-2xl border ${svc.active ? 'border-border' : 'border-border/40 opacity-60'} bg-card overflow-hidden`}>
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-left"
              onClick={() => setExpanded(expanded === svc.id ? null : svc.id)}
            >
              <div className="flex items-center gap-3">
                <div>
                  <div className="font-semibold text-sm text-foreground">{svc.name}</div>
                  {svc.base_price_guidance && (
                    <div className="text-xs text-primary mt-0.5">{svc.base_price_guidance}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={svc.active ? "text-green-500 border-green-500/30 text-[10px]" : "text-muted-foreground text-[10px]"}>
                  {svc.active ? "Active" : "Inactive"}
                </Badge>
                <Badge variant="outline" className="text-muted-foreground text-[10px]">
                  {(svc.add_ons ?? []).length} extras
                </Badge>
                {expanded === svc.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </div>
            </button>

            {expanded === svc.id && (
              <div className="px-4 pb-4 pt-0 space-y-4 border-t border-border">
                {svc.description && (
                  <p className="text-sm text-muted-foreground pt-3">{svc.description}</p>
                )}

                {/* Add-ons list */}
                {(svc.add_ons ?? []).length > 0 ? (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Add-ons & Extras</p>
                    <div className="space-y-2">
                      {(svc.add_ons ?? []).map((addon: any, i: number) => (
                        <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-background/50 border border-border">
                          <div>
                            <div className="text-sm font-medium text-foreground">{addon.name}</div>
                            {addon.description && <div className="text-xs text-muted-foreground">{addon.description}</div>}
                          </div>
                          <div className="text-sm font-semibold text-primary flex-shrink-0 ml-3">
                            {addon.price > 0 ? `+£${addon.price}` : "Included"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No add-ons configured for this service.</p>
                )}

                {isSuperAdmin && (
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" variant="outline" onClick={() => startEdit(svc)} className="flex-1 text-xs h-8">
                      <Pencil className="w-3 h-3 mr-1.5" /> Edit
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      onClick={() => toggleActive(svc)}
                      className={`flex-1 text-xs h-8 ${svc.active ? 'text-amber-500 border-amber-500/30 hover:bg-amber-500/10' : 'text-green-500 border-green-500/30 hover:bg-green-500/10'}`}
                    >
                      {svc.active ? "Deactivate" : "Activate"}
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      onClick={() => deleteService(svc.id, svc.name)}
                      className="text-xs h-8 text-destructive border-destructive/30 hover:bg-destructive/10"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Admin page ──────────────────────────────────────────────────────────
export default function Admin() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";

  const { data: users, isLoading: usersLoading } = useListUsers(
    { query: { enabled: true, queryKey: getListUsersQueryKey() } }
  );
  const { data: logs, isLoading: logsLoading } = useListAuditLog(
    {},
    { query: { enabled: true, queryKey: getListAuditLogQueryKey({}) } }
  );

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Admin Panel</h1>
          {isSuperAdmin && (
            <Badge variant="outline" className="border-amber-500/30 text-amber-500 text-xs mt-1">Super Admin</Badge>
          )}
        </div>
        <Link href="/">
          <Button variant="outline" size="sm" className="border-primary/30 text-primary hover:bg-primary/10">
            <LayoutDashboard className="w-4 h-4 mr-2" />
            Dashboard
          </Button>
        </Link>
      </div>

      <Tabs defaultValue="products" className="w-full">
        <div className="overflow-x-auto">
          <TabsList className="inline-flex w-auto min-w-full">
            <TabsTrigger value="products" className="text-xs px-3 whitespace-nowrap">Products</TabsTrigger>
            <TabsTrigger value="services" className="text-xs px-3 whitespace-nowrap">Services</TabsTrigger>
            <TabsTrigger value="import" className="text-xs px-3 whitespace-nowrap">Import</TabsTrigger>
            <TabsTrigger value="export" className="text-xs px-3 whitespace-nowrap">Export</TabsTrigger>
            <TabsTrigger value="fleet" className="text-xs px-3 whitespace-nowrap">Fleet</TabsTrigger>
            <TabsTrigger value="users" className="text-xs px-3 whitespace-nowrap">Users</TabsTrigger>
            <TabsTrigger value="audit" className="text-xs px-3 whitespace-nowrap">Audit</TabsTrigger>
            <TabsTrigger value="api" className="text-xs px-3 whitespace-nowrap">API</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="products" className="mt-5">
          <ProductsTab isSuperAdmin={isSuperAdmin} />
        </TabsContent>

        <TabsContent value="services" className="mt-5">
          <ServicesTab isSuperAdmin={isSuperAdmin} />
        </TabsContent>

        <TabsContent value="import" className="mt-5">
          <ImportTab />
        </TabsContent>

        <TabsContent value="export" className="mt-5">
          <ExportTab />
        </TabsContent>

        <TabsContent value="fleet" className="mt-5">
          <FleetTab />
        </TabsContent>

        <TabsContent value="users" className="mt-5">
          <UsersTab currentUserId={user?.id} />
        </TabsContent>

        <TabsContent value="audit" className="mt-5">
          <Card className="border-border">
            <CardHeader><CardTitle className="text-base">System Audit Trail</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {logsLoading ? (
                  [...Array(5)].map((_, i) => <Skeleton key={i} className="h-16" />)
                ) : logs?.map((log) => (
                  <div key={log.id} className="p-3 border border-border rounded-xl bg-background/50 text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{log.operator_name || "System"}</span>
                        <Badge variant="secondary" className="text-[10px]">{log.action}</Badge>
                        <span className="text-xs text-muted-foreground">{log.entity_type}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{format(new Date(log.created_at), "dd MMM · HH:mm")}</span>
                    </div>
                    {log.detail && <p className="text-xs text-muted-foreground mt-1">{log.detail}</p>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="api" className="mt-5">
          <IntegrationTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
