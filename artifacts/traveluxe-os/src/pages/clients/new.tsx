import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateClient, useCheckClientDuplicate, getCheckClientDuplicateQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

const formSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  whatsapp: z.string().min(5, "WhatsApp number is required"),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  nationality: z.string().optional(),
  language_preference: z.string().optional(),
  vip_tier: z.string().default("Standard"),
  notes: z.string().optional()
});

export default function NewClient() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createClient = useCreateClient();
  const [debouncedWhatsapp, setDebouncedWhatsapp] = useState("");
  const queryClient = useQueryClient();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      whatsapp: "",
      email: "",
      nationality: "",
      language_preference: "English",
      vip_tier: "Standard",
      notes: ""
    }
  });

  const watchWhatsapp = form.watch("whatsapp");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedWhatsapp(watchWhatsapp);
    }, 500);
    return () => clearTimeout(timer);
  }, [watchWhatsapp]);

  const fetchDuplicate = async (whatsapp: string) => {
    if (!whatsapp) return null;
    const res = await queryClient.fetchQuery({
      queryKey: getCheckClientDuplicateQueryKey({ whatsapp }),
      queryFn: () => fetch(`/api/clients/check-duplicate?whatsapp=${whatsapp}`).then(res => res.json())
    });
    return res;
  };

  const [duplicateWarning, setDuplicateWarning] = useState<any>(null);

  useEffect(() => {
    if (debouncedWhatsapp.length > 5) {
      fetchDuplicate(debouncedWhatsapp).then((res: any) => {
        if (res?.found) {
          setDuplicateWarning(res.client);
        } else {
          setDuplicateWarning(null);
        }
      });
    } else {
      setDuplicateWarning(null);
    }
  }, [debouncedWhatsapp]);

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    createClient.mutate({ data: values }, {
      onSuccess: (client) => {
        toast({ title: "Client created successfully" });
        setLocation(`/clients/${client.id}`);
      },
      onError: () => {
        toast({ title: "Error creating client", variant: "destructive" });
      }
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">New Client</h1>
        <Button variant="outline" onClick={() => setLocation("/clients")}>Cancel</Button>
      </div>

      {duplicateWarning && (
        <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10 text-amber-500">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Potential Duplicate Detected</AlertTitle>
          <AlertDescription>
            A client with this WhatsApp number already exists: <strong>{duplicateWarning.name}</strong> ({duplicateWarning.vip_tier}).
          </AlertDescription>
        </Alert>
      )}

      <Card className="border-primary/10">
        <CardHeader>
          <CardTitle>Client Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="John Doe" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="whatsapp"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>WhatsApp Number *</FormLabel>
                      <FormControl>
                        <Input placeholder="+44..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="john@example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="vip_tier"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>VIP Tier</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select tier" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Standard">Standard</SelectItem>
                          <SelectItem value="VIP">VIP</SelectItem>
                          <SelectItem value="VVIP">VVIP</SelectItem>
                          <SelectItem value="Platinum">Platinum</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="nationality"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nationality</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. British" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="language_preference"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Language</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select language" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="English">English</SelectItem>
                          <SelectItem value="Arabic">Arabic</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
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
                    <FormLabel>Internal Notes</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Preferences, dietary requirements, etc." className="resize-none" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full h-12" disabled={createClient.isPending}>
                {createClient.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Client
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
