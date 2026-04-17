import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Plus, Zap, Clock, CheckCircle2, XCircle, Loader2, ChevronRight, BarChart3 } from "lucide-react";
import { DogMascot } from "@/components/DogMascot";

const mockResearches = [
  { id: "1", nicheName: "AI önéletrajz készítő", strategy: "gaps", status: "done", verdict: "GO", createdAt: "2026-04-16", score: 8.2 },
  { id: "2", nicheName: "Beer & Dumbbell Coach", strategy: "gaps", status: "done", verdict: "CONDITIONAL", createdAt: "2026-04-15", score: 6.1 },
  { id: "3", nicheName: "Vegán étterem kereső", strategy: "predator", status: "running", verdict: null, createdAt: "2026-04-17", score: null },
  { id: "4", nicheName: "Freelancer időkövetés", strategy: "provisioning", status: "failed", verdict: null, createdAt: "2026-04-14", score: null },
];

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const config: Record<string, { icon: React.ReactNode; className: string }> = {
    pending: { icon: <Clock className="w-3 h-3" />, className: "bg-muted text-muted-foreground" },
    running: { icon: <Loader2 className="w-3 h-3 animate-spin" />, className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
    done: { icon: <CheckCircle2 className="w-3 h-3" />, className: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
    failed: { icon: <XCircle className="w-3 h-3" />, className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  };
  const c = config[status] ?? config.pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${c.className}`}>
      {c.icon}
      {t(`dashboard.status.${status}`)}
    </span>
  );
}

function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return null;
  const cls = verdict === "GO" ? "verdict-go" : verdict === "KILL" ? "verdict-kill" : "verdict-conditional";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${cls}`}>
      {verdict}
    </span>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();

  return (
    <AppLayout>
      <div className="p-8 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">{t("dashboard.title")}</h1>
            <p className="text-muted-foreground text-sm mt-1">Üdvözöllek! Indíts új kutatást vagy folytasd a régit.</p>
          </div>
          <Link href="/research/new">
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              {t("dashboard.newResearch")}
            </Button>
          </Link>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Összes kutatás", value: "4", icon: BarChart3, color: "text-blue-500" },
            { label: "Befejezett", value: "2", icon: CheckCircle2, color: "text-green-500" },
            { label: "Kredit egyenleg", value: "12", icon: Zap, color: "text-yellow-500" },
            { label: "GO verdikt", value: "1", icon: ChevronRight, color: "text-primary" },
          ].map((stat) => (
            <Card key={stat.label} className="border-border">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                    <p className="text-2xl font-bold mt-1">{stat.value}</p>
                  </div>
                  <stat.icon className={`w-8 h-8 ${stat.color} opacity-70`} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Research list */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("dashboard.recentResearches")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {mockResearches.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-center">
                <DogMascot size={120} animate />
                <p className="mt-4 text-muted-foreground">{t("dashboard.noResearches")}</p>
                <Link href="/research/new">
                  <Button className="mt-4 gap-2">
                    <Plus className="w-4 h-4" />
                    {t("dashboard.newResearch")}
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {mockResearches.map((r) => (
                  <Link key={r.id} href={r.status === "running" ? `/research/${r.id}/progress` : `/research/${r.id}`}>
                    <a className="flex items-center gap-4 px-6 py-4 hover:bg-muted/40 transition-colors cursor-pointer">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{r.nicheName}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{r.createdAt}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <StatusBadge status={r.status} />
                        <VerdictBadge verdict={r.verdict} />
                        {r.score && (
                          <span className="text-sm font-bold text-primary">{r.score}/10</span>
                        )}
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </a>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
