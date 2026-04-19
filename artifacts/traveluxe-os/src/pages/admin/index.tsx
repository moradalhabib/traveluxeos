import { useState, useRef, useCallback } from "react";
import { useListUsers, getListUsersQueryKey, useListAuditLog, getListAuditLogQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import {
  Upload, Download, FileText, Users, ShieldCheck,
  CheckCircle2, XCircle, AlertTriangle, Loader2, Database, RefreshCw
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

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

// ─── Main Admin page ──────────────────────────────────────────────────────────
export default function Admin() {
  const { data: users, isLoading: usersLoading } = useListUsers(
    { query: { enabled: true, queryKey: getListUsersQueryKey() } }
  );
  const { data: logs, isLoading: logsLoading } = useListAuditLog(
    {},
    { query: { enabled: true, queryKey: getListAuditLogQueryKey({}) } }
  );

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Admin Panel</h1>

      <Tabs defaultValue="import" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="import">
            <Upload className="w-3.5 h-3.5 mr-1.5 hidden sm:block" />Import
          </TabsTrigger>
          <TabsTrigger value="export">
            <Download className="w-3.5 h-3.5 mr-1.5 hidden sm:block" />Export
          </TabsTrigger>
          <TabsTrigger value="users">
            <Users className="w-3.5 h-3.5 mr-1.5 hidden sm:block" />Users
          </TabsTrigger>
          <TabsTrigger value="audit">
            <ShieldCheck className="w-3.5 h-3.5 mr-1.5 hidden sm:block" />Audit
          </TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="mt-5">
          <ImportTab />
        </TabsContent>

        <TabsContent value="export" className="mt-5">
          <ExportTab />
        </TabsContent>

        <TabsContent value="users" className="mt-5">
          <Card className="border-border">
            <CardHeader><CardTitle className="text-base">System Operators</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {usersLoading ? (
                  [...Array(3)].map((_, i) => <Skeleton key={i} className="h-16" />)
                ) : users?.map((user) => (
                  <div key={user.id} className="flex justify-between items-center p-3 border border-border rounded-xl bg-background/50">
                    <div>
                      <div className="font-semibold text-sm">{user.name}</div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={user.role === 'admin' ? 'border-primary text-primary' : ''}>{user.role}</Badge>
                      <Badge variant={user.active ? "outline" : "destructive"} className={user.active ? 'text-green-400' : ''}>
                        {user.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
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
                        <span className="font-medium">{log.operator_name || 'System'}</span>
                        <Badge variant="secondary" className="text-[10px]">{log.action}</Badge>
                        <span className="text-xs text-muted-foreground">{log.entity_type}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{format(new Date(log.created_at), 'dd MMM · HH:mm')}</span>
                    </div>
                    {log.detail && <p className="text-xs text-muted-foreground mt-1">{log.detail}</p>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
