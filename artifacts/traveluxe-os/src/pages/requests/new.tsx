import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, UserCheck, UserPlus, X } from "lucide-react";
import { useCreateRequest } from "@/lib/requests-api";
import { RequestDetailsFields, type RequestDetails } from "@/components/RequestDetailsFields";

const SERVICE_TYPES = ["Airport Transfer","Tour","Car Rental","Apartment","Hotel","Other"] as const;
const PRIORITIES = ["Low","Medium","High","Urgent"] as const;
const STATUSES = ["New","Following Up","Ready to Book","Declined"] as const;

const formSchema = z.object({
  client_id: z.string().optional(),
  client_name: z.string().optional(),
  service_type: z.enum(SERVICE_TYPES),
  priority: z.enum(PRIORITIES).default("Medium"),
  requested_date_time: z.string().optional(),
  follow_up_date: z.string().min(1, "Follow-up date is required"),
  status: z.enum(STATUSES).default("New"),
  notes: z.string().optional(),
  estimated_price: z.coerce.number().optional(),
});

type FormVals = z.infer<typeof formSchema>;

interface FoundClient {
  id: string;
  name: string;
  whatsapp: string | null;
  email: string | null;
  vip_tier: string | null;
}

export default function NewRequest() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const create = useCreateRequest();

  const [waInput, setWaInput] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [foundClient, setFoundClient] = useState<FoundClient | null>(null);
  const [confirmedClient, setConfirmedClient] = useState<FoundClient | null>(null);
  const [phase, setPhase] = useState<"lookup" | "found" | "register" | "form">("lookup");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const todayPlus3 = (() => {
    const d = new Date(); d.setDate(d.getDate() + 3);
    return d.toISOString().slice(0, 10);
  })();

  const form = useForm<FormVals>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      service_type: "Airport Transfer",
      priority: "Medium",
      status: "New",
      follow_up_date: todayPlus3,
    },
  });

  // Pre-fill from URL ?client_id=... (e.g. when launched from a client profile)
  useEffect(() => {
    const params = new URLSearchParams(search);
    const cid = params.get("client_id");
    if (!cid) return;
    (async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, name, whatsapp, email, vip_tier")
        .eq("id", cid)
        .maybeSingle();
      if (data) {
        setConfirmedClient(data as FoundClient);
        form.setValue("client_id", data.id);
        form.setValue("client_name", data.name);
        setPhase("form");
      }
    })();
  }, []);

  // Live WhatsApp / phone lookup against existing client profiles
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const raw = waInput.trim();
    const normalized = raw.replace(/\D/g, "");
    if (normalized.length < 6) {
      setFoundClient(null);
      if (phase === "found" || phase === "register") setPhase("lookup");
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const { data } = await supabase
          .from("clients")
          .select("id, name, whatsapp, email, vip_tier")
          .or(`whatsapp.ilike.%${normalized}%,whatsapp.ilike.%${raw}%`)
          .eq("inactive", false)
          .limit(1)
          .maybeSingle();
        if (data) {
          setFoundClient(data as FoundClient);
          setPhase("found");
        } else {
          setFoundClient(null);
          setPhase(normalized.length >= 8 ? "register" : "lookup");
        }
      } finally {
        setIsSearching(false);
      }
    }, 400);
  }, [waInput]);

  const useExisting = (c: FoundClient) => {
    setConfirmedClient(c);
    form.setValue("client_id", c.id);
    form.setValue("client_name", c.name);
    setPhase("form");
  };

  const useNewClient = (name: string) => {
    setConfirmedClient(null);
    form.setValue("client_id", "");
    form.setValue("client_name", name);
    setPhase("form");
  };

  const resetClient = () => {
    setConfirmedClient(null);
    setFoundClient(null);
    setWaInput("");
    form.setValue("client_id", "");
    form.setValue("client_name", "");
    setPhase("lookup");
  };

  const [newName, setNewName] = useState("");
  const [details, setDetails] = useState<RequestDetails>({});

  const onSubmit = (vals: FormVals) => {
    // Stash the typed WhatsApp number on details so a later "Convert to
    // booking" can prefill the lookup field — operator never has to retype
    // the number, even when the lead has no client profile yet.
    const detailsWithWa: any = { ...details };
    const waTrimmed = waInput?.trim();
    if (waTrimmed && !detailsWithWa.client_whatsapp) {
      detailsWithWa.client_whatsapp = waTrimmed;
    }
    const payload: any = { ...vals, details: detailsWithWa };
    if (!payload.client_id) delete payload.client_id;
    if (!payload.requested_date_time) delete payload.requested_date_time;
    if (!payload.estimated_price) delete payload.estimated_price;
    if (!payload.client_name && confirmedClient) payload.client_name = confirmedClient.name;

    create.mutate(payload, {
      onSuccess: (r: any) => {
        toast({ title: "Request created" });
        setLocation(`/requests/${r.id}`);
      },
      onError: (e: any) => {
        toast({ title: "Error creating request", description: e?.message, variant: "destructive" });
      },
    });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">New Request</h1>
        <Button variant="outline" onClick={() => setLocation("/requests")}>Cancel</Button>
      </div>

      {/* Step 1 — Cross-check client by WhatsApp / phone */}
      {phase !== "form" && (
        <Card className="border-primary/10">
          <CardHeader>
            <CardTitle className="text-base">Step 1 — Find or add client</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block">
                Client WhatsApp / Phone Number
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="+44 7XXX XXXXXX"
                  value={waInput}
                  onChange={(e) => setWaInput(e.target.value)}
                  className="pl-10 h-11"
                />
                {isSearching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                Type at least 6 digits — we’ll cross-check against existing client profiles.
              </p>
            </div>

            {phase === "found" && foundClient && (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <UserCheck className="h-4 w-4 text-emerald-400" />
                      <span className="font-semibold text-foreground">{foundClient.name}</span>
                      {foundClient.vip_tier && foundClient.vip_tier !== "Standard" && (
                        <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300">
                          {foundClient.vip_tier}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                      {foundClient.whatsapp && <div>{foundClient.whatsapp}</div>}
                      {foundClient.email && <div>{foundClient.email}</div>}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => useExisting(foundClient)}>
                    Use this profile
                  </Button>
                  <Button size="sm" variant="outline" onClick={resetClient}>
                    <X className="h-3.5 w-3.5 mr-1" /> Search again
                  </Button>
                </div>
              </div>
            )}

            {phase === "register" && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <UserPlus className="h-4 w-4 text-amber-400" />
                  <span className="text-foreground font-medium">No profile matched</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Capture this lead anyway — you can register them as a full client later when they convert.
                </p>
                <Input
                  placeholder="Lead name (e.g. Mr Al-Fahad)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="h-10"
                />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={newName.trim().length < 2} onClick={() => useNewClient(newName.trim())}>
                    Continue with this lead
                  </Button>
                  <Button size="sm" variant="outline" onClick={resetClient}>
                    <X className="h-3.5 w-3.5 mr-1" /> Search again
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 2 — Capture the request */}
      {phase === "form" && (
        <Card className="border-primary/10">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">Step 2 — Capture the request</CardTitle>
              <Button size="sm" variant="ghost" onClick={resetClient}>
                <X className="h-3.5 w-3.5 mr-1" /> Change client
              </Button>
            </div>
            <div className="rounded-md bg-muted/40 px-3 py-2 mt-2 text-sm flex items-center gap-2">
              {confirmedClient ? (
                <>
                  <UserCheck className="h-4 w-4 text-emerald-400" />
                  <span className="font-medium text-foreground">{confirmedClient.name}</span>
                  <span className="text-xs text-muted-foreground">· existing client</span>
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4 text-amber-400" />
                  <span className="font-medium text-foreground">{form.getValues("client_name") || "New lead"}</span>
                  <span className="text-xs text-muted-foreground">· not yet a client</span>
                </>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="service_type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Service Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {SERVICE_TYPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Priority</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="follow_up_date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Follow-up Date *</FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="requested_date_time"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Requested Service Date / Time</FormLabel>
                        <FormControl><Input type="datetime-local" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="estimated_price"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Estimated Price (£)</FormLabel>
                        <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <RequestDetailsFields
                  serviceType={form.watch("service_type")}
                  value={details}
                  onChange={setDetails}
                />

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="What did the client ask for? Constraints, dates, deal-breakers…"
                          rows={4}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button type="submit" className="w-full h-12" disabled={create.isPending}>
                  {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Request
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
