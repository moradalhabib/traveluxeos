import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Shell } from "@/components/layout/Shell";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { supabase } from "@/lib/supabase";

// Forward Supabase JWT to the API server so all mutations pass RLS
setAuthTokenGetter(() =>
  supabase.auth.getSession().then(r => r.data.session?.access_token ?? null)
);

import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Clients from "@/pages/clients/index";
import NewClient from "@/pages/clients/new";
import ClientDetail from "@/pages/clients/[id]";
import Quotes from "@/pages/quotes/index";
import NewQuote from "@/pages/quotes/new";
import QuoteDetail from "@/pages/quotes/[id]";
import Bookings from "@/pages/bookings/index";
import NewBooking from "@/pages/bookings/new";
import BookingDetail from "@/pages/bookings/[id]";
import Jobs from "@/pages/jobs/index";
import Flights from "@/pages/flights/index";
import Drivers from "@/pages/drivers/index";
import NewDriver from "@/pages/drivers/new";
import DriverDetail from "@/pages/drivers/[id]";
import Commissions from "@/pages/commissions/index";
import Messages from "@/pages/messages/index";
import Finance from "@/pages/finance/index";
import Invoices from "@/pages/invoices/index";
import InvoiceDetail from "@/pages/invoices/[id]";
import Search from "@/pages/search/index";
import Admin from "@/pages/admin/index";
import Services from "@/pages/services/index";

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component, reqAdmin = false, ...rest }: any) {
  const { user, isLocked } = useAuth();

  if (!user) return <Redirect to="/login" />;
  // Locked sessions show an overlay inside Shell — not a redirect

  // super_admin has full unrestricted access to all modules
  // Admin-only routes block operators, but both admin and super_admin can access
  if (reqAdmin && user.role !== "admin" && user.role !== "super_admin") {
    return <Redirect to="/" />;
  }

  return (
    <Route {...rest}>
      <Shell>
        <Component />
      </Shell>
    </Route>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />

      <ProtectedRoute path="/" component={Dashboard} />
      <ProtectedRoute path="/clients" component={Clients} />
      <ProtectedRoute path="/clients/new" component={NewClient} />
      <ProtectedRoute path="/clients/:id" component={ClientDetail} />
      <ProtectedRoute path="/quotes" component={Quotes} />
      <ProtectedRoute path="/quotes/new" component={NewQuote} />
      <ProtectedRoute path="/quotes/:id" component={QuoteDetail} />
      <ProtectedRoute path="/bookings" component={Bookings} />
      <ProtectedRoute path="/bookings/new" component={NewBooking} />
      <ProtectedRoute path="/bookings/:id" component={BookingDetail} />
      <ProtectedRoute path="/jobs" component={Jobs} />
      <ProtectedRoute path="/flights" component={Flights} />
      <ProtectedRoute path="/drivers" component={Drivers} />
      <ProtectedRoute path="/drivers/new" component={NewDriver} />
      <ProtectedRoute path="/drivers/:id" component={DriverDetail} />
      <ProtectedRoute path="/commissions" component={Commissions} />
      <ProtectedRoute path="/messages" component={Messages} />
      <ProtectedRoute path="/finance" component={Finance} reqAdmin={true} />
      <ProtectedRoute path="/invoices" component={Invoices} />
      <ProtectedRoute path="/invoices/:id" component={InvoiceDetail} />
      <ProtectedRoute path="/search" component={Search} />
      <ProtectedRoute path="/services" component={Services} />
      <ProtectedRoute path="/admin" component={Admin} reqAdmin={true} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
