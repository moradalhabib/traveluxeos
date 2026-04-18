import { useState } from "react";
import { useListQuotes, getListQuotesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, FileText, CalendarRange } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { format } from "date-fns";

export default function Quotes() {
  const [status, setStatus] = useState<string>("");
  
  const { data: quotes, isLoading } = useListQuotes(
    { status: status || undefined },
    { query: { enabled: true, queryKey: getListQuotesQueryKey({ status: status || undefined }) } }
  );

  const getStatusColor = (s: string) => {
    switch (s) {
      case 'Accepted': return 'bg-green-500/20 text-green-500 border-green-500/50';
      case 'Declined': return 'bg-destructive/20 text-destructive border-destructive/50';
      case 'Sent': return 'bg-blue-500/20 text-blue-500 border-blue-500/50';
      case 'Expired': return 'bg-gray-500/20 text-gray-500 border-gray-500/50';
      default: return 'bg-amber-500/20 text-amber-500 border-amber-500/50'; // Pending
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Quotes</h1>
        <Link href="/quotes/new">
          <Button className="w-full sm:w-auto h-12 shadow-[0_0_10px_rgba(201,168,76,0.2)]">
            <Plus className="w-4 h-4 mr-2" />
            New Quote
          </Button>
        </Link>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        <Button variant={status === "" ? "default" : "outline"} onClick={() => setStatus("")}>All</Button>
        <Button variant={status === "Pending" ? "default" : "outline"} onClick={() => setStatus("Pending")}>Pending</Button>
        <Button variant={status === "Sent" ? "default" : "outline"} onClick={() => setStatus("Sent")}>Sent</Button>
        <Button variant={status === "Accepted" ? "default" : "outline"} onClick={() => setStatus("Accepted")}>Accepted</Button>
        <Button variant={status === "Declined" ? "default" : "outline"} onClick={() => setStatus("Declined")}>Declined</Button>
        <Button variant={status === "Expired" ? "default" : "outline"} onClick={() => setStatus("Expired")}>Expired</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          [...Array(6)].map((_, i) => <Skeleton key={i} className="h-48" />)
        ) : quotes?.map((quote) => (
          <Card key={quote.id} className="border-primary/10 hover:border-primary/30 transition-colors bg-card overflow-hidden flex flex-col">
            <CardContent className="p-5 flex-1 flex flex-col">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-bold text-lg text-foreground">{quote.client_name || 'Unknown Client'}</h3>
                  <div className="text-sm text-muted-foreground mt-1 flex items-center">
                    <CalendarRange className="w-3 h-3 mr-1" />
                    {quote.date_time ? format(new Date(quote.date_time), 'PPp') : 'TBD'}
                  </div>
                </div>
                <Badge variant="outline" className={getStatusColor(quote.status)}>
                  {quote.status}
                </Badge>
              </div>
              
              <div className="mt-auto grid grid-cols-2 gap-2 text-sm text-muted-foreground mb-4">
                <div>
                  <span className="block text-xs uppercase opacity-70">Service</span>
                  <span className="font-medium text-foreground">{quote.service_type}</span>
                </div>
                <div>
                  <span className="block text-xs uppercase opacity-70">Price</span>
                  <span className="font-medium text-primary">£{quote.price.toLocaleString()}</span>
                </div>
              </div>
              
              <div className="flex gap-2 mt-auto pt-4 border-t border-border/50">
                <Link href={`/quotes/${quote.id}`} className="flex-1">
                  <Button variant="outline" className="w-full h-10">
                    <FileText className="w-4 h-4 mr-2" />
                    View Quote
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
        {quotes?.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground border border-dashed rounded-lg">
            No quotes found.
          </div>
        )}
      </div>
    </div>
  );
}
