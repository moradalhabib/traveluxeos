import { useState, useRef, useCallback } from "react";
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
  CheckCircle2, XCircle, AlertTriangle, Loader2, Database, RefreshCw, Car, Plug, Copy, Check
} from "lucide-react";
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
    { method: "GET", path: "/bookings", desc: "List all bookings with client + driver joins" },
    { method: "POST", path: "/bookings", desc: "Create a new booking" },
    { method: "GET", path: "/bookings?status=eq.Confirmed", desc: "Filter bookings by status" },
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
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Admin Panel</h1>
        {isSuperAdmin && (
          <Badge variant="outline" className="border-primary/30 text-primary text-xs">Super Admin</Badge>
        )}
      </div>

      <Tabs defaultValue="import" className="w-full">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="import" className="text-xs px-1">
            <Upload className="w-3 h-3 mr-1 hidden sm:block" />Import
          </TabsTrigger>
          <TabsTrigger value="export" className="text-xs px-1">
            <Download className="w-3 h-3 mr-1 hidden sm:block" />Export
          </TabsTrigger>
          <TabsTrigger value="fleet" className="text-xs px-1">
            <Car className="w-3 h-3 mr-1 hidden sm:block" />Fleet
          </TabsTrigger>
          <TabsTrigger value="users" className="text-xs px-1">
            <Users className="w-3 h-3 mr-1 hidden sm:block" />Users
          </TabsTrigger>
          <TabsTrigger value="audit" className="text-xs px-1">
            <ShieldCheck className="w-3 h-3 mr-1 hidden sm:block" />Audit
          </TabsTrigger>
          <TabsTrigger value="api" className="text-xs px-1">
            <Plug className="w-3 h-3 mr-1 hidden sm:block" />API
          </TabsTrigger>
        </TabsList>

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
