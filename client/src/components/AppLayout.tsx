import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { useTheme } from "@/contexts/ThemeContext";
import {
  BarChart3,
  BookOpen,
  ChevronRight,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Moon,
  Plus,
  Settings,
  Shield,
  Sun,
  User,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface AppLayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { href: "/dashboard", icon: LayoutDashboard, key: "nav.dashboard" },
  { href: "/research/new", icon: Plus, key: "nav.newResearch" },
  { href: "/brainstorm", icon: Zap, key: "nav.brainstorm" },
  { href: "/billing", icon: CreditCard, key: "nav.billing" },
];

const adminItems = [
  { href: "/admin", icon: Shield, key: "nav.admin" },
];

export function AppLayout({ children }: AppLayoutProps) {
  const { user, isAuthenticated, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { t, i18n } = useTranslation();
  const [location] = useLocation();
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => { logout(); window.location.href = "/"; },
  });

  const toggleLang = () => {
    const newLang = i18n.language === "hu" ? "en" : "hu";
    i18n.changeLanguage(newLang);
    localStorage.setItem("lang", newLang);
  };

  if (!isAuthenticated) {
    window.location.href = getLoginUrl();
    return null;
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 flex flex-col bg-sidebar border-r border-sidebar-border">
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-bold text-lg text-sidebar-foreground tracking-tight">
            Deep Research
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.href || location.startsWith(item.href + "/");
            return (
              <Link key={item.href} href={item.href}>
                <a
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <item.icon className="w-4 h-4 flex-shrink-0" />
                  {t(item.key)}
                </a>
              </Link>
            );
          })}

          {user?.role === "admin" && (
            <>
              <div className="pt-4 pb-1 px-3">
                <p className="text-xs font-semibold text-sidebar-foreground/40 uppercase tracking-wider">Admin</p>
              </div>
              {adminItems.map((item) => {
                const isActive = location === item.href;
                return (
                  <Link key={item.href} href={item.href}>
                    <a
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                        isActive
                          ? "bg-sidebar-primary text-sidebar-primary-foreground"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      )}
                    >
                      <item.icon className="w-4 h-4 flex-shrink-0" />
                      {t(item.key)}
                    </a>
                  </Link>
                );
              })}
            </>
          )}
        </nav>

        {/* Bottom section */}
        <div className="px-3 py-4 border-t border-sidebar-border space-y-2">
          {/* Credits badge */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sidebar-accent">
            <CreditCard className="w-4 h-4 text-sidebar-primary" />
            <span className="text-xs text-sidebar-foreground/70">{t("dashboard.credits")}</span>
            <span className="ml-auto text-sm font-bold text-sidebar-primary">
              {(user as any)?.credits ?? 0}
            </span>
          </div>

          {/* Theme + Lang toggles */}
          <div className="flex items-center gap-2 px-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleTheme}
              className="flex-1 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleLang}
              className="flex-1 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent text-xs font-bold"
            >
              {i18n.language === "hu" ? "EN" : "HU"}
            </Button>
          </div>

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-sidebar-accent transition-colors">
                <Avatar className="w-8 h-8">
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                    {user?.name?.charAt(0)?.toUpperCase() ?? "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm font-medium text-sidebar-foreground truncate">{user?.name ?? "User"}</p>
                  <p className="text-xs text-sidebar-foreground/50 truncate">{user?.email ?? ""}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-sidebar-foreground/40 flex-shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem asChild>
                <Link href="/profile">
                  <a className="flex items-center gap-2 w-full">
                    <User className="w-4 h-4" />
                    {t("nav.profile")}
                  </a>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => logoutMutation.mutate()}
                className="text-destructive focus:text-destructive"
              >
                <LogOut className="w-4 h-4 mr-2" />
                {t("nav.logout")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
