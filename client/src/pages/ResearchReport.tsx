import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "react-i18next";
import { useParams } from "wouter";
import { useState } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  Calendar,
  Copy,
  Download,
  ExternalLink,
  FileText,
  GraduationCap,
  Link2,
  MessageSquare,
  Newspaper,
  Share2,
  Upload,
  Users,
  Zap,
} from "lucide-react";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

// Mock data
const MOCK_REPORT = {
  nicheName: "Beer & Dumbbell Coach — Kalóriaszámláló Hedonistáknak",
  verdict: "CONDITIONAL" as const,
  synthesisScore: 7.8,
  scores: {
    marketSize: 7,
    competition: 6,
    feasibility: 8,
    monetization: 7,
    timeliness: 9,
  },
  reportMarkdown: `## Összefoglalás

A **"Beer & Dumbbell Coach"** egy egyedülálló niche-t céloz meg: azokat a fitnesz-tudatos embereket, akik nem akarnak lemondani az alkoholról és a hedonista életmódról. Ez a szegmens jelenleg **alulszolgált** a piacon.

## Piaci lehetőség

A globális fitnesz alkalmazás piac 2025-ben **15,6 milliárd USD** értékű, és évi 17,6%-os növekedést mutat. Az alkohol-tudatos kalóriaszámláló szegmens szinte teljesen üres — a MyFitnessPal és a Lose It! csak marginálisan kezeli ezt a területet.

### Célközönség
- 25-40 éves, aktív életmódot folytató, de szociálisan aktív férfiak és nők
- "Flexible dieting" (IIFYM) követők
- Craft beer rajongók, akik fitnesz céljaikat is komolyan veszik

## Versenytárs elemzés

| Alkalmazás | Alkohol kezelés | Fitnesz coaching | Hedonista megközelítés |
|---|---|---|---|
| MyFitnessPal | Alap | Nincs | Nincs |
| Lose It! | Alap | Nincs | Nincs |
| Cronometer | Részletes | Nincs | Nincs |
| **Beer & Dumbbell** | **Kiemelkedő** | **Igen** | **Igen** |

## Monetizációs lehetőségek

1. **Freemium modell**: Ingyenes alap, $4.99/hó premium
2. **Craft brewery partnerségek**: Affiliate bevétel
3. **Coaching marketplace**: Személyi edzők a platformon

## Kockázatok

- A "hedonista" márkaüzenet megosztó lehet
- Az alkohol-kalória adatbázis karbantartása erőforrás-igényes
- Az egészségügyi szabályozás szigorodhat

## Következő lépések

1. Validálj 50 potenciális felhasználóval (kérdőív)
2. Építs egy MVP-t 3 hónap alatt
3. Tesztelj craft beer közösségekben (Reddit, Facebook csoportok)
`,
  sources: [
    { id: 1, title: "Fitness App Market Size & Forecast 2025", url: "https://statista.com", type: "industry", publishedAt: "2025-03", snippet: "A globális fitnesz alkalmazás piac 2025-ben 15,6 milliárd USD értékű." },
    { id: 2, title: "IIFYM: The Science of Flexible Dieting", url: "https://pubmed.ncbi.nlm.nih.gov", type: "academic", publishedAt: "2024-11", snippet: "Tudományos vizsgálat a rugalmas diéta hatékonyságáról." },
    { id: 3, title: "Craft Beer Market Trends 2025", url: "https://brewersassociation.org", type: "industry", publishedAt: "2025-01", snippet: "A craft sör piac 14,2 milliárd USD értékű az USA-ban." },
    { id: 4, title: "r/fitness: Beer and gains — community discussion", url: "https://reddit.com/r/fitness", type: "community", publishedAt: "2025-02", snippet: "Közösségi vita az alkohol és fitnesz kompatibilitásáról." },
    { id: 5, title: "MyFitnessPal App Store Reviews Analysis", url: "https://appfollow.io", type: "news", publishedAt: "2025-03", snippet: "Felhasználói visszajelzések elemzése — alkohol kezelés hiányosságai." },
    { id: 6, title: "How to Build a Fitness App: Developer Guide", url: "https://medium.com", type: "blog", publishedAt: "2024-12", snippet: "Lépésről lépésre útmutató fitnesz alkalmazás fejlesztéséhez." },
  ],
  shareToken: "abc123xyz",
};

