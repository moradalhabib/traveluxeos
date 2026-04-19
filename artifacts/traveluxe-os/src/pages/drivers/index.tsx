import { useListDrivers, getListDriversQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, MessageSquare, Star, Car } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useState } from "react";

export default function Drivers() {
  const [search, setSearch] = useState("");
  const { data: drivers, isLoading } = useListDrivers(
    {}, 
    { query: { enabled: true, queryKey: getListDriversQueryKey({}) } }
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Drivers</h1>
        <Link href="/drivers/new">
          <Button className="w-full sm:w-auto h-12 shadow-[0_0_10px_rgba(201,168,76,0.2)]">
            <Plus className="w-4 h-4 mr-2" />
            Add Driver
          </Button>
        </Link>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground" />
        <Input 
          placeholder="Search drivers..." 
          className="pl-10 h-12 text-lg border-primary/20 bg-card"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          [...Array(6)].map((_, i) => <Skeleton key={i} className="h-32" />)
        ) : drivers?.map((driver) => (
          <Card key={driver.id} className="border-primary/10 hover:border-primary/30 transition-colors bg-card overflow-hidden flex flex-col">
            <CardContent className="p-5 flex-1 flex flex-col">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-lg text-foreground">{driver.name}</h3>
                    {(driver as any).staff_no && (
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/30">
                        {(driver as any).staff_no}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                    <Car className="w-3 h-3" />
                    {driver.vehicle_type} - {driver.plate || 'No plate'}
                  </div>
                </div>
                <Badge variant="outline" className={driver.status === 'Active' ? 'bg-green-500/20 text-green-500 border-green-500/50' : 'bg-secondary text-secondary-foreground'}>
                  {driver.status}
                </Badge>
              </div>
              
              <div className="mt-auto grid grid-cols-2 gap-2 text-sm text-muted-foreground mb-4">
                <div>
                  <span className="block text-xs uppercase opacity-70">Total Jobs</span>
                  <span className="font-medium text-foreground">{driver.total_jobs || 0}</span>
                </div>
                <div>
                  <span className="block text-xs uppercase opacity-70">Rating</span>
                  <span className="font-medium text-primary flex items-center gap-1">
                    {driver.avg_rating?.toFixed(1) || '0.0'} <Star className="w-3 h-3 fill-primary" />
                  </span>
                </div>
              </div>
              
              <div className="flex gap-2 mt-auto pt-4 border-t border-border/50">
                <Link href={`/drivers/${driver.id}`} className="flex-1">
                  <Button variant="outline" className="w-full h-10">View Profile</Button>
                </Link>
                {driver.whatsapp && (
                  <a 
                    href={`https://wa.me/${driver.whatsapp.replace(/\D/g, '')}`}
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex-1"
                  >
                    <Button variant="secondary" className="w-full h-10 bg-green-900/20 text-green-500 hover:bg-green-900/40 border border-green-900/50">
                      <MessageSquare className="w-4 h-4 mr-2" />
                      Chat
                    </Button>
                  </a>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
