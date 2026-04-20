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
import Analytics from "@/pages/analytics/index";
import Marketing from "@/pages/marketing/index";

const queryClient = new QueryClient();

// Routes the residence_manager cannot access
const RESIDENCE_MANAGER_BLOCKED = [
  "/", "/jobs", "/quotes", "/quotes/new", "/flights",
  "/drivers", "/commissions", "/messages", "/finance",
  "/invoices", "/search", "/services", "/admin", "/marketing",
];

function ProtectedRoute({
  component: Component,
  reqAdmin = false,
  reqSuperAdmin = false,
  blockResidenceManager = false,
  ...rest
}: any) {
  const { user } = useAuth();

  if (!user) return <Redirect to="/login" />;

  const isResidenceManager = user.role === "residence_manager";

  // super_admin-only routes (e.g. Finance)
  if (reqSuperAdmin && user.role !== "super_admin") {
    return <Redirect to={isResidenceManager ? "/bookings" : "/"} />;
  }

  // admin+ routes
  if (reqAdmin && user.role !== "admin" && user.role !== "super_admin") {
    return <Redirect to={isResidenceManager ? "/bookings" : "/"} />;
  }

  // Routes blocked for residence_manager
  if (blockResidenceManager && isResidenceManager) {
    return <Redirect to="/bookings" />;
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

      <ProtectedRoute path="/" component={Dashboard} blockResidenceManager={true} />
      <ProtectedRoute path="/clients" component={Clients} />
      <ProtectedRoute path="/clients/new" component={NewClient} blockResidenceManager={true} />
      <ProtectedRoute path="/clients/:id" component={ClientDetail} />
      <ProtectedRoute path="/quotes" component={Quotes} blockResidenceManager={true} />
      <ProtectedRoute path="/quotes/new" component={NewQuote} blockResidenceManager={true} />
      <ProtectedRoute path="/quotes/:id" component={QuoteDetail} blockResidenceManager={true} />
      <ProtectedRoute path="/bookings" component={Bookings} />
      <ProtectedRoute path="/bookings/new" component={NewBooking} blockResidenceManager={true} />
      <ProtectedRoute path="/bookings/:id" component={BookingDetail} />
      <ProtectedRoute path="/jobs" component={Jobs} blockResidenceManager={true} />
      <ProtectedRoute path="/flights" component={Flights} blockResidenceManager={true} />
      <ProtectedRoute path="/drivers" component={Drivers} blockResidenceManager={true} />
      <ProtectedRoute path="/drivers/new" component={NewDriver} blockResidenceManager={true} />
      <ProtectedRoute path="/drivers/:id" component={DriverDetail} blockResidenceManager={true} />
      <ProtectedRoute path="/commissions" component={Commissions} blockResidenceManager={true} />
      <ProtectedRoute path="/messages" component={Messages} blockResidenceManager={true} />
      <ProtectedRoute path="/finance" component={Finance} reqSuperAdmin={true} />
      <ProtectedRoute path="/invoices" component={Invoices} blockResidenceManager={true} />
      <ProtectedRoute path="/invoices/:id" component={InvoiceDetail} blockResidenceManager={true} />
      <ProtectedRoute path="/search" component={Search} blockResidenceManager={true} />
      <ProtectedRoute path="/services" component={Services} blockResidenceManager={true} />
      <ProtectedRoute path="/analytics" component={Analytics} blockResidenceManager={true} />
      <ProtectedRoute path="/admin" component={Admin} reqAdmin={true} />
      <ProtectedRoute path="/marketing" component={Marketing} reqAdmin={true} />

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
