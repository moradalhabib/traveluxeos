import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useListClients, getListClientsQueryKey } from "@workspace/api-client-react";
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
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { useCreateRequest } from "@/lib/requests-api";

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

export default function NewRequest() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const create = useCreateRequest();

  const { data: clients } = useListClients(
    {},
    { query: { enabled: true, queryKey: getListClientsQueryKey({}) } }
  );

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

  const onSubmit = (vals: FormVals) => {
    // Resolve client_name from selected client if not typed
    const payload: any = { ...vals };
    if (!payload.client_id) delete payload.client_id;
    if (!payload.requested_date_time) delete payload.requested_date_time;
    if (!payload.estimated_price) delete payload.estimated_price;
    if (payload.client_id && !payload.client_name) {
      const c = clients?.find(c => c.id === payload.client_id);
      if (c) payload.client_name = c.name;
    }

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

      <Card className="border-primary/10">
        <CardHeader>
          <CardTitle>Capture Client Interest</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="client_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client (existing)</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Pick from clients" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {clients?.map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="client_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>…or new client name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Mr Al-Fahad" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

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
    </div>
  );
}
