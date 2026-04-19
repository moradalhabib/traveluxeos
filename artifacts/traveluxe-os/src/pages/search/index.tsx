import { useState, useEffect } from "react";
import { useGlobalSearch, getGlobalSearchQueryKey } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Search as SearchIcon, Users, Briefcase, Car, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";

export default function Search() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(timer);
  }, [q]);

  const { data: results, isLoading } = useGlobalSearch(
    { q: debouncedQ }, 
    { query: { enabled: debouncedQ.length > 2, queryKey: getGlobalSearchQueryKey({ q: debouncedQ }) } }
  );

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Global Search</h1>

      <div className="relative">
        <SearchIcon className="absolute left-4 top-4 h-6 w-6 text-muted-foreground" />
        <Input 
          placeholder="Search by name, reference, phone, email..." 
          className="pl-14 h-14 text-xl border-primary/30 bg-card shadow-[0_0_15px_rgba(201,168,76,0.1)] focus-visible:ring-primary"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        {isLoading && debouncedQ.length > 2 && (
          <Loader2 className="absolute right-4 top-4 h-6 w-6 animate-spin text-primary" />
        )}
      </div>

      {debouncedQ.length > 2 && !isLoading && results && (
        <div className="space-y-6 mt-8">
          {results.clients?.length > 0 && (
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2 mb-4 text-foreground/80">
                <Users className="w-5 h-5" /> Clients
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {results.clients.map(client => (
                  <Link key={client.id} href={`/clients/${client.id}`}>
                    <Card className="border-border hover:border-primary/50 hover:bg-secondary/20 transition-colors cursor-pointer bg-card">
                      <CardContent className="p-4 flex justify-between items-center">
                        <div>
                          <div className="font-bold">{client.name}</div>
                          <div className="text-sm text-muted-foreground">{client.whatsapp}</div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {results.bookings?.length > 0 && (
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2 mb-4 text-foreground/80 mt-8">
                <Briefcase className="w-5 h-5" /> Bookings
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {results.bookings.map(booking => (
                  <Link key={booking.id} href={`/bookings/${booking.id}`}>
                    <Card className="border-border hover:border-primary/50 hover:bg-secondary/20 transition-colors cursor-pointer bg-card">
                      <CardContent className="p-4 flex justify-between items-center">
                        <div>
                          <div className="font-mono text-xs text-muted-foreground">{booking.tvl_ref}</div>
                          <div className="font-bold">{booking.client_name}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm">{booking.status}</div>
                          <div className="text-sm font-bold text-primary">£{booking.price}</div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {results.drivers?.length > 0 && (
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2 mb-4 text-foreground/80 mt-8">
                <Car className="w-5 h-5" /> Drivers
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {results.drivers.map(driver => (
                  <Link key={driver.id} href={`/drivers/${driver.id}`}>
                    <Card className="border-border hover:border-primary/50 hover:bg-secondary/20 transition-colors cursor-pointer bg-card">
                      <CardContent className="p-4 flex justify-between items-center">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold">{driver.name}</span>
                            {(driver as any).staff_no && (
                              <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30 font-semibold">
                                {(driver as any).staff_no}
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">{driver.vehicle_type}</div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {results.clients.length === 0 && results.bookings.length === 0 && results.drivers.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No results found for "{debouncedQ}"
            </div>
          )}
        </div>
      )}

      {debouncedQ.length <= 2 && debouncedQ.length > 0 && (
        <div className="text-center py-12 text-muted-foreground">
          Type at least 3 characters to search...
        </div>
      )}
    </div>
  );
}
