import { AppLayout } from "@/components/AppLayout";
import { DecisionContextBlock } from "@/components/decision/DecisionContextBlock";
import { DimensionChips, type Dimension } from "@/components/decision/DimensionChips";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "react-i18next";
import { useParams } from "wouter";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  FileText,
  GraduationCap,
  Link2,
  MessageSquare,
  Newspaper,
  Plus,
  Share2,
  Trash2,
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

type Scores = { marketSize: number; competition: number; feasibility: number; monetization: number; timeliness: number };

function RadarScore({ scores }: { scores: Scores }) {
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

// Questions stored in DB come from PollingSchema: { id: string, type, text, options }
// We only care about id + text for the editor UI; other fields are preserved but not shown.
type DbQuestion = { id: string; type: string; text: string; options: string[] | null };
type LocalQuestion = { id: string; text: string };

export default function ResearchReport() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const { data: research, isLoading, error } = trpc.research.get.useQuery(
    { id },
    { enabled: !Number.isNaN(id) && id > 0 },
  );

  // ── Survey wiring ──────────────────────────────────────────────────────────
  const {
    data: surveyData,
    isLoading: surveyLoading,
    refetch: refetchSurvey,
  } = trpc.survey.getByResearch.useQuery(
    { researchId: id },
    { enabled: !Number.isNaN(id) && id > 0 && research?.status === "done" },
  );

  const createSurveyMutation = trpc.survey.create.useMutation({
    onSuccess: () => {
      void refetchSurvey();
      toast.success("Kérdőív létrehozva és aktiválva!");
    },
    onError: (err) => {
      toast.error(err.message ?? "Hiba a kérdőív létrehozásakor.");
    },
  });

  // Derive survey state from backend data
  const surveyActive = !!surveyData;
  const responseCount = surveyData?.responseCount ?? 0;
  const surveyToken = surveyData?.token ?? null;
  // DB questions cast from json — shape is PollingSchema.questions items
  const dbQuestions: DbQuestion[] = Array.isArray(surveyData?.questions)
    ? (surveyData.questions as DbQuestion[])
    : [];

  // ── Tab + dimension filter state ──────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<string>("report");
  const [selectedDimension, setSelectedDimension] = useState<Dimension>("all");

  // ── Evidence-by-dimension query (lazy: only runs when Sources tab is active) ─
  const evidenceBucketsQuery = trpc.validation.getEvidenceByDimension.useQuery(
    { researchId: id },
    {
      enabled: !Number.isNaN(id) && id > 0 && activeTab === "sources",
      retry: false,
      refetchOnWindowFocus: false,
    },
  );

  // Local editable copy (only used when survey is active and questions are loaded)
  const [localQuestions, setLocalQuestions] = useState<LocalQuestion[]>([]);
  const [questionsInitialised, setQuestionsInitialised] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  // Seed localQuestions from DB once when survey loads (keeps edits stable across re-renders)
  useEffect(() => {
    if (dbQuestions.length > 0 && !questionsInitialised) {
      setLocalQuestions(dbQuestions.map((q) => ({ id: q.id, text: q.text })));
      setQuestionsInitialised(true);
    }
  }, [dbQuestions, questionsInitialised]);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="p-8 max-w-5xl mx-auto space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
          <div className="grid lg:grid-cols-3 gap-6">
            <Skeleton className="h-64" />
            <Skeleton className="h-64 lg:col-span-2" />
          </div>
          <Skeleton className="h-96" />
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="p-8 max-w-5xl mx-auto">
          <p className="text-destructive">{error.message}</p>
        </div>
      </AppLayout>
    );
  }

  if (!research) {
    return (
      <AppLayout>
        <div className="p-8 max-w-5xl mx-auto">
          <p>{t("report.notFound")}</p>
        </div>
      </AppLayout>
    );
  }

  if (research.status !== "done") {
    return (
      <AppLayout>
        <div className="p-8 max-w-5xl mx-auto">
          <p>{t("report.notReady")}</p>
        </div>
      </AppLayout>
    );
  }

  const report = {
    nicheName: research.nicheName,
    verdict: (research.verdict ?? "CONDITIONAL") as "GO" | "KILL" | "CONDITIONAL",
    synthesisScore: Number(research.synthesisScore ?? "0"),
    scores: {
      marketSize:   Number(research.scoreMarketSize ?? "0"),
      competition:  Number(research.scoreCompetition ?? "0"),
      feasibility:  Number(research.scoreFeasibility ?? "0"),
      monetization: Number(research.scoreMonetization ?? "0"),
      timeliness:   Number(research.scoreTimeliness ?? "0"),
    },
    reportMarkdown: research.reportMarkdown ?? "",
    sources: research.sources.map((s) => ({
      id: s.id,
      title: s.title ?? "(cím nélkül)",
      url: s.url,
      type: s.sourceType,
      publishedAt: s.publishedAt,
      snippet: s.snippet ?? "",
    })),
    shareToken: research.shareToken,
  };

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
              <div className="w-full space-y-3">
                {Object.entries(report.scores).map(([key, val]) => (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {t(`report.radarAxes.${key.replace(/([A-Z])/g, (m) => m.toLowerCase())}`)}
                      </span>
                      <span className="text-xs font-bold">{val}</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${val * 10}%` }}
                      />
                    </div>
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

        {/* Decision context panels */}
        <DecisionContextBlock researchId={id} />

        <Tabs value={activeTab} onValueChange={setActiveTab} defaultValue="report">
          <TabsList className="mb-6">
            <TabsTrigger value="report">Riport</TabsTrigger>
            <TabsTrigger value="sources">{t("report.sources.title")} ({report.sources.length})</TabsTrigger>
            <TabsTrigger value="polling" className="gap-1.5">
              <Users className="w-3.5 h-3.5" />
              {t("report.polling.tabLabel")}
            </TabsTrigger>
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
            {/* Chips row — only render if evidence query didn't error */}
            {!evidenceBucketsQuery.isError && (
              <DimensionChips
                selected={selectedDimension}
                onSelect={setSelectedDimension}
                disabled={evidenceBucketsQuery.isLoading}
              />
            )}

            {/* Source list — branched on selected dimension */}
            {selectedDimension === "all" ? (
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
                              <span className={cn("flex items-center gap-1 text-xs", source.publishedAt ? "text-muted-foreground" : "text-muted-foreground italic")}>
                                <Calendar className="w-3 h-3" />
                                {source.publishedAt ?? t("report.unknownDate")}
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
            ) : (
              (() => {
                const claims = evidenceBucketsQuery.data?.[selectedDimension] ?? [];
                if (claims.length === 0) {
                  return (
                    <p className="text-sm text-muted-foreground italic py-4">
                      {t("report.sources.emptyDimension")}
                    </p>
                  );
                }
                return (
                  <div className="space-y-3">
                    {claims.map((claim) => {
                      const stanceClass =
                        claim.stance === "supports"
                          ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                          : claim.stance === "weakens"
                          ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                          : "bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-300";
                      return (
                        <Card key={claim.id}>
                          <CardContent className="pt-4 pb-4">
                            <div className="flex items-start justify-between gap-3 mb-2">
                              <Badge variant="outline" className={cn("capitalize", stanceClass)}>
                                {claim.stance}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {Math.round(Number(claim.confidence ?? 0) * 100)}% confidence
                              </span>
                            </div>
                            <p className="text-sm">{claim.claim}</p>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                );
              })()
            )}
          </TabsContent>

          {/* Polling tab */}
          <TabsContent value="polling">
            <div className="space-y-4">
              {/* Explanation */}
              <Card className="border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-900/10">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex-shrink-0">
                      <Users className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm mb-1">Emberi Kutatás (Primer Research)</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Az AI által generált kérdőívet megoszhatod Facebook csoportokban, LinkedIn-en vagy bármilyen közösségben. 
                        A beérkező válaszok alapján a rendszer frissíti a kutatási riportot és a verdiktet (<strong>Szintézis 2.0</strong>).
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Survey Questions Editor */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold">AI által generált kérdések</CardTitle>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs"
                      onClick={() => {
                        const newQ: LocalQuestion = { id: `local-${Date.now()}`, text: "Új kérdés..." };
                        setLocalQuestions([...localQuestions, newQ]);
                        setEditingQuestion(newQ.id);
                        setEditText(newQ.text);
                      }}
                    >
                      <Plus className="w-3 h-3" />
                      Kérdés hozzáadása
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Szerkeszd a kérdéseket a kérdőív aktivitása előtt.</p>
                </CardHeader>
                <CardContent className="space-y-2">
                  {localQuestions.map((q, i) => (
                    <div key={q.id} className="flex items-start gap-2 p-3 rounded-lg border border-border bg-muted/20 group">
                      <span className="w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">{i + 1}</span>
                      {editingQuestion === q.id ? (
                        <div className="flex-1 flex items-center gap-2">
                          <input
                            autoFocus
                            className="flex-1 text-sm bg-background border border-primary rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30"
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                setLocalQuestions(localQuestions.map(sq => sq.id === q.id ? { ...sq, text: editText } : sq));
                                setEditingQuestion(null);
                              }
                            }}
                          />
                          <Button size="sm" variant="ghost" className="p-1 h-auto" onClick={() => {
                            setLocalQuestions(localQuestions.map(sq => sq.id === q.id ? { ...sq, text: editText } : sq));
                            setEditingQuestion(null);
                          }}>
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <p className="flex-1 text-sm">{q.text}</p>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button size="sm" variant="ghost" className="p-1 h-auto" onClick={() => { setEditingQuestion(q.id); setEditText(q.text); }}>
                              <Edit3 className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="ghost" className="p-1 h-auto text-destructive" onClick={() => setLocalQuestions(localQuestions.filter(sq => sq.id !== q.id))}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Activate survey */}
              {!surveyActive ? (
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">Kérdőív aktivitálása</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Publikus link generálása és válaszgyűjtés indítása</p>
                      </div>
                      <Button
                        className="gap-2"
                        disabled={createSurveyMutation.isPending}
                        onClick={() => createSurveyMutation.mutate({ researchId: id })}
                      >
                        <MessageSquare className="w-4 h-4" />
                        {createSurveyMutation.isPending ? "Generálás..." : "Kérdőív indítása"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {/* Survey link */}
                  <Card className="border-green-200 dark:border-green-800">
                    <CardContent className="pt-4 pb-4">
                      <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-2 flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
                        Kérdőív aktiv, válaszokat fogad
                      </p>
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
                          Másolás
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Response counter */}
                  <Card>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                            <Users className="w-6 h-6 text-primary" />
                          </div>
                          <div>
                            <p className="text-3xl font-black text-primary">{responseCount}</p>
                            <p className="text-xs text-muted-foreground">beérkezett válasz</p>
                          </div>
                        </div>
                        <div className="ml-auto flex flex-col gap-2 items-end">
                          <Button variant="outline" size="sm" className="gap-2">
                            <Upload className="w-4 h-4" />
                            CSV import
                          </Button>
                          <Button
                            size="sm"
                            className="gap-2 bg-purple-600 hover:bg-purple-700"
                            disabled={responseCount < 5}
                            onClick={() => toast.info("Szintézis 2.0 futtatása... (hamarosan)")}
                          >
                            <Zap className="w-4 h-4" />
                            Szintézis 2.0 futtatása
                          </Button>
                        </div>
                      </div>
                      {responseCount >= 5 && (
                        <p className="text-xs text-muted-foreground mt-3 p-2 bg-muted/30 rounded-lg">
                          Elegendő válasz érkezett! A Szintézis 2.0 frissíti a riportot és a verdiktet a valós visszajelzések alapján.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
