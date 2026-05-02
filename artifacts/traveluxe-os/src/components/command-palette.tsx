import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  useGlobalSearch,
  getGlobalSearchQueryKey,
  type Booking,
} from "@workspace/api-client-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  Briefcase,
  Users,
  Car,
  Building2,
  Loader2,
} from "lucide-react";

// Europe/London is the operational tz for the business; show dates in that
// tz so "12 May" lines up with what an operator would say on the phone even
// if the device clock is in Egypt.
const LONDON_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/London",
});

function formatBookingSubtitle(b: Booking) {
  const parts: string[] = [];
  if (b.tvl_ref) parts.push(b.tvl_ref);
  if (b.date_time) {
    const d = new Date(b.date_time);
    if (!Number.isNaN(d.getTime())) parts.push(LONDON_DATE.format(d));
  }
  if (b.pickup && b.dropoff) parts.push(`${b.pickup} → ${b.dropoff}`);
  else if (b.pickup) parts.push(b.pickup);
  if (b.flight_number) parts.push(b.flight_number);
  return parts.join(" · ");
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [, setLocation] = useLocation();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  // Reset state on close so the next open starts blank — we explicitly do
  // NOT persist recent queries (privacy: don't leak who an operator viewed).
  useEffect(() => {
    if (!open) {
      setQ("");
      setDebouncedQ("");
    }
  }, [open]);

  // 200ms debounce per the spec.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const enabled = debouncedQ.length >= 2;
  const { data, isFetching, isError } = useGlobalSearch(
    { q: debouncedQ, limit: 5 },
    {
      query: {
        enabled,
        queryKey: getGlobalSearchQueryKey({ q: debouncedQ, limit: 5 }),
        staleTime: 30_000,
      },
    },
  );

  const navigate = (path: string) => {
    setLocation(path);
    onOpenChange(false);
  };

  const isEmpty =
    enabled &&
    !isFetching &&
    data &&
    !data.bookings.length &&
    !data.clients.length &&
    !data.drivers.length &&
    !data.suppliers.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="
          gap-0 p-0 overflow-hidden border-primary/20
          sm:max-w-2xl
          max-w-none w-screen h-[100dvh] sm:h-auto sm:max-h-[80vh]
          rounded-none sm:rounded-lg
          left-0 top-0 translate-x-0 translate-y-0
          sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%]
          [&>button[type='button']:last-child]:hidden
        "
      >
        {/* shouldFilter=false: results come pre-filtered from the server, so
            we don't want cmdk's built-in fuzzy filter throwing rows away. */}
        <Command shouldFilter={false} loop>
          <div className="flex items-center border-b px-3 gap-2">
            <CommandInput
              autoFocus
              value={q}
              onValueChange={setQ}
              placeholder="Search bookings, clients, drivers, suppliers…"
              className="flex-1"
              data-testid="palette-input"
            />
            {isFetching && enabled && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
            )}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="sm:hidden text-sm font-medium text-primary px-2 py-1 shrink-0"
              data-testid="palette-cancel"
            >
              Cancel
            </button>
          </div>

          <CommandList className="max-h-[calc(100dvh-3.5rem)] sm:max-h-[60vh]">
            {!enabled && (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                Type a TVL ref, client, driver, or supplier name
              </div>
            )}

            {enabled && isError && (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                Couldn't search right now — try again
              </div>
            )}

            {enabled && isFetching && !data && (
              <div className="space-y-2 p-3" aria-label="Loading results">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-12 rounded-md bg-muted/40 animate-pulse"
                  />
                ))}
              </div>
            )}

            {enabled && data && isEmpty && (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                No matches for "{debouncedQ}"
              </div>
            )}

            {enabled && data && !isEmpty && (
              <>
                {data.bookings.length > 0 && (
                  <CommandGroup heading="Bookings">
                    {data.bookings.map((b) => (
                      <CommandItem
                        key={b.id}
                        value={`booking-${b.id}-${b.tvl_ref}-${b.client_name ?? ""}`}
                        onSelect={() => navigate(`/bookings/${b.id}`)}
                        data-testid={`palette-booking-${b.id}`}
                      >
                        <Briefcase className="text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">
                            {b.client_name ?? "Unassigned"}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            Booking · {formatBookingSubtitle(b) || "—"}
                          </div>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {data.clients.length > 0 && (
                  <CommandGroup heading="Clients">
                    {data.clients.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={`client-${c.id}-${c.name}`}
                        onSelect={() => navigate(`/clients/${c.id}`)}
                        data-testid={`palette-client-${c.id}`}
                      >
                        <Users className="text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{c.name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            Client ·{" "}
                            {[c.whatsapp, c.email].filter(Boolean).join(" · ") ||
                              "—"}
                          </div>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {data.drivers.length > 0 && (
                  <CommandGroup heading="Drivers">
                    {data.drivers.map((d) => (
                      <CommandItem
                        key={d.id}
                        value={`driver-${d.id}-${d.name}`}
                        onSelect={() => navigate(`/drivers/${d.id}`)}
                        data-testid={`palette-driver-${d.id}`}
                      >
                        <Car className="text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{d.name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            Driver ·{" "}
                            {[d.plate, d.vehicle_model]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </div>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {data.suppliers.length > 0 && (
                  <CommandGroup heading="Suppliers">
                    {data.suppliers.map((s) => (
                      <CommandItem
                        key={s.id}
                        value={`supplier-${s.id}-${s.company_name}`}
                        onSelect={() => navigate(`/suppliers/${s.id}`)}
                        data-testid={`palette-supplier-${s.id}`}
                      >
                        <Building2 className="text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">
                            {s.company_name}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            Supplier ·{" "}
                            {s.primary_service_type ?? s.contact_name ?? "—"}
                          </div>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
