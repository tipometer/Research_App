import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

// Pages
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import NewResearch from "./pages/NewResearch";
import ResearchProgress from "./pages/ResearchProgress";
import ResearchReport from "./pages/ResearchReport";
import Brainstorm from "./pages/Brainstorm";
import Billing from "./pages/Billing";
import AdminPanel from "./pages/AdminPanel";
import ShareReport from "./pages/ShareReport";
import SurveyPage from "./pages/SurveyPage";
import Profile from "./pages/Profile";

function Router() {
  return (
    <Switch>
      {/* Public routes */}
      <Route path="/" component={Home} />
      <Route path="/share/:token" component={ShareReport} />
      <Route path="/survey/:token" component={SurveyPage} />

      {/* Protected app routes */}
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/research/new" component={NewResearch} />
      <Route path="/research/:id/progress" component={ResearchProgress} />
      <Route path="/research/:id" component={ResearchReport} />
      <Route path="/brainstorm" component={Brainstorm} />
      <Route path="/billing" component={Billing} />
      <Route path="/admin" component={AdminPanel} />
      <Route path="/profile" component={Profile} />

      {/* Fallback */}
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
