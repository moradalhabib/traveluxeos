import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateDriver } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Car } from "lucide-react";

const formSchema = z.object({
  name: z.string().min(2, "Name required"),
  staff_no: z.string().optional(),
  whatsapp: z.string().min(5, "WhatsApp required"),
  email: z.string().email("Valid email required for job alerts").optional().or(z.literal("")),
  vehicle_model: z.string().min(1, "Vehicle name required (e.g. MB V-Class)"),
  vehicle_type: z.string().regex(/^(19|20)\d{2}$/, "Enter a 4-digit year").or(z.literal("")).default(""),
  plate: z.string().optional(),
  status: z.string().default("Active"),
  notes: z.string().optional(),
});

export default function NewDriver() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createDriver = useCreateDriver();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      staff_no: "",
      whatsapp: "",
      email: "",
      vehicle_model: "",
      vehicle_type: "",
      plate: "",
      status: "Active",
      notes: "",
    },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    createDriver.mutate({ data: values }, {
      onSuccess: (driver: any) => {
        toast({ title: "Driver added to fleet" });
        setLocation(`/drivers/${driver.id}`);
      },
      onError: () => {
        toast({ title: "Error adding driver", variant: "destructive" });
      },
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Add Driver</h1>
        <Button variant="outline" onClick={() => setLocation("/drivers")}>Cancel</Button>
      </div>

      <Card className="border-primary/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Driver Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <div className="grid grid-cols-1 gap-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name *</FormLabel>
                    <FormControl><Input placeholder="James Okafor" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="staff_no" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Staff Number
                      <span className="text-xs text-muted-foreground font-normal ml-1">Auto-assigned (TVL 01, TVL 02…) — leave blank</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Auto: next TVL number" {...field} className="font-mono uppercase" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="whatsapp" render={({ field }) => (
                  <FormItem>
                    <FormLabel>WhatsApp Number *</FormLabel>
                    <FormControl><Input type="tel" placeholder="+44 7700 000000" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Email
                      <span className="text-xs text-muted-foreground font-normal ml-1">
                        Receives auto job-assignment alerts
                      </span>
                    </FormLabel>
                    <FormControl><Input type="email" placeholder="driver@example.com" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* Vehicle section */}
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <Car className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm text-foreground">Vehicle Details</span>
                </div>

                <FormField control={form.control} name="vehicle_model" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Vehicle Make &amp; Model *
                      <span className="text-xs text-muted-foreground font-normal ml-1">Exact name shown on job sheets</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        list="suggested-vehicles"
                        placeholder="e.g. MB V-Class, MB S-Class, Range Rover"
                        {...field}
                        className="font-medium"
                      />
                    </FormControl>
                    <datalist id="suggested-vehicles">
                      <option value="MB V-Class" />
                      <option value="MB S-Class" />
                      <option value="MB E-Class" />
                      <option value="MB GLS" />
                      <option value="BMW 7 Series" />
                      <option value="BMW 5 Series" />
                      <option value="Range Rover" />
                      <option value="Range Rover Sport" />
                      <option value="Rolls-Royce Ghost" />
                      <option value="Rolls-Royce Phantom" />
                      <option value="Bentley Flying Spur" />
                      <option value="Audi A8" />
                      <option value="Tesla Model S" />
                      <option value="Toyota Alphard" />
                      <option value="VW Caravelle" />
                    </datalist>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="vehicle_type" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vehicle Year</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          inputMode="numeric"
                          placeholder="e.g. 2024"
                          min={1990}
                          max={2030}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="plate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reg Plate</FormLabel>
                      <FormControl><Input placeholder="AB12 CDE" {...field} className="font-mono uppercase" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>

              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="Active">Active</SelectItem>
                      <SelectItem value="Inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Internal Notes</FormLabel>
                  <FormControl><Textarea placeholder="Preferred routes, availability, etc." className="resize-none" rows={2} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <Button type="submit" className="w-full h-12 font-semibold" disabled={createDriver.isPending}>
                {createDriver.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Add to Fleet
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