const SOURCE_TYPE_CONFIG = {
  academic: { icon: GraduationCap, label: "academic", class: "source-academic" },
  industry: { icon: BookOpen, label: "industry", class: "source-industry" },
  news: { icon: Newspaper, label: "news", class: "source-news" },
  blog: { icon: FileText, label: "blog", class: "source-blog" },
  community: { icon: Users, label: "community", class: "source-community" },
};

function VerdictBadge({ verdict }: { verdict: "GO" | "KILL" | "CONDITIONAL" }) {
  const { t } = useTranslation();
  const cls = verdict === "GO" ? "verdict-go" : verdict === "KILL" ? "verdict-kill" : "verdict-conditional";
  return (
    <div className={cn("inline-flex flex-col items-center px-6 py-3 rounded-2xl", cls)}>
      <span className="text-3xl font-black tracking-widest">{t(`report.verdict.${verdict}`)}</span>
      <span className="text-xs font-medium mt-0.5 opacity-80">{t(`report.verdictDesc.${verdict}`)}</span>
    </div>
  );
}

function RadarScore({ scores }: { scores: typeof MOCK_REPORT.scores }) {
  const { t } = useTranslation();
  const data = [
    { axis: t("report.radarAxes.marketSize"), value: scores.marketSize, fullMark: 10 },
    { axis: t("report.radarAxes.competition"), value: scores.competition, fullMark: 10 },
    { axis: t("report.radarAxes.feasibility"), value: scores.feasibility, fullMark: 10 },
    { axis: t("report.radarAxes.monetization"), value: scores.monetization, fullMark: 10 },
    { axis: t("report.radarAxes.timeliness"), value: scores.timeliness, fullMark: 10 },
  ];
  return (
    <ResponsiveContainer width="100%" height={260}>
      <RadarChart data={data}>
        <PolarGrid stroke="var(--border)" />
        <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
        <Radar
          name="Score"
          dataKey="value"
          stroke="oklch(0.52 0.22 264)"
          fill="oklch(0.52 0.22 264)"
          fillOpacity={0.25}
          strokeWidth={2}
        />
        <Tooltip
          contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px", fontSize: 12 }}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

export default function ResearchReport() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [pollingActive, setPollingActive] = useState(false);
  const [responseCount] = useState(23);

  const report = MOCK_REPORT;

  const copyShareLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/share/${report.shareToken}`);
    toast.success(t("report.export.copied"));
  };

  const downloadMarkdown = () => {
    const blob = new Blob([report.reportMarkdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report.nicheName.replace(/\s+/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout>
      <div className="p-8 max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1">{report.nicheName}</h1>
          <p className="text-muted-foreground text-sm">Kutatási riport · {new Date().toLocaleDateString("hu-HU")}</p>
        </div>

        {/* Top row: Verdict + Radar + Actions */}
        <div className="grid lg:grid-cols-3 gap-6 mb-6">
          {/* Verdict */}
          <Card>
            <CardContent className="pt-6 pb-6 flex flex-col items-center gap-4">
              <VerdictBadge verdict={report.verdict} />
              <div className="text-center">
                <p className="text-4xl font-black text-primary">{report.synthesisScore}</p>
                <p className="text-xs text-muted-foreground">/ 10 összesített pontszám</p>
              </div>
              {/* Score breakdown */}
              <div className="w-full space-y-2">
                {Object.entries(report.scores).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-28 flex-shrink-0">
                      {t(`report.radarAxes.${key.replace(/([A-Z])/g, (m) => m.toLowerCase())}`)}
                    </span>
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${val * 10}%` }}
                      />
                    </div>
                    <span className="text-xs font-bold w-4 text-right">{val}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Radar chart */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">5-dimenziós értékelés</CardTitle>
            </CardHeader>
            <CardContent>
              <RadarScore scores={report.scores} />
            </CardContent>
          </Card>
        </div>

        {/* Export actions */}
        <div className="flex flex-wrap gap-2 mb-6">
          <Button variant="outline" size="sm" className="gap-2" onClick={downloadMarkdown}>
            <Download className="w-4 h-4" />
            {t("report.export.markdown")}
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => toast.info("PDF generálás... (hamarosan)")}>
            <FileText className="w-4 h-4" />
            {t("report.export.pdf")}
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={copyShareLink}>
            <Share2 className="w-4 h-4" />
            {t("report.export.share")}
          </Button>
        </div>

        <Tabs defaultValue="report">
          <TabsList className="mb-6">
            <TabsTrigger value="report">Riport</TabsTrigger>
            <TabsTrigger value="sources">{t("report.sources")} ({report.sources.length})</TabsTrigger>
            <TabsTrigger value="polling">{t("report.polling.title")}</TabsTrigger>
          </TabsList>

          {/* Report tab */}
          <TabsContent value="report">
            <Card>
              <CardContent className="pt-6">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <Streamdown>{report.reportMarkdown}</Streamdown>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Sources tab */}
          <TabsContent value="sources">
            <div className="space-y-3">
              {report.sources.map((source) => {
                const cfg = SOURCE_TYPE_CONFIG[source.type as keyof typeof SOURCE_TYPE_CONFIG];
                return (
                  <Card key={source.id}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-start gap-3">
                        <div className={cn("p-2 rounded-lg flex-shrink-0", cfg.class)}>
                          <cfg.icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", cfg.class)}>
                              {t(`report.sourceTypes.${cfg.label}`)}
                            </span>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Calendar className="w-3 h-3" />
                              {source.publishedAt}
                            </span>
                          </div>
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-sm hover:text-primary transition-colors flex items-center gap-1"
                          >
                            {source.title}
                            <ExternalLink className="w-3 h-3 flex-shrink-0" />
                          </a>
                          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{source.snippet}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          {/* Polling tab */}
          <TabsContent value="polling">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("report.polling.title")}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Generálj AI-alapú kérdőívet, oszd meg a közösségedben, és frissítsd a kutatást a valós visszajelzések alapján.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!pollingActive ? (
                    <Button className="gap-2" onClick={() => setPollingActive(true)}>
                      <MessageSquare className="w-4 h-4" />
                      {t("report.polling.start")}
                    </Button>
                  ) : (
                    <div className="space-y-4">
                      {/* Survey link */}
                      <div className="flex items-center gap-2 p-3 bg-muted/40 rounded-lg border border-border">
                        <Link2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <code className="text-xs flex-1 truncate">{window.location.origin}/survey/survey-abc123</code>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex-shrink-0 gap-1"
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/survey/survey-abc123`);
                            toast.success(t("report.export.copied"));
                          }}
                        >
                          <Copy className="w-3 h-3" />
                          {t("report.polling.shareLink")}
                        </Button>
                      </div>

                      {/* Response counter */}
                      <div className="flex items-center gap-3 p-4 bg-primary/5 rounded-xl border border-primary/20">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <Users className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <p className="text-2xl font-bold text-primary">{responseCount}</p>
                          <p className="text-xs text-muted-foreground">{t("report.polling.responses")}</p>
                        </div>
                        <div className="ml-auto">
                          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        </div>
                      </div>

                      {/* CSV Import */}
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" className="gap-2">
                          <Upload className="w-4 h-4" />
                          {t("report.polling.importCSV")}
                        </Button>
                        <Button
                          size="sm"
                          className="gap-2"
                          disabled={responseCount < 5}
                          onClick={() => toast.info("Szintézis 2.0 futtatása... (hamarosan)")}
                        >
                          <Zap className="w-4 h-4" />
                          {t("report.polling.resynthesize")}
                        </Button>
                      </div>

                      {responseCount < 5 && (
                        <p className="text-xs text-muted-foreground">
                          Minimum 5 válasz szükséges a Szintézis 2.0 futtatásához. (Jelenlegi: {responseCount}/5)
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
