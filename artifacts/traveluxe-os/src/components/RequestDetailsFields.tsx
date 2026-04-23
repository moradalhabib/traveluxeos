import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export type RequestDetails = Record<string, any>;

interface Props {
  serviceType: string;
  value: RequestDetails;
  onChange: (next: RequestDetails) => void;
}

export function RequestDetailsFields({ serviceType, value, onChange }: Props) {
  const v = value || {};
  const set = (key: string, val: any) => onChange({ ...v, [key]: val });

  if (serviceType === "Airport Transfer") {
    return (
      <div className="rounded-md border border-border/60 bg-secondary/10 p-3 space-y-3">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Airport Transfer details</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Direction</Label>
            <Select value={v.direction ?? ""} onValueChange={(x) => set("direction", x)}>
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Arrival">Arrival</SelectItem>
                <SelectItem value="Departure">Departure</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Airport Code</Label>
            <Input value={v.airport_code ?? ""} onChange={(e) => set("airport_code", e.target.value.toUpperCase())} placeholder="LHR / LGW / STN" />
          </div>
          <div>
            <Label className="text-xs">Pickup</Label>
            <Input value={v.pickup ?? ""} onChange={(e) => set("pickup", e.target.value)} placeholder="Hotel, address…" />
          </div>
          <div>
            <Label className="text-xs">Drop-off</Label>
            <Input value={v.dropoff ?? ""} onChange={(e) => set("dropoff", e.target.value)} placeholder="Airport terminal / address" />
          </div>
          <div>
            <Label className="text-xs">Flight Number</Label>
            <Input value={v.flight_number ?? ""} onChange={(e) => set("flight_number", e.target.value.toUpperCase())} placeholder="BA123" />
          </div>
          <div>
            <Label className="text-xs">Vehicle Type</Label>
            <Input value={v.vehicle_type ?? ""} onChange={(e) => set("vehicle_type", e.target.value)} placeholder="S-Class, V-Class…" />
          </div>
          <div>
            <Label className="text-xs">Passengers</Label>
            <Input type="number" min="1" value={v.passengers ?? ""} onChange={(e) => set("passengers", e.target.value === "" ? null : Number(e.target.value))} />
          </div>
          <div>
            <Label className="text-xs">Luggage</Label>
            <Input type="number" min="0" value={v.luggage ?? ""} onChange={(e) => set("luggage", e.target.value === "" ? null : Number(e.target.value))} />
          </div>
        </div>
      </div>
    );
  }

  if (serviceType === "Car Rental") {
    return (
      <div className="rounded-md border border-border/60 bg-secondary/10 p-3 space-y-3">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Car Rental details</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Vehicle Type</Label>
            <Input value={v.vehicle_type ?? ""} onChange={(e) => set("vehicle_type", e.target.value)} placeholder="Range Rover, Cullinan…" />
          </div>
          <div>
            <Label className="text-xs">Rental Days</Label>
            <Input type="number" min="1" value={v.rental_days ?? ""} onChange={(e) => set("rental_days", e.target.value === "" ? null : Number(e.target.value))} />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Pickup Location</Label>
            <Input value={v.pickup ?? ""} onChange={(e) => set("pickup", e.target.value)} placeholder="Hotel, address…" />
          </div>
        </div>
      </div>
    );
  }

  if (serviceType === "Tour") {
    return (
      <div className="rounded-md border border-border/60 bg-secondary/10 p-3 space-y-3">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Tour details</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-xs">Destination</Label>
            <Input value={v.destination ?? ""} onChange={(e) => set("destination", e.target.value)} placeholder="Windsor, Stonehenge…" />
          </div>
          <div>
            <Label className="text-xs">Pickup</Label>
            <Input value={v.pickup ?? ""} onChange={(e) => set("pickup", e.target.value)} placeholder="Hotel, address…" />
          </div>
          <div>
            <Label className="text-xs">Passengers</Label>
            <Input type="number" min="1" value={v.passengers ?? ""} onChange={(e) => set("passengers", e.target.value === "" ? null : Number(e.target.value))} />
          </div>
        </div>
      </div>
    );
  }

  if (serviceType === "Hotel" || serviceType === "Apartment") {
    const label = serviceType === "Hotel" ? "Hotel" : "Apartment";
    return (
      <div className="rounded-md border border-border/60 bg-secondary/10 p-3 space-y-3">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label} details</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-xs">{label} Name</Label>
            <Input value={v.hotel_name ?? ""} onChange={(e) => set("hotel_name", e.target.value)} placeholder="The Dorchester…" />
          </div>
          <div>
            <Label className="text-xs">Check-in</Label>
            <Input type="date" value={v.check_in ?? ""} onChange={(e) => set("check_in", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Check-out</Label>
            <Input type="date" value={v.check_out ?? ""} onChange={(e) => set("check_out", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Nights</Label>
            <Input type="number" min="1" value={v.nights ?? ""} onChange={(e) => set("nights", e.target.value === "" ? null : Number(e.target.value))} />
          </div>
          <div>
            <Label className="text-xs">Guests</Label>
            <Input type="number" min="1" value={v.passengers ?? ""} onChange={(e) => set("passengers", e.target.value === "" ? null : Number(e.target.value))} />
          </div>
        </div>
      </div>
    );
  }

  return null;
}
