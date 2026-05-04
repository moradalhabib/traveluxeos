import { useState, useRef, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  Plus, Pencil, Trash2, GripVertical, ChevronDown, ChevronUp, LayoutDashboard,
  UserPlus, Lock, Mail, Activity
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { AirportPricingPanel } from "./airport-pricing";

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
          if (raw === 'PLATINUM') return 'Platinum';
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
    <div className="space-y-3">
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
        <div className="space-y-3">
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

// ─── Backup status card ──────────────────────────────────────────────────────
interface BackupStatus {
  cloudConfigured: boolean;
  lastCloudBackup: { name: string; bytes: number; uploadedAt: string } | null;
  lastEmailedBackup: { at: string; detail: string } | null;
  lastAttempt: { at: string; action: string; detail: string } | null;
  cloudHistory: Array<{ name: string; bytes: number; uploadedAt: string }>;
  auditHistory: Array<{ at: string; action: string; detail: string }>;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function BackupStatusCard({ status, loading }: { status: BackupStatus | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Checking backup status…</p>
      </div>
    );
  }
  if (!status) return null;

  const lastCloud = status.lastCloudBackup;
  const cloudAgeHours = lastCloud
    ? (Date.now() - new Date(lastCloud.uploadedAt).getTime()) / 3_600_000
    : Infinity;
  // Healthy = cloud copy in last 30h (some buffer over the 24h interval)
  const healthy = cloudAgeHours < 30;
  const stale = cloudAgeHours >= 30 && cloudAgeHours < 72;
  const tone = healthy
    ? { bg: 'bg-emerald-50 dark:bg-emerald-950/20', border: 'border-emerald-300/50 dark:border-emerald-800/40', dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', label: 'Healthy' }
    : stale
      ? { bg: 'bg-amber-50 dark:bg-amber-950/20', border: 'border-amber-300/50 dark:border-amber-800/40', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400', label: 'Stale' }
      : { bg: 'bg-red-50 dark:bg-red-950/20', border: 'border-red-300/50 dark:border-red-800/40', dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400', label: lastCloud ? 'Overdue' : 'No backup yet' };

  return (
    <div className={`rounded-xl border ${tone.border} ${tone.bg} p-4 space-y-3`}>
      <div className="flex items-center gap-3">
        <span className={`w-2.5 h-2.5 rounded-full ${tone.dot} animate-pulse`} />
        <p className="font-semibold text-sm text-foreground">Backup status: <span className={tone.text}>{tone.label}</span></p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg bg-background/60 p-3 border border-border/50">
          <p className="text-muted-foreground mb-1">Last cloud backup</p>
          {lastCloud ? (
            <>
              <p className="font-semibold text-foreground">{relativeTime(lastCloud.uploadedAt)}</p>
              <p className="text-muted-foreground mt-0.5">{(lastCloud.bytes / 1024).toFixed(1)} KB · {format(new Date(lastCloud.uploadedAt), 'dd MMM HH:mm')}</p>
            </>
          ) : (
            <p className="font-semibold text-foreground">Never</p>
          )}
        </div>
        <div className="rounded-lg bg-background/60 p-3 border border-border/50">
          <p className="text-muted-foreground mb-1">Last email backup</p>
          {status.lastEmailedBackup ? (
            <>
              <p className="font-semibold text-foreground">{relativeTime(status.lastEmailedBackup.at)}</p>
              <p className="text-muted-foreground mt-0.5">{format(new Date(status.lastEmailedBackup.at), 'dd MMM HH:mm')}</p>
            </>
          ) : (
            <p className="font-semibold text-foreground">Never</p>
          )}
        </div>
      </div>

      {status.lastAttempt && status.lastAttempt.detail?.includes('FAILED') && (
        <div className="text-xs rounded-lg p-2 bg-red-100/50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-300/50">
          <span className="font-semibold">Last attempt:</span> {status.lastAttempt.detail}
        </div>
      )}

      {status.cloudHistory.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">View archive ({status.cloudHistory.length} backup{status.cloudHistory.length !== 1 ? 's' : ''} in cloud storage)</summary>
          <div className="mt-2 space-y-1 max-h-44 overflow-auto rounded-lg bg-background/60 p-2 border border-border/50">
            {status.cloudHistory.map((h) => (
              <div key={h.name} className="flex items-center justify-between gap-2 py-0.5">
                <span className="font-mono text-[10px] text-muted-foreground truncate">{h.name}</span>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">{(h.bytes / 1024).toFixed(0)} KB · {format(new Date(h.uploadedAt), 'dd MMM HH:mm')}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ─── Export tab ───────────────────────────────────────────────────────────────
function ExportTab() {
  const { toast } = useToast();
  const [loading, setLoading] = useState<string | null>(null);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const fetchStatus = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, '');
      const res = await fetch(`${baseUrl}/api/admin/backup/status`, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (res.ok) setStatus(await res.json());
    } catch {
      // non-fatal
    }
    setStatusLoading(false);
  };

  useEffect(() => { fetchStatus(); }, []);

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
      .select('tvl_ref, service_type, status, date_time, pickup, dropoff, destination, flight_number, direction, nameboard, passengers, luggage, vehicle_type, price, tvl_commission, driver_receives, payment_status, payment_method, notes, created_at, clients(name, vip_tier), drivers(name)')
      .order('date_time', { ascending: false });
    if (error || !data) { toast({ title: 'Export failed', variant: 'destructive' }); setLoading(null); return; }
    const csv = buildCSV(
      ['Ref', 'Client', 'VIP Tier', 'Service', 'Status', 'Date/Time', 'Pickup', 'Dropoff/Dest', 'Flight', 'Direction', 'Nameboard', 'Pax', 'Luggage', 'Vehicle', 'Price (£)', 'Commission (£)', 'Driver Gets (£)', 'Payment', 'Method', 'Driver', 'Notes', 'Created'],
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
        b.notes || '',
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
    try {
      // Use the server-side endpoint so the backup includes ALL tables
      // (audit_log, products, invoices, etc.) regardless of client-side RLS.
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, '');
      const res = await fetch(`${baseUrl}/api/admin/export`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
      downloadFile(await blob.text(), `traveluxe-backup-${stamp}.json`, 'application/json');
      toast({ title: 'Full backup downloaded', description: `${(blob.size / 1024).toFixed(1)} KB` });
    } catch (e: any) {
      toast({ title: 'Backup failed', description: e?.message ?? 'Unknown error', variant: 'destructive' });
    }
    setLoading(null);
  };

  const triggerEmailBackup = async () => {
    setLoading('email-backup');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, '');
      const res = await fetch(`${baseUrl}/api/admin/export/email`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const result = await res.json();
      if (result.sent) {
        toast({ title: 'Backup emailed', description: `${(result.bytes / 1024).toFixed(1)} KB sent to admins` });
      } else {
        toast({ title: 'Could not send email', description: 'Check that SMTP_PASS is set and at least one super_admin exists.', variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Email backup failed', description: e?.message ?? 'Unknown error', variant: 'destructive' });
    }
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
    <div className="space-y-3">
      <div>
        <h2 className="font-semibold text-foreground mb-1">Export &amp; Backup</h2>
        <p className="text-sm text-muted-foreground">Download your data at any time. CSV files open in Excel and Google Sheets.</p>
      </div>

      <BackupStatusCard status={status} loading={statusLoading} />

      <div className="space-y-3">
        {exportOptions.map(({ id, icon: Icon, title, description, format: fmt, action }) => (
          <div key={id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:border-primary/30 transition-all">
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

      {/* ─── Daily auto-backup ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
            <Database className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground text-sm">Daily Auto-Backup</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              A full database snapshot is automatically emailed to all admins at <b>03:00 UK time</b> every night.
              You can also send one right now to verify it's working.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="w-full border-primary/30 hover:bg-primary/10 hover:text-primary"
          onClick={triggerEmailBackup}
          disabled={loading === 'email-backup'}
        >
          {loading === 'email-backup'
            ? <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> Sending…</>
            : <><Download className="w-3.5 h-3.5 mr-2" /> Send Backup Email Now</>}
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Privacy note</p>
        <p>Exports include operational data only. Driver and client phone numbers are included so you can restore this data if needed. Store backup files securely.</p>
      </div>
    </div>
  );
}

// ─── Users tab ────────────────────────────────────────────────────────────────

const PERMISSION_MATRIX: { capability: string; super_admin: boolean; admin: boolean; operator: boolean }[] = [
  { capability: "View bookings, requests, jobs", super_admin: true, admin: true,  operator: true  },
  { capability: "Create / edit bookings",        super_admin: true, admin: true,  operator: true  },
  { capability: "View finance & commissions",    super_admin: true, admin: true,  operator: false },
  { capability: "Manage products & pricing",     super_admin: true, admin: true,  operator: false },
  { capability: "Edit fleet (drivers / vehicles)", super_admin: true, admin: true,  operator: false },
  { capability: "View audit log",                super_admin: true, admin: true,  operator: false },
  { capability: "Invite new members",            super_admin: true, admin: true,  operator: false },
  { capability: "Change member roles",           super_admin: true, admin: false, operator: false },
  { capability: "Suspend / reactivate members",  super_admin: true, admin: true,  operator: false },
  { capability: "Remove members",                super_admin: true, admin: false, operator: false },
];

const ROLE_META = {
  super_admin: { label: "Super Admin", border: "border-amber-500", text: "text-amber-500", bg: "bg-amber-500/10" },
  admin:       { label: "Admin",       border: "border-primary",   text: "text-primary",   bg: "bg-primary/10"   },
  operator:    { label: "Operator",    border: "border-border",    text: "text-muted-foreground", bg: "bg-secondary" },
} as const;

function roleMeta(role?: string) {
  return (ROLE_META as any)[role ?? ""] ?? ROLE_META.operator;
}

function PermissionsGrid() {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-secondary/30">
        <p className="font-semibold text-sm text-foreground">Role permissions</p>
        <p className="text-xs text-muted-foreground">Reference of what each role can do inside Traveluxe OS.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="text-left font-medium py-2 px-4">Capability</th>
              <th className="text-center font-medium py-2 px-3 w-24"><span className="text-amber-500">Super Admin</span></th>
              <th className="text-center font-medium py-2 px-3 w-20"><span className="text-primary">Admin</span></th>
              <th className="text-center font-medium py-2 px-3 w-20">Operator</th>
            </tr>
          </thead>
          <tbody>
            {PERMISSION_MATRIX.map((row) => (
              <tr key={row.capability} className="border-b border-border last:border-0">
                <td className="py-2 px-4 text-foreground">{row.capability}</td>
                {(["super_admin", "admin", "operator"] as const).map((r) => (
                  <td key={r} className="text-center py-2 px-3">
                    {row[r]
                      ? <CheckCircle2 className="w-4 h-4 text-green-500 inline" />
                      : <XCircle className="w-4 h-4 text-muted-foreground/40 inline" />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecentActivityPanel() {
  const { data: log, isLoading } = useListAuditLog(
    { action: "invite_user,change_user_role,deactivate_user,remove_user" } as any,
    { query: { queryKey: [...getListAuditLogQueryKey({}), "user-mgmt"] } }
  );
  const items = (log ?? []).slice(0, 8);
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-card">
      <div
        className="px-4 py-3 border-b border-border flex items-center justify-between cursor-pointer select-none hover:bg-muted/30 transition-colors rounded-t-xl"
        onClick={() => setIsOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <p className="font-semibold text-sm text-foreground">Recent member activity</p>
          {items.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border bg-muted text-muted-foreground">{items.length}</span>
          )}
        </div>
        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          <Link href="/admin?tab=audit" className="text-xs text-primary hover:underline">View full log →</Link>
          {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>
      {isOpen && (
        <div className="divide-y divide-border">
          {isLoading ? (
            [...Array(3)].map((_, i) => <div key={i} className="p-3"><Skeleton className="h-8" /></div>)
          ) : items.length === 0 ? (
            <p className="text-xs text-muted-foreground p-4 text-center">No member activity yet.</p>
          ) : (
            items.map((entry: any) => (
              <div key={entry.id} className="px-4 py-2.5 text-xs">
                <p className="text-foreground">{entry.detail}</p>
                <p className="text-muted-foreground mt-0.5">
                  {entry.created_at ? format(new Date(entry.created_at), "MMM d, HH:mm") : ""}
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function InviteMemberDialog({
  open, onOpenChange, isSuperAdmin, onInvited,
}: { open: boolean; onOpenChange: (o: boolean) => void; isSuperAdmin: boolean; onInvited: () => void }) {
  const { toast } = useToast();
  const [name, setName]   = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole]   = useState<"admin" | "operator" | "super_admin">("operator");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => { setName(""); setEmail(""); setRole("operator"); };

  const submit = async () => {
    if (!name.trim() || !email.trim()) {
      toast({ title: "Name and email are required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/users/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), role }),
      });
      const result = await res.json();
      if (!res.ok) {
        toast({ title: "Could not send invite", description: result?.error ?? "Unknown error", variant: "destructive" });
      } else {
        toast({
          title: "Invite sent",
          description: `${email} will receive an email to set their password. They appear here as Suspended until they activate.`,
        });
        reset();
        onOpenChange(false);
        onInvited();
      }
    } catch (e: any) {
      toast({ title: "Could not send invite", description: e?.message ?? "Network error", variant: "destructive" });
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitting) { onOpenChange(o); if (!o) reset(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite new member</DialogTitle>
          <DialogDescription className="text-xs">
            They'll receive an email with a link to set their password. Their account starts as Suspended; activate it once they accept.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="invite-name" className="text-xs">Full name</Label>
            <Input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" className="mt-1" disabled={submitting} />
          </div>
          <div>
            <Label htmlFor="invite-email" className="text-xs">Email address</Label>
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@traveluxelondon.com" className="mt-1" disabled={submitting} />
          </div>
          <div>
            <Label className="text-xs">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as any)} disabled={submitting}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="operator">Operator — daily ops, no finance</SelectItem>
                <SelectItem value="admin">Admin — full ops, finance, fleet</SelectItem>
                {isSuperAdmin && (
                  <SelectItem value="super_admin">Super Admin — everything, incl. roles</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
            Send invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UsersTab({ currentUserId, isSuperAdmin }: { currentUserId?: string; isSuperAdmin: boolean }) {
  const { toast } = useToast();
  const { data: users, isLoading, refetch } = useListUsers(
    { query: { enabled: true, queryKey: getListUsersQueryKey() } }
  );
  const [toggling, setToggling] = useState<string | null>(null);
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; email: string } | null>(null);

  const changeRole = async (userId: string, newRole: string) => {
    if (userId === currentUserId) {
      toast({ title: "You cannot change your own role", variant: "destructive" });
      return;
    }
    setChangingRole(userId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/users/${userId}/role`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ role: newRole }),
      });
      const result = await res.json();
      if (!res.ok) {
        toast({ title: "Failed to change role", description: result?.error ?? "Unknown error", variant: "destructive" });
      } else {
        toast({ title: "Role updated", description: `Now ${newRole.replace("_", " ")}` });
        refetch();
      }
    } catch (e: any) {
      toast({ title: "Failed to change role", description: e?.message ?? "Unknown error", variant: "destructive" });
    }
    setChangingRole(null);
  };

  const toggleActive = async (userId: string, currentActive: boolean) => {
    if (userId === currentUserId) {
      toast({ title: "You cannot change your own account status", variant: "destructive" });
      return;
    }
    setToggling(userId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/users/${userId}/active`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ active: !currentActive }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Failed to update account", description: result?.error ?? "Unknown error", variant: "destructive" });
      } else {
        toast({ title: currentActive ? "Account suspended" : "Account reactivated" });
        refetch();
      }
    } catch (e: any) {
      toast({ title: "Failed to update account", description: e?.message ?? "Network error", variant: "destructive" });
    }
    setToggling(null);
  };

  const removeMember = async (userId: string) => {
    setRemoving(userId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/users/${userId}`, {
        method: "DELETE",
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not remove member", description: result?.error ?? "Unknown error", variant: "destructive" });
      } else {
        toast({ title: "Member removed", description: "Their auth identity is revoked. Historical bookings & audit entries are preserved." });
        refetch();
      }
    } catch (e: any) {
      toast({ title: "Could not remove member", description: e?.message ?? "Network error", variant: "destructive" });
    }
    setRemoving(null);
    setConfirmRemove(null);
  };

  // Filter out soft-deleted "[removed]" users from the visible list — they only
  // remain in the DB to keep historical FKs intact.
  const visibleUsers = (users ?? []).filter((u: any) => u.name !== "[removed]");

  // Role summary counts
  const roleCounts = {
    super_admin: visibleUsers.filter((u: any) => u.role === "super_admin").length,
    admin: visibleUsers.filter((u: any) => u.role === "admin").length,
    operator: visibleUsers.filter((u: any) => u.role === "operator").length,
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-semibold text-foreground mb-1">Team & Access Control</h2>
          <p className="text-sm text-muted-foreground">
            Invite new members, manage roles, and suspend accounts. All changes take effect immediately and are written to the audit log.
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)} className="flex-shrink-0" data-testid="button-invite-member">
          <UserPlus className="w-4 h-4 mr-2" /> Invite member
        </Button>
      </div>

      <PermissionsGrid />

      {/* Role summary strip */}
      {!isLoading && visibleUsers.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {([
            { role: "super_admin", count: roleCounts.super_admin },
            { role: "admin", count: roleCounts.admin },
            { role: "operator", count: roleCounts.operator },
          ] as const).map(({ role, count }) => {
            const m = roleMeta(role);
            return (
              <div key={role} className={`rounded-xl border ${m.border} ${m.bg} px-3 py-2 text-center`}>
                <div className={`text-xl font-bold ${m.text}`}>{count}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{m.label}</div>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Users className="w-3.5 h-3.5" /> Members ({visibleUsers.length})
        </p>
        {isLoading ? (
          [...Array(3)].map((_, i) => <Skeleton key={i} className="h-20" />)
        ) : !visibleUsers.length ? (
          <div className="text-center py-8 text-muted-foreground border border-dashed rounded-xl text-sm">No members yet — invite someone to get started.</div>
        ) : (
          visibleUsers.map((u: any) => {
            const isCurrentUser = u.id === currentUserId;
            // Super admins can only be suspended/removed after demotion — this
            // guards those two actions only. Role changing IS allowed for all users.
            const isSuperAdminTarget = u.role === "super_admin";
            const meta = roleMeta(u.role);
            return (
              <div
                key={u.id}
                className={`rounded-xl border transition-all ${
                  !u.active ? "border-destructive/30 bg-destructive/5"
                  : isSuperAdminTarget ? "border-amber-500/30 bg-amber-500/5"
                  : "border-border bg-card"
                }`}
                data-testid={`user-card-${u.id}`}
              >
                {/* Main row */}
                <div className="flex items-center gap-3 p-4">
                  <div className={`w-10 h-10 rounded-full ${meta.bg} flex items-center justify-center font-bold text-sm uppercase flex-shrink-0 ${meta.text}`}>
                    {u.name?.charAt(0) || "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground">{u.name}</span>
                      {isCurrentUser && <span className="text-[10px] text-muted-foreground">(you)</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Badge variant="outline" className={`${meta.border} ${meta.text} text-[10px]`}>
                        {meta.label}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={u.active ? "text-green-500 border-green-500/30 text-[10px]" : "text-destructive border-destructive/30 text-[10px]"}
                      >
                        {u.active ? "Active" : "Suspended"}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isCurrentUser || toggling === u.id || isSuperAdminTarget}
                      onClick={() => toggleActive(u.id, u.active ?? true)}
                      className={`text-xs ${u.active ? "border-destructive/30 text-destructive hover:bg-destructive/10" : "border-green-500/30 text-green-500 hover:bg-green-500/10"}`}
                      data-testid={`button-toggle-${u.id}`}
                      title={isSuperAdminTarget ? "Demote to Admin first, then suspend" : ""}
                    >
                      {toggling === u.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : u.active ? "Suspend" : "Activate"}
                    </Button>
                    {isSuperAdmin && !isCurrentUser && !isSuperAdminTarget && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={removing === u.id}
                        onClick={() => setConfirmRemove({ id: u.id, email: u.email })}
                        className="text-xs text-destructive hover:bg-destructive/10"
                        data-testid={`button-remove-${u.id}`}
                        title="Remove member permanently"
                      >
                        {removing === u.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Role change row — super admin can change role for any non-self user */}
                {isSuperAdmin && !isCurrentUser && (
                  <div className="px-4 pb-3 flex items-center gap-2 border-t border-border/40 pt-3">
                    <span className="text-[11px] text-muted-foreground flex-shrink-0">Change role:</span>
                    <Select
                      value={u.role}
                      onValueChange={(v) => changeRole(u.id, v)}
                      disabled={changingRole === u.id}
                    >
                      <SelectTrigger className={`h-7 px-2 py-0 text-[11px] w-[160px] ${meta.border} ${meta.text}`}>
                        {changingRole === u.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <SelectValue />
                        )}
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="super_admin" className="text-xs">
                          <span className="text-amber-500 font-medium">Super Admin</span>
                          <span className="text-muted-foreground ml-1">— full control + roles</span>
                        </SelectItem>
                        <SelectItem value="admin" className="text-xs">
                          <span className="text-primary font-medium">Admin</span>
                          <span className="text-muted-foreground ml-1">— ops, finance, fleet</span>
                        </SelectItem>
                        <SelectItem value="operator" className="text-xs">
                          <span className="font-medium">Operator</span>
                          <span className="text-muted-foreground ml-1">— daily ops, no finance</span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {isSuperAdminTarget && (
                      <span className="text-[11px] text-amber-500/80 flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Demote to Admin to unlock suspend/remove
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <RecentActivityPanel />

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-muted-foreground space-y-1">
        <p className="font-semibold text-amber-500 flex items-center gap-2"><Lock className="w-3.5 h-3.5" /> Why Super Admins can't be suspended directly</p>
        <p>To prevent accidentally locking the organisation out, Super Admin accounts must be demoted to Admin first — then they can be suspended or removed. Use the role selector on their card to demote them.</p>
      </div>

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        isSuperAdmin={isSuperAdmin}
        onInvited={refetch}
      />

      <Dialog open={!!confirmRemove} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove this member?</DialogTitle>
            <DialogDescription className="text-xs space-y-2">
              <p><strong className="text-foreground">{confirmRemove?.email}</strong> will lose access immediately and their sign-in will be revoked.</p>
              <p>Their historical bookings, requests and audit-log entries are preserved for accounting integrity. The email address is freed so you can re-invite them later if needed.</p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(null)} disabled={!!removing}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => confirmRemove && removeMember(confirmRemove.id)}
              disabled={!!removing}
            >
              {removing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Remove member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    <div className="space-y-3">
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
                <div key={d.id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Car className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-foreground">{d.vehicle_model || d.vehicle_type || "—"}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      {d.staff_no && (
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
                          {d.staff_no}
                        </span>
                      )}
                      <span>{d.name}</span>
                    </p>
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

type ApiKeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  last_used_ip: string | null;
  revoked_at: string | null;
};

const SCOPE_LABELS: Record<string, { title: string; subtitle: string }> = {
  "requests:create": { title: "Submit Bookings (Client App)", subtitle: "POST /v1/requests — bookings land in the Requests pipeline for review" },
  "driver:auth": { title: "Driver Login (Drivers App)", subtitle: "POST /v1/driver/login — exchange WhatsApp + PIN for a session" },
  "driver:read": { title: "Read Driver Jobs", subtitle: "GET /v1/driver/jobs and /v1/driver/jobs/:id" },
  "driver:update": { title: "Update Job Status", subtitle: "PATCH /v1/driver/jobs/:id/status — On the way / Arrived / Started / Completed" },
};

const ALL_SCOPES = ["requests:create", "driver:auth", "driver:read", "driver:update"];
const PRESETS: Record<string, string[]> = {
  "Client App": ["requests:create"],
  "Drivers App": ["driver:auth", "driver:read", "driver:update"],
};

async function authJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const base = `${import.meta.env.VITE_API_URL ?? ""}/api`;
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const txt = await res.text();
  if (!res.ok) throw new Error(txt || res.statusText);
  return txt ? JSON.parse(txt) : ({} as T);
}

function IntegrationTab() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newScopes, setNewScopes] = useState<string[]>(PRESETS["Client App"]);
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null);

  const baseOrigin = (import.meta.env.VITE_API_URL ?? window.location.origin).replace(/\/$/, "");
  const apiBase = `${baseOrigin}/v1`;

  const reload = useCallback(async () => {
    try {
      const rows = await authJson<ApiKeyRow[]>("/admin/api-keys");
      setKeys(rows);
      setLoadErr(null);
    } catch (e: any) {
      setLoadErr(String(e?.message ?? e));
      setKeys([]);
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const create = async () => {
    if (!newName.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    if (newScopes.length === 0) { toast({ title: "Pick at least one scope", variant: "destructive" }); return; }
    setCreating(true);
    try {
      const created = await authJson<{ name: string; key: string }>("/admin/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), scopes: newScopes }),
      });
      setNewKey({ name: created.name, key: created.key });
      setNewName(""); setNewScopes(PRESETS["Client App"]);
      reload();
    } catch (e: any) {
      toast({ title: "Could not create key", description: String(e?.message ?? e), variant: "destructive" });
    } finally { setCreating(false); }
  };

  const revoke = async (id: string, name: string) => {
    if (!confirm(`Revoke "${name}"? Apps using this key will stop working immediately.`)) return;
    try {
      await authJson(`/admin/api-keys/${id}`, { method: "DELETE" });
      toast({ title: `Revoked "${name}"` });
      reload();
    } catch (e: any) {
      toast({ title: "Revoke failed", description: String(e?.message ?? e), variant: "destructive" });
    }
  };

  const toggleScope = (s: string) =>
    setNewScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const applyPreset = (preset: string) => {
    setNewScopes(PRESETS[preset] ?? []);
    if (!newName.trim()) setNewName(preset);
  };

  const methodColor = (m: string) => {
    if (m === "GET") return "text-blue-400 bg-blue-500/10";
    if (m === "POST") return "text-green-400 bg-green-500/10";
    if (m === "PATCH") return "text-amber-400 bg-amber-500/10";
    if (m === "DELETE") return "text-red-400 bg-red-500/10";
    return "text-muted-foreground bg-secondary";
  };

  const endpoints = [
    { group: "Client App", method: "POST", path: "/v1/requests", scope: "requests:create",
      desc: "Submit a customer booking. Lands in Requests for operator review then Convert to Booking." },
    { group: "Drivers App", method: "POST", path: "/v1/driver/login", scope: "driver:auth",
      desc: "Body: { whatsapp, pin }. Returns driver_token (use as X-Driver-Token on driver routes)." },
    { group: "Drivers App", method: "GET",  path: "/v1/driver/me", scope: "driver:read",
      desc: "Returns the logged-in driver's profile." },
    { group: "Drivers App", method: "GET",  path: "/v1/driver/jobs", scope: "driver:read",
      desc: "Returns this driver's assigned bookings. Optional ?from=&to=&status=" },
    { group: "Drivers App", method: "GET",  path: "/v1/driver/jobs/:id", scope: "driver:read",
      desc: "Single job detail (404 if not assigned to this driver)." },
    { group: "Drivers App", method: "PATCH", path: "/v1/driver/jobs/:id/status", scope: "driver:update",
      desc: "Body: { status }. Allowed: On the way, Arrived, Started, Completed." },
    { group: "Drivers App", method: "POST", path: "/v1/driver/logout", scope: "—",
      desc: "Revokes the current X-Driver-Token session." },
    { group: "Public",     method: "GET",  path: "/v1/healthz", scope: "—",
      desc: "Health probe (no auth)." },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-semibold text-foreground mb-1">Traveluxe OS Public API</h2>
        <p className="text-sm text-muted-foreground">
          Issue scoped API keys for your iOS Client App and the Drivers App. Every key can be revoked here at any time and every call is audited.
        </p>
      </div>

      {/* Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: "Standard", value: "REST + JSON", icon: FileText },
          { label: "Auth", value: "Bearer API key + scopes", icon: Lock },
          { label: "Audit", value: "Every call logged", icon: Activity },
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
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Base URL</p>
        <div className="flex items-center gap-2 bg-background rounded-lg px-3 py-2 border border-border">
          <code className="text-xs text-primary flex-1 break-all" data-testid="text-api-base">{apiBase}</code>
          <CopyButton value={apiBase} />
        </div>
        <p className="text-[11px] text-muted-foreground">Send <code className="text-foreground">Authorization: Bearer &lt;api-key&gt;</code> on every request.</p>
      </div>

      {/* Newly created key — show ONCE */}
      {newKey && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2" data-testid="card-new-api-key">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <p className="text-sm font-semibold text-foreground">Copy this key now — it won't be shown again.</p>
          </div>
          <p className="text-xs text-muted-foreground">Key for "{newKey.name}":</p>
          <div className="flex items-center gap-2 bg-background rounded-lg px-3 py-2 border border-border">
            <code className="text-xs text-primary flex-1 break-all" data-testid="text-new-api-key">{newKey.key}</code>
            <CopyButton value={newKey.key} />
          </div>
          <Button variant="outline" size="sm" onClick={() => setNewKey(null)} data-testid="button-dismiss-new-key">
            I've saved it
          </Button>
        </div>
      )}

      {/* Create a key */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">Create new API key</p>
          <div className="flex gap-2">
            {Object.keys(PRESETS).map((p) => (
              <Button key={p} variant="outline" size="sm" onClick={() => applyPreset(p)} data-testid={`button-preset-${p.replace(/\s+/g, '-').toLowerCase()}`}>
                {p}
              </Button>
            ))}
          </div>
        </div>
        <div>
          <Label htmlFor="api-key-name" className="text-xs">Name</Label>
          <Input
            id="api-key-name"
            placeholder="e.g. Client App — Production"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="mt-1"
            data-testid="input-api-key-name"
          />
        </div>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Scopes</p>
          {ALL_SCOPES.map((s) => {
            const meta = SCOPE_LABELS[s];
            return (
              <label key={s} className="flex items-start gap-3 p-2 rounded-lg border border-border bg-background hover:border-primary/40 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={newScopes.includes(s)}
                  onChange={() => toggleScope(s)}
                  className="mt-1"
                  data-testid={`checkbox-scope-${s.replace(/[:]/g, '-')}`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground">{meta?.title ?? s}</p>
                  <p className="text-[11px] text-muted-foreground">{meta?.subtitle ?? s}</p>
                  <code className="text-[10px] text-primary">{s}</code>
                </div>
              </label>
            );
          })}
        </div>
        <Button onClick={create} disabled={creating} className="w-full" data-testid="button-create-api-key">
          {creating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating…</> : "Create key"}
        </Button>
      </div>

      {/* Existing keys */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Existing keys</p>
          <Button variant="ghost" size="sm" onClick={reload} data-testid="button-reload-keys">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
        {loadErr && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
            Could not load keys: {loadErr}
            <p className="mt-1 text-muted-foreground text-[11px]">Run the migration <code>artifacts/api-server/migrations/api_keys.sql</code> in Supabase if you haven't already.</p>
          </div>
        )}
        {keys === null ? (
          <Skeleton className="h-20" />
        ) : keys.length === 0 ? (
          <p className="text-xs text-muted-foreground p-4 text-center border border-dashed border-border rounded-xl">
            No API keys yet. Create one above.
          </p>
        ) : (
          keys.map((k) => (
            <div key={k.id} className="p-3 rounded-xl border border-border bg-card space-y-2" data-testid={`row-api-key-${k.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm text-foreground">{k.name}</p>
                    {k.revoked_at ? (
                      <Badge variant="outline" className="text-red-400 border-red-500/30">Revoked</Badge>
                    ) : (
                      <Badge variant="outline" className="text-green-400 border-green-500/30">Active</Badge>
                    )}
                  </div>
                  <code className="text-[11px] text-muted-foreground">{k.key_prefix}…</code>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {k.scopes.map((s) => (
                      <code key={s} className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded">{s}</code>
                    ))}
                  </div>
                </div>
                {!k.revoked_at && (
                  <Button variant="ghost" size="sm" onClick={() => revoke(k.id, k.name)} data-testid={`button-revoke-${k.id}`}>
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  </Button>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground flex flex-wrap gap-x-3">
                <span>Created {format(new Date(k.created_at), "d MMM yyyy")}</span>
                <span>Last used {k.last_used_at ? format(new Date(k.last_used_at), "d MMM, HH:mm") : "never"}</span>
                {k.last_used_ip && <span>IP {k.last_used_ip}</span>}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Endpoint reference */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Endpoint reference</p>
        {endpoints.map(({ group, method, path, scope, desc }) => (
          <div key={`${method}${path}`} className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded font-mono flex-shrink-0 mt-0.5 ${methodColor(method)}`}>
              {method}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-xs text-foreground">{path}</code>
                <Badge variant="outline" className="text-[9px] py-0 px-1.5 border-primary/30">{group}</Badge>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>
              {scope !== "—" && <code className="text-[10px] text-primary">scope: {scope}</code>}
            </div>
            <CopyButton value={`${apiBase}${path.replace('/v1','')}`} />
          </div>
        ))}
      </div>

      {/* Quick examples */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <p className="text-sm font-semibold text-foreground">Quick examples</p>
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">Client App — submit a booking</p>
          <div className="bg-background rounded-lg p-3 border border-border overflow-x-auto">
            <pre className="text-[10px] text-green-400 whitespace-pre">{`curl -X POST ${apiBase}/requests \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "service_type": "Airport Transfer",
    "client_name": "Sheikha Al-Maktoum",
    "client_whatsapp": "+447700111222",
    "pickup": "LHR T5",
    "dropoff": "Mayfair",
    "flight_number": "EK001",
    "passengers": 2,
    "luggage": 4,
    "requested_date_time": "2026-06-01T10:00:00Z",
    "notes": "Booster seat needed"
  }'`}</pre>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">Drivers App — log in then update status</p>
          <div className="bg-background rounded-lg p-3 border border-border overflow-x-auto">
            <pre className="text-[10px] text-green-400 whitespace-pre">{`# 1. Log in (returns driver_token)
curl -X POST ${apiBase}/driver/login \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"whatsapp":"+447700123456","pin":"1234"}'

# 2. Get assigned jobs
curl ${apiBase}/driver/jobs \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "X-Driver-Token: <driver_token>"

# 3. Update status
curl -X PATCH ${apiBase}/driver/jobs/<job_id>/status \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "X-Driver-Token: <driver_token>" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"On the way"}'`}</pre>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground space-y-2">
        <p className="font-semibold text-foreground">Setup checklist</p>
        <p>1. Run <code className="text-foreground">artifacts/api-server/migrations/api_keys.sql</code> in your Supabase SQL Editor (creates <code>api_keys</code>, <code>driver_sessions</code>, and adds <code>drivers.pin_hash</code>).</p>
        <p>2. For the Drivers App: open each driver's profile and set their PIN under "Drivers App Access".</p>
        <p>3. Create a key here for each app and paste it into the app's environment.</p>
      </div>
    </div>
  );
}

void SCOPE_LABELS;

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

// ─── Per-airport pricing editor (Vehicle products only) ──────────
const AIRPORT_LIST: { code: string; name: string }[] = [
  { code: "LHR",   name: "Heathrow"  },
  { code: "LGW",   name: "Gatwick"   },
  { code: "STN",   name: "Stansted"  },
  { code: "LTN",   name: "Luton"     },
  { code: "LCY",   name: "London City" },
  { code: "OTHER", name: "Other / Custom" },
];
function AirportPricingEditor({ productId, productName }: { productId: string; productName: string }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Record<string, { price: number; hourly_rate: number | null }>>({});
  const [loading, setLoading] = useState(true);
  const [savingCode, setSavingCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("vehicle_airport_pricing")
        .select("airport_code, price, hourly_rate")
        .eq("product_id", productId);
      if (cancelled) return;
      const map: Record<string, { price: number; hourly_rate: number | null }> = {};
      AIRPORT_LIST.forEach(a => { map[a.code] = { price: 0, hourly_rate: null }; });
      (data ?? []).forEach((r: any) => { map[r.airport_code] = { price: Number(r.price ?? 0), hourly_rate: r.hourly_rate }; });
      setRows(map);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [productId]);

  const saveRow = async (code: string, name: string) => {
    setSavingCode(code);
    const r = rows[code];
    const { error } = await supabase
      .from("vehicle_airport_pricing")
      .upsert({
        product_id:   productId,
        airport_code: code,
        airport_name: name,
        price:        r.price ?? 0,
        hourly_rate:  r.hourly_rate,
        updated_at:   new Date().toISOString(),
      }, { onConflict: "product_id,airport_code" });
    setSavingCode(null);
    if (error) toast({ title: "Save failed: " + error.message, variant: "destructive" });
    else toast({ title: `${code} price saved` });
  };

  return (
    <div className="space-y-2 pt-3 border-t border-border">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Airport Transfer Pricing</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">Set the fixed price for {productName} from each London airport.</p>
        </div>
      </div>
      {loading ? (
        <Skeleton className="h-32" />
      ) : (
        <div className="space-y-2">
          {AIRPORT_LIST.map(a => {
            const r = rows[a.code] ?? { price: 0, hourly_rate: null };
            return (
              <div key={a.code} className="flex items-center gap-2 p-2 rounded-lg border border-border bg-card">
                <div className="w-14 flex-shrink-0">
                  <div className="text-xs font-bold text-foreground">{a.code}</div>
                  <div className="text-[10px] text-muted-foreground">{a.name}</div>
                </div>
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground">Transfer £</label>
                    <input type="number" step="0.01" className="w-full bg-background border border-border rounded-md px-2 py-1 text-sm focus:outline-none focus:border-primary"
                      value={r.price}
                      onChange={e => setRows(v => ({ ...v, [a.code]: { ...v[a.code], price: Number(e.target.value) } }))}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Hourly £ <span className="opacity-60">(optional)</span></label>
                    <input type="number" step="0.01" className="w-full bg-background border border-border rounded-md px-2 py-1 text-sm focus:outline-none focus:border-primary"
                      value={r.hourly_rate ?? ""}
                      onChange={e => setRows(v => ({ ...v, [a.code]: { ...v[a.code], hourly_rate: e.target.value === "" ? null : Number(e.target.value) } }))}
                    />
                  </div>
                </div>
                <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => saveRow(a.code, a.name)} disabled={savingCode === a.code}>
                  {savingCode === a.code ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProductsTab({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { toast } = useToast();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // C2: Products Catalogue is now Tours-only.
  // Vehicles are managed in Airport Pricing; Meet & Greet is also moved into
  // Airport Pricing (C3). Add-ons live on the Services tab. So this tab is
  // dedicated to the Tour catalogue, with per-tour alt-vehicle uplifts.
  const activeCategory = "Tour";
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

  const startNew = () => setEditing({
    id: null, name: "", category: activeCategory, description: "", unit_price: 0, active: true,
    sort_order: filtered.length * 10 + 10,
    service_types: CATEGORY_DEFAULT_SERVICE_TYPES[activeCategory] ?? ALL_SERVICE_TYPES,
    tour_alt_vehicles: [],
  });
  
  const toggleServiceType = (svc: string) => {
    const current: string[] = editing?.service_types ?? [];
    const next = current.includes(svc) ? current.filter((s: string) => s !== svc) : [...current, svc];
    setEditing((v: any) => ({ ...v, service_types: next }));
  };

  const startEdit = (p: any) => setEditing({
    ...p,
    service_types: p.service_types ?? CATEGORY_DEFAULT_SERVICE_TYPES[p.category] ?? ALL_SERVICE_TYPES,
    tour_alt_vehicles: Array.isArray(p.tour_alt_vehicles) ? p.tour_alt_vehicles : [],
  });

  // ── Tour alt-vehicle editor helpers (C2/C4) ─────────────────────────────
  // Each alt-vehicle row is { label: string, uplift: number } and uplift is
  // ADDED to the tour's standard (V Class) price during booking.
  const addAltVehicle = () => setEditing((v: any) => ({
    ...v,
    tour_alt_vehicles: [...(v.tour_alt_vehicles ?? []), { label: "", uplift: 0 }],
  }));
  const updateAltVehicle = (idx: number, field: "label" | "uplift", value: any) =>
    setEditing((v: any) => {
      const arr = [...(v.tour_alt_vehicles ?? [])];
      arr[idx] = { ...arr[idx], [field]: field === "uplift" ? Number(value) : value };
      return { ...v, tour_alt_vehicles: arr };
    });
  const removeAltVehicle = (idx: number) =>
    setEditing((v: any) => ({
      ...v,
      tour_alt_vehicles: (v.tour_alt_vehicles ?? []).filter((_: any, i: number) => i !== idx),
    }));

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
    // Tour alt-vehicles — JSONB column from migration-tour-alt-vehicles.sql.
    // Sent as an array of {label, uplift}. Null/empty arrays are fine.
    if (editing.category === "Tour") {
      payload.tour_alt_vehicles = (editing.tour_alt_vehicles ?? []).filter(
        (av: any) => av && String(av.label ?? "").trim().length > 0
      );
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
      <div className="space-y-3">
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
          {/* Category is locked to Tour on this tab (Vehicles + M&G live in Airport Pricing). */}
          <input type="hidden" value={editing.category} readOnly />
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

          {/* C2: Tour alt-vehicle editor — JSONB list of {label, uplift}.
              Standard price (above) is the V Class price. Each row here is
              an alternative vehicle the operator can offer for this tour at
              checkout, with an uplift added to the standard price. */}
          {editing.category === "Tour" && (
            <div className="pt-4 border-t border-border space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-semibold text-foreground">Alternative Vehicles</label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Standard price above is the V Class price. Add alt vehicles with an uplift (£) added at booking time.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addAltVehicle}
                  className="text-xs h-7 border-primary/30 text-primary hover:bg-primary/10 flex-shrink-0"
                  data-testid="button-add-alt-vehicle"
                >
                  <Plus className="w-3 h-3 mr-1" /> Add alt
                </Button>
              </div>
              <div className="space-y-2">
                {(editing.tour_alt_vehicles ?? []).length === 0 && (
                  <div className="text-center py-4 text-xs text-muted-foreground border border-dashed border-border rounded-xl">
                    No alt vehicles — only V Class will be offered.
                  </div>
                )}
                {(editing.tour_alt_vehicles ?? []).map((av: any, idx: number) => (
                  <div key={idx} className="flex gap-2 items-center" data-testid={`alt-vehicle-row-${idx}`}>
                    <input
                      className="flex-1 bg-background border border-border rounded-lg px-2.5 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                      placeholder="Vehicle label (e.g. Mercedes S Class)"
                      value={av.label ?? ""}
                      onChange={e => updateAltVehicle(idx, "label", e.target.value)}
                      data-testid={`input-alt-label-${idx}`}
                    />
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground text-sm">+£</span>
                      <input
                        type="number"
                        step="0.01"
                        className="w-24 bg-background border border-border rounded-lg px-2.5 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                        placeholder="0"
                        value={av.uplift ?? 0}
                        onChange={e => updateAltVehicle(idx, "uplift", e.target.value)}
                        data-testid={`input-alt-uplift-${idx}`}
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10 h-9 w-9 p-0 flex-shrink-0"
                      onClick={() => removeAltVehicle(idx)}
                      data-testid={`button-remove-alt-${idx}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              {!editing.id && (
                <p className="text-[10px] text-muted-foreground italic">
                  💡 If migration-tour-alt-vehicles.sql hasn't been run yet, alt vehicles will be silently dropped.
                </p>
              )}
            </div>
          )}
        </div>
        <Button className="w-full h-12 font-semibold" onClick={saveProduct} disabled={saving || !editing.name}>
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
          {saving ? "Saving..." : "Save Product"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-foreground">🗺 Tours Catalogue</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tour packages with optional alt-vehicle uplifts.
            {!isSuperAdmin && " Admins can view and add. Only Super Admin can delete."}
          </p>
        </div>
        <Button size="sm" onClick={startNew} className="text-xs h-8 flex-shrink-0" data-testid="button-add-tour">
          <Plus className="w-3 h-3 mr-1" /> Add Tour
        </Button>
      </div>

      <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 text-[11px] text-muted-foreground flex items-start gap-2">
        <span className="text-primary">ℹ️</span>
        <span>
          Vehicles &amp; per-airport prices live in <a href="/admin/airport-pricing" className="text-primary underline">Airport Pricing</a>.
          Meet &amp; Greet tiers and other Add-ons live in the same screen under <strong>Additional Services</strong>.
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-border rounded-xl text-muted-foreground">
          <p className="text-sm">No tours yet — click "Add Tour" to create one.</p>
        </div>
      ) : (
        <>
          {/* Product list */}
          <div className="space-y-2">
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
      <div className="space-y-3">
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
    <div className="space-y-3">
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
                onClick={() => {
                  const next = expanded === svc.id ? null : svc.id;
                  setExpanded(next);
                  if (next) {
                    setTimeout(() => {
                      document.getElementById(`svc-row-${svc.id}`)
                        ?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }, 50);
                  }
                }}
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
          <div key={svc.id} id={`svc-row-${svc.id}`} className={`rounded-2xl border ${svc.active ? 'border-border' : 'border-border/40 opacity-60'} bg-card overflow-hidden scroll-mt-24`}>
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
              <div className="px-3 pb-3 pt-0 space-y-3 border-t border-border">
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
  // RLS on app_settings only allows admin/super_admin to write; hide the
  // Settings tab from operators so they don't get a broken PUT flow.
  const canEditSettings = user?.role === "super_admin" || user?.role === "admin";

  const { data: users, isLoading: usersLoading } = useListUsers(
    { query: { enabled: true, queryKey: getListUsersQueryKey() } }
  );
  const { data: logs, isLoading: logsLoading } = useListAuditLog(
    {},
    { query: { enabled: true, queryKey: getListAuditLogQueryKey({}) } }
  );

  return (
    // Wider container + smaller side padding on mobile so the airport pricing
    // matrix and tier rows have room to breathe on a 360px Samsung S25 screen
    // instead of being squeezed by the previous max-w-3xl ceiling.
    <div className="space-y-3 max-w-6xl mx-auto px-2 sm:px-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">Admin Panel</h1>
          {isSuperAdmin && (
            <Badge variant="outline" className="border-amber-500/30 text-amber-500 text-xs mt-1">Super Admin</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Airport Pricing now lives inside its own tab below — separate
              top-right link removed to declutter the header. */}
          <Link href="/">
            <Button variant="outline" size="sm" className="border-primary/30 text-primary hover:bg-primary/10">
              <LayoutDashboard className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Dashboard</span>
            </Button>
          </Link>
        </div>
      </div>

      <Tabs defaultValue="service-list" className="w-full">
        <div className="overflow-x-auto -mx-2 px-2">
          <TabsList className="inline-flex w-auto min-w-full">
            <TabsTrigger value="service-list" className="text-xs px-3 whitespace-nowrap">Service List</TabsTrigger>
            <TabsTrigger value="import" className="text-xs px-3 whitespace-nowrap">Import</TabsTrigger>
            <TabsTrigger value="export" className="text-xs px-3 whitespace-nowrap">Export</TabsTrigger>
            <TabsTrigger value="fleet" className="text-xs px-3 whitespace-nowrap">Fleet</TabsTrigger>
            {isSuperAdmin && (
              <TabsTrigger value="users" className="text-xs px-3 whitespace-nowrap">Users</TabsTrigger>
            )}
            <TabsTrigger value="audit" className="text-xs px-3 whitespace-nowrap">Audit</TabsTrigger>
            {isSuperAdmin && (
              <TabsTrigger value="api" className="text-xs px-3 whitespace-nowrap">API</TabsTrigger>
            )}
            {canEditSettings && (
              <TabsTrigger value="settings" className="text-xs px-3 whitespace-nowrap">Settings</TabsTrigger>
            )}
          </TabsList>
        </div>

        {/* Service List — the unified place to manage everything that
            Traveluxe sells: the high-level Catalogue (service types and
            add-ons), Tours (specific tour products), and Airport pricing
            (vehicle class × tier matrix + meet & greet). Previously these
            were three separate top-level tabs which was confusing — the
            Service List is one logical product surface, just split into
            sub-tabs by what's being edited. */}
        <TabsContent value="service-list" className="mt-3">
          <Tabs defaultValue="catalogue" className="w-full">
            <div className="overflow-x-auto -mx-2 px-2 mb-4">
              <TabsList className="inline-flex w-auto min-w-full bg-secondary/40">
                <TabsTrigger value="catalogue" className="text-xs px-3 whitespace-nowrap">Catalogue</TabsTrigger>
                <TabsTrigger value="tours" className="text-xs px-3 whitespace-nowrap">Tours</TabsTrigger>
                <TabsTrigger value="airport" className="text-xs px-3 whitespace-nowrap">Airport</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="catalogue" className="mt-0">
              <ServicesTab isSuperAdmin={isSuperAdmin} />
            </TabsContent>
            <TabsContent value="tours" className="mt-0">
              <ProductsTab isSuperAdmin={isSuperAdmin} />
            </TabsContent>
            <TabsContent value="airport" className="mt-0">
              <AirportPricingPanel />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="import" className="mt-3">
          <ImportTab />
        </TabsContent>

        <TabsContent value="export" className="mt-3">
          <ExportTab />
        </TabsContent>

        <TabsContent value="fleet" className="mt-3">
          <FleetTab />
        </TabsContent>

        <TabsContent value="users" className="mt-3">
          <UsersTab currentUserId={user?.id} isSuperAdmin={isSuperAdmin} />
        </TabsContent>

        <TabsContent value="audit" className="mt-3">
          <Tabs defaultValue="trail" className="w-full">
            <div className="overflow-x-auto -mx-2 px-2 mb-4">
              <TabsList className="inline-flex w-auto min-w-full bg-secondary/40">
                <TabsTrigger value="trail" className="text-xs px-3 whitespace-nowrap">Audit Trail</TabsTrigger>
                <TabsTrigger value="activity" className="text-xs px-3 whitespace-nowrap">Activity</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="trail" className="mt-0">
          <Card className="border-border">
            <CardHeader><CardTitle className="text-base">System Audit Trail</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {logsLoading ? (
                  [...Array(5)].map((_, i) => <Skeleton key={i} className="h-16" />)
                ) : logs?.map((log) => {
                  // Detail strings carry an optional payload appended by the
                  // audit helpers in one of three formats:
                  //   1. " before={…} after={…}"   — update diffs
                  //   2. "\n--- SNAPSHOT ---\n{…}" — full row snapshot on delete
                  //   3. trailing "{…}" JSON blob — legacy
                  // Split the human-readable summary from the raw payload so
                  // the summary stays one tidy line and the JSON is tucked
                  // behind a "Show full details" toggle.
                  const raw = typeof (log as any).detail === "string" ? (log as any).detail : "";
                  let summary = raw;
                  let diff = "";
                  const snapIdx = raw.indexOf("--- SNAPSHOT ---");
                  const beforeAfterMatch = raw.match(/\s(before|after)=/);
                  if (snapIdx >= 0) {
                    summary = raw.slice(0, snapIdx).replace(/\s*$/, "").trim();
                    diff = raw.slice(snapIdx).trim();
                  } else if (beforeAfterMatch) {
                    summary = raw.slice(0, beforeAfterMatch.index!).trim();
                    diff = raw.slice(beforeAfterMatch.index!).trim();
                  } else {
                    // Trailing JSON blob — split on the first "{" if the rest
                    // parses as JSON, otherwise leave the whole string as summary.
                    const braceIdx = raw.indexOf("{");
                    if (braceIdx > 0) {
                      const tail = raw.slice(braceIdx);
                      try { JSON.parse(tail); diff = tail; summary = raw.slice(0, braceIdx).trim(); }
                      catch { /* not JSON, keep as summary */ }
                    }
                  }
                  // Pretty-print JSON inside the diff if possible.
                  let prettyDiff = diff;
                  if (diff) {
                    const firstBrace = diff.indexOf("{");
                    if (firstBrace >= 0) {
                      const head = diff.slice(0, firstBrace);
                      const tail = diff.slice(firstBrace);
                      try { prettyDiff = head + JSON.stringify(JSON.parse(tail), null, 2); }
                      catch { /* leave as-is */ }
                    }
                  }
                  return (
                    <div key={log.id} className="p-3 border border-border rounded-xl bg-background/50 text-sm">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 mb-1">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="font-medium truncate">{log.operator_name || "System"}</span>
                          <Badge variant="secondary" className="text-[10px] whitespace-nowrap">{log.action}</Badge>
                          <span className="text-xs text-muted-foreground">{log.entity_type}</span>
                        </div>
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">{format(new Date(log.created_at), "dd MMM · HH:mm")}</span>
                      </div>
                      {summary && <p className="text-xs text-muted-foreground mt-1">{summary}</p>}
                      {prettyDiff && (
                        <details className="mt-2">
                          <summary className="text-[11px] text-primary cursor-pointer select-none hover:underline">Show full details</summary>
                          <pre className="mt-1 text-[11px] text-muted-foreground bg-muted/30 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-96 overflow-y-auto">{prettyDiff}</pre>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
            </TabsContent>
            <TabsContent value="activity" className="mt-0">
              <ActivityLogSection />
            </TabsContent>
          </Tabs>
        </TabsContent>

        {isSuperAdmin && (
          <TabsContent value="api" className="mt-3">
            <IntegrationTab />
          </TabsContent>
        )}

        {canEditSettings && (
          <TabsContent value="settings" className="mt-3 space-y-4">
            <SettingsTab />
            {isSuperAdmin && <ResetTvlNumbersCard />}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ─── Reset TVL staff numbers (Super Admin · Settings tab) ─────────────────
// Moved here from the main Drivers page where it was too prominent and one
// tap away from a destructive bulk update. Now hidden behind: super_admin
// role + Settings tab + typed-confirmation phrase + audit log on the server.
function ResetTvlNumbersCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const REQUIRED = "RESET TVL";
  const armed = confirmPhrase.trim().toUpperCase() === REQUIRED;

  const handleReset = async () => {
    if (!armed) return;
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in");
      const res = await fetch(`/api/drivers/reset-staff-numbers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(body?.error || "Reset failed");
      toast({
        title: "TVL numbers reset",
        description: `Cleared TVL staff numbers on ${body?.cleared ?? 0} driver(s). Bookings & commissions are untouched.`,
      });
      qc.invalidateQueries({ queryKey: getListDriversQueryKey({}) });
      setConfirmPhrase("");
    } catch (e: any) {
      toast({
        title: "Could not reset TVL numbers",
        description: e?.message ?? "Try again",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-destructive flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Danger zone — Reset TVL Staff Numbers
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Clears the TVL Staff Number on every driver so you can re-assign them
          cleanly (TVL 01, TVL 02, …) from each driver's profile.
        </p>
        <p className="text-xs text-foreground">
          ✅ Bookings, commissions, ratings and job history are <strong>not</strong> affected — they link to drivers by ID, not by TVL number.
        </p>
        <p className="text-xs text-destructive">
          This action is logged in the audit trail. Only Super Admin can do this.
        </p>
        <div className="space-y-1.5 pt-1">
          <Label htmlFor="reset-tvl-confirm" className="text-xs">
            Type <code className="px-1 py-0.5 rounded bg-muted text-foreground">{REQUIRED}</code> to enable the button
          </Label>
          <Input
            id="reset-tvl-confirm"
            value={confirmPhrase}
            onChange={(e) => setConfirmPhrase(e.target.value)}
            placeholder={REQUIRED}
            autoComplete="off"
            data-testid="input-reset-tvl-confirm"
          />
        </div>
        <Button
          onClick={handleReset}
          disabled={!armed || busy}
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          data-testid="button-reset-tvl-execute"
        >
          {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Resetting…</> : "Yes, clear all TVL numbers"}
        </Button>
      </CardContent>
    </Card>
  );
}

const ACTIVITY_FILTER_GROUPS = [
  { key: "all", label: "All", prefix: "" },
  { key: "bookings", label: "Bookings", prefix: "booking" },
  { key: "drivers", label: "Drivers", prefix: "driver" },
  { key: "clients", label: "Clients", prefix: "client" },
  { key: "settlements", label: "Settlements", prefix: "settlement" },
  { key: "issues", label: "Issues", prefix: "issue" },
  { key: "logins", label: "Logins", prefix: "login" },
];

function ActivityLogSection() {
  const [filter, setFilter] = useState<string>("all");
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`/api/admin/activity-log?limit=200`, {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        });
        if (!res.ok) {
          if (!cancelled) setEntries([]);
          return;
        }
        const json = await res.json();
        if (!cancelled) setEntries(Array.isArray(json.entries) ? json.entries : []);
      } catch {
        if (!cancelled) setEntries([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const activeGroup = ACTIVITY_FILTER_GROUPS.find(g => g.key === filter) ?? ACTIVITY_FILTER_GROUPS[0];
  const filtered = entries.filter(e => {
    if (!activeGroup.prefix) return true;
    return typeof e.action_type === "string" && e.action_type.startsWith(activeGroup.prefix);
  });

  const exportCsv = () => {
    const rows = filtered.map((e: any) => [
      e.occurred_at ? format(new Date(e.occurred_at), "dd MMM yyyy HH:mm") : "",
      e.operator_name ?? "",
      e.action_type ?? "",
      e.description ?? "",
      e.entity_label ?? "",
    ]);
    const csv = buildCSV(["When", "Operator", "Action", "Description", "Entity"], rows);
    downloadFile(csv, `activity-log-${format(new Date(), "yyyy-MM-dd")}.csv`, "text/csv;charset=utf-8");
  };

  return (
    <Card className="border-border" data-testid="card-activity-log">
      <CardHeader
        className="flex flex-row items-center justify-between gap-3 space-y-0 cursor-pointer select-none hover:bg-muted/30 transition-colors rounded-t-xl"
        onClick={() => setIsOpen(o => !o)}
      >
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="w-4 h-4" />
          Activity Log
          {filtered.length > 0 && (
            <Badge variant="outline" className="text-xs">{filtered.length}</Badge>
          )}
        </CardTitle>
        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          <Button
            size="sm"
            variant="outline"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            data-testid="button-export-activity-csv"
          >
            <Download className="w-4 h-4 mr-1" />
            Export CSV
          </Button>
          {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {isOpen && (
        <CardContent className="space-y-3 pt-2">
          <div className="flex flex-wrap gap-1.5">
            {ACTIVITY_FILTER_GROUPS.map(g => (
              <button
                key={g.key}
                type="button"
                onClick={() => setFilter(g.key)}
                data-testid={`chip-activity-${g.key}`}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  filter === g.key
                    ? "bg-primary/20 border-primary/50 text-primary"
                    : "bg-background border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
          <div className="max-h-[500px] overflow-y-auto space-y-2 pr-1">
            {loading ? (
              [...Array(5)].map((_, i) => <Skeleton key={i} className="h-14" />)
            ) : filtered.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">No activity yet.</div>
            ) : filtered.map((e: any) => (
              <div
                key={e.id}
                className="p-3 border border-border rounded-xl bg-background/50 text-sm"
                data-testid={`row-activity-${e.id}`}
              >
                <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{e.operator_name || "System"}</span>
                    <Badge variant="secondary" className="text-[10px]">{e.action_type}</Badge>
                    {e.entity_label && (
                      <span className="text-xs text-muted-foreground">{e.entity_label}</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {e.occurred_at ? format(new Date(e.occurred_at), "dd MMM yyyy HH:mm") : ""}
                  </span>
                </div>
                {e.description && (
                  <p className="text-xs text-muted-foreground">{e.description}</p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function SettingsTab() {
  const [adminEmail, setAdminEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch("/api/settings", {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        });
        if (res.ok) {
          const json = await res.json();
          setAdminEmail(json.admin_email ?? "");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ admin_email: adminEmail.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSavedAt(new Date());
    } catch (e: any) {
      alert("Failed to save: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">App Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Admin email (Daily Briefing recipient)</label>
            <p className="text-xs text-muted-foreground">
              The 07:00 UK Daily Briefing email is sent to this address. Adjusts automatically for BST and GMT.
            </p>
            <input
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              disabled={loading}
              placeholder="info@traveluxelondon.com"
              className="w-full h-10 px-3 rounded-md border border-border bg-background text-sm text-foreground"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saving || loading || !adminEmail.includes("@")}>
              {saving ? "Saving…" : "Save"}
            </Button>
            {savedAt && (
              <span className="text-xs text-green-500">Saved at {format(savedAt, "HH:mm:ss")}</span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
