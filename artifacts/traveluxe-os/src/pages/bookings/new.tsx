import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateBooking, useListClients, getListClientsQueryKey, useListDrivers, getListDriversQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";

const formSchema = z.object({
  client_id: z.string().optional(),
  service_type: z.string(),
  direction: z.string().optional(),
  pickup: z.string().optional(),
  dropoff: z.string().optional(),
  destination: z.string().optional(),
  flight_number: z.string().optional(),
  date_time: z.string().optional(),
  passengers: z.coerce.number().optional(),
  luggage: z.coerce.number().optional(),
  vehicle_type: z.string().optional(),
  nameboard: z.string().optional(),
  special_requests: z.string().optional(),
  additional_charges: z.coerce.number().optional(),
  price: z.coerce.number().min(0, "Price must be a positive number"),
  tvl_commission: z.coerce.number().min(0).default(0),
  payment_status: z.string().default("Unpaid"),
  payment_method: z.string().optional(),
  source: z.string().optional(),
  status: z.string().default("Confirmed"),
  driver_id: z.string().optional(),
  notes: z.string().optional(),
  duration: z.coerce.number().optional()
});

export default function NewBooking() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createBooking = useCreateBooking();
  
  const { data: clients } = useListClients({}, { query: { enabled: true, queryKey: getListClientsQueryKey({}) } });
  const { data: drivers } = useListDrivers({}, { query: { enabled: true, queryKey: getListDriversQueryKey({}) } });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      service_type: "Airport Transfer",
      price: 0,
      tvl_commission: 0,
      status: "Confirmed",
      payment_status: "Unpaid",
      passengers: 1,
      luggage: 0,
      direction: "Arrival"
    }
  });

  const serviceType = form.watch("service_type");
  const price = form.watch("price") || 0;
  const commission = form.watch("tvl_commission") || 0;
  const driverReceives = price - commission;

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    createBooking.mutate({ data: values }, {
      onSuccess: (booking) => {
        toast({ title: "Booking created successfully" });
        setLocation(`/bookings/${booking.id}`);
      },
      onError: () => {
        toast({ title: "Error creating booking", variant: "destructive" });
      }
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">New Booking</h1>
        <Button variant="outline" onClick={() => setLocation("/bookings")}>Cancel</Button>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card className="border-primary/10">
            <CardHeader>
              <CardTitle>Core Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="client_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select client" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {clients?.map((client) => (
                            <SelectItem key={client.id} value={client.id}>
                              {client.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="service_type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Service Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select service type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Airport Transfer">Airport Transfer</SelectItem>
                          <SelectItem value="Tour">Tour</SelectItem>
                          <SelectItem value="As Directed">As Directed</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="date_time"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date & Time</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="vehicle_type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vehicle Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select vehicle" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Saloon">Saloon</SelectItem>
                          <SelectItem value="Estate">Estate</SelectItem>
                          <SelectItem value="MPV">MPV</SelectItem>
                          <SelectItem value="Minibus">Minibus</SelectItem>
                          <SelectItem value="Luxury">Luxury</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="source"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Booking Source</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select source" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="WhatsApp">WhatsApp</SelectItem>
                          <SelectItem value="Snapchat">Snapchat</SelectItem>
                          <SelectItem value="Referral">Referral</SelectItem>
                          <SelectItem value="Returning">Returning</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/10">
            <CardHeader>
              <CardTitle>Journey Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {serviceType === "Airport Transfer" && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-b border-border pb-4 mb-4">
                    <FormField
                      control={form.control}
                      name="direction"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Direction</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select direction" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="Arrival">Arrival</SelectItem>
                              <SelectItem value="Departure">Departure</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="flight_number"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Flight Number</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. BA123" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="pickup"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Pickup</FormLabel>
                          <FormControl>
                            <Input placeholder="Location or Airport" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="dropoff"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Dropoff</FormLabel>
                          <FormControl>
                            <Input placeholder="Location or Airport" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </>
              )}

              {serviceType === "Tour" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="destination"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Destination / Route</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. London Highlights" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="duration"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Duration (Hours)</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="passengers"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Passengers</FormLabel>
                      <FormControl>
                        <Input type="number" min="1" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="luggage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Luggage Pieces</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="special_requests"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Special Requests</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Child seats, specific route, etc." className="resize-none" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card className="border-primary/10">
            <CardHeader>
              <CardTitle>Financials & Assignment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="price"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Total Price (£)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} className="text-lg font-bold" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="tvl_commission"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>TVL Commission (£)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="space-y-2">
                  <Label>Driver Receives (£)</Label>
                  <div className="h-10 flex items-center px-3 border border-border rounded-md bg-muted/50 font-medium">
                    {driverReceives.toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="payment_status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payment Status</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Unpaid">Unpaid</SelectItem>
                          <SelectItem value="Paid">Paid</SelectItem>
                          <SelectItem value="Partial">Partial</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="payment_method"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payment Method</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select method" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Card">Card / Link</SelectItem>
                          <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                          <SelectItem value="Cash">Cash (To Driver)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="driver_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Assign Driver</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Unassigned" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="unassigned">Unassigned</SelectItem>
                          {drivers?.map((driver) => (
                            <SelectItem key={driver.id} value={driver.id}>
                              {driver.name} ({driver.vehicle_type})
                            </SelectItem>
                          ))}
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
                    <FormLabel>Internal Notes (Not shown to driver/client)</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Operator notes..." className="resize-none" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Button type="submit" className="w-full h-12" disabled={createBooking.isPending}>
            {createBooking.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Booking
          </Button>
        </form>
      </Form>
    </div>
  );
}

// Temporary Label component definition since we aren't importing it properly from ui/label
function Label({ children, htmlFor }: { children: React.ReactNode, htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">{children}</label>;
}
