import { AppLayout } from "@/components/AppLayout";
import { DogMascot } from "@/components/DogMascot";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslation } from "react-i18next";
import { useLocation, useParams } from "wouter";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Clock, Globe, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Streamdown } from "streamdown";
import { toast } from "sonner";

type PhaseStatus = "pending" | "running" | "done" | "failed";

interface Phase {
  id: string;
  label: string;
  status: PhaseStatus;
  sourcesFound: number;
  durationMs: number | null;
  summary: string | null;
  expanded: boolean;
  fallbackUsed?: boolean;
  fallbackModel?: string;
  groundingLost?: boolean;
}

interface FeedItem {
  id: number;
  text: string;
  type: "info" | "source" | "phase" | "error";
}

const INITIAL_PHASES: Phase[] = [
  { id: "wide_scan", label: "Wide Scan", status: "pending", sourcesFound: 0, durationMs: null, summary: null, expanded: false },
  { id: "gap_detection", label: "Gap Detection", status: "pending", sourcesFound: 0, durationMs: null, summary: null, expanded: false },
  { id: "deep_dives", label: "Deep Dives", status: "pending", sourcesFound: 0, durationMs: null, summary: null, expanded: false },
  { id: "synthesis", label: "Synthesis", status: "pending", sourcesFound: 0, durationMs: null, summary: null, expanded: false },
];

export default function ResearchProgress() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();

  const [phases, setPhases] = useState<Phase[]>(INITIAL_PHASES);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [overallStatus, setOverallStatus] = useState<"running" | "done" | "failed">("running");
  const [streamingReport, setStreamingReport] = useState<string>("");
  const [synthesisPartial, setSynthesisPartial] = useState<any>(null);
  const [error, setError] = useState<{
    phase: string | null;
    message: string;
    retriable: boolean;
    wasStreaming?: boolean;
  } | null>(null);
  const [fallbackPhases, setFallbackPhases] = useState<Array<{
    phase: string;
    model: string;
    groundingLost: boolean;
  }>>([]);
  const feedRef = useRef<HTMLDivElement>(null);
  const feedIdRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);

  const addFeed = (text: string, type: FeedItem["type"] = "info") => {
    setFeedItems((prev) => [...prev.slice(-80), { id: feedIdRef.current++, text, type }]);
  };

  // Connect to SSE pipeline
  useEffect(() => {
    if (!id) return;

    const es = new EventSource(`/api/research/${id}/stream`);
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case "phase_start":
            addFeed(`▶ ${data.label} indítása...`, "phase");
            setPhases((p) => p.map((ph) => ph.id === data.phase ? { ...ph, status: "running", label: data.label } : ph));
            break;

          case "agent_action":
            addFeed(`🔍 ${data.message}`, "info");
            break;

          case "source_found":
            addFeed(`📄 ${data.title || data.url}`, "source");
            break;

          case "phase_complete":
            addFeed(`✅ ${data.phase.replace("_", " ")} kész — ${data.sourcesFound} forrás, ${(data.durationMs / 1000).toFixed(1)}s`, "phase");
            setPhases((p) => p.map((ph) =>
              ph.id === data.phase
                ? { ...ph, status: "done", sourcesFound: data.sourcesFound, durationMs: data.durationMs, summary: data.summary }
                : ph
            ));
            break;

          case "synthesis_progress":
            setSynthesisPartial(data.partial);
            if (data.partial?.reportMarkdown) {
              setStreamingReport(data.partial.reportMarkdown);
            }
            break;

          case "fallback_used":
            setFallbackPhases((prev) => [...prev, {
              phase: data.phase,
              model: data.fallbackModel,
              groundingLost: data.groundingLost,
            }]);
            setPhases((p) => p.map((ph) =>
              ph.id === data.phase
                ? { ...ph, fallbackUsed: true, fallbackModel: data.fallbackModel, groundingLost: data.groundingLost }
                : ph
            ));
            break;  // NO toast here — aggregated at pipeline_complete

          case "pipeline_complete": {
            // Aggregated fallback notification (single toast per pipeline, not per event)
            setFallbackPhases((prev) => {
              if (prev.length === 1) {
                const fb = prev[0];
                const phaseLabel = t(`progress.phases.${fb.phase}`);
                toast.info(
                  fb.groundingLost
                    ? t("progress.fallback.groundingLost", { phase: phaseLabel, model: fb.model })
                    : t("progress.fallback.used", { phase: phaseLabel, model: fb.model })
                );
              } else if (prev.length > 1) {
                toast.info(t("progress.fallback.multiple", { count: prev.length }));
              }
              return prev;
            });
            addFeed(`🎉 Kutatás befejezve! Verdikt: ${data.verdict} — ${data.synthesisScore}/10`, "phase");
            setPhases((p) => p.map((ph) => ph.status === "running" ? { ...ph, status: "done" } : ph));
            setOverallStatus("done");
            setTimeout(() => navigate(`/research/${id}`), 2000);
            break;
          }

          case "pipeline_error":
            addFeed(`❌ Hiba: ${data.message}`, "error");
            setOverallStatus("failed");
            setError({
              phase: data.phase ?? null,
              message: data.message,
              retriable: data.retriable ?? false,
              wasStreaming: data.wasStreaming ?? false,
            });
            setPhases((p) => p.map((ph) => ph.status === "running" ? { ...ph, status: "failed" } : ph));
            es.close();
            break;
        }
      } catch (e) {
        console.error("SSE parse error:", e);
      }
    };

    es.onerror = () => {
      if (overallStatus === "running") {
        addFeed("⚠ Kapcsolat megszakadt. Újracsatlakozás...", "error");
      }
    };

    return () => {
      es.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Auto-scroll feed
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [feedItems]);

  const togglePhase = (phaseId: string) => {
    setPhases((p) => p.map((ph) => ph.id === phaseId ? { ...ph, expanded: !ph.expanded } : ph));
  };

  const currentPhase = phases.find((p) => p.status === "running");
  const completedCount = phases.filter((p) => p.status === "done").length;
  const progress = (completedCount / phases.length) * 100;

  return (
    <AppLayout>
      <div className="p-6 max-w-3xl mx-auto">
        {/* Header with dog mascot */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <DogMascot size={120} animate={overallStatus === "running"} />
          </div>
          <h1 className="text-2xl font-bold mb-2">
            {overallStatus === "done"
              ? "Kutatás befejezve! 🎉"
              : overallStatus === "failed"
              ? "Kutatás sikertelen"
              : t("progress.title")}
          </h1>
          {currentPhase && (
            <p className="text-muted-foreground text-sm animate-pulse">
              {currentPhase.label} folyamatban...
            </p>
          )}

          {/* Overall progress bar */}
          <div className="mt-4 h-2 bg-muted rounded-full overflow-hidden max-w-sm mx-auto">
            <div
              className="h-full bg-primary rounded-full transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">{completedCount}/{phases.length} fázis kész</p>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Phase cards */}
          <div className="space-y-3">
            {phases.map((phase, idx) => (
              <Card
                key={phase.id}
                className={cn(
                  "border transition-all duration-300",
                  phase.status === "running" && "border-primary shadow-sm shadow-primary/10",
                  phase.status === "done" && "border-green-500/30 dark:border-green-700/30",
                  phase.status === "failed" && "border-destructive"
                )}
              >
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 transition-all",
                      phase.status === "pending" && "bg-muted text-muted-foreground",
                      phase.status === "running" && "bg-primary/10 text-primary",
                      phase.status === "done" && "bg-green-100 dark:bg-green-900/30 text-green-600",
                      phase.status === "failed" && "bg-red-100 text-red-600"
                    )}>
                      {phase.status === "pending" && idx + 1}
                      {phase.status === "running" && <Loader2 className="w-4 h-4 animate-spin" />}
                      {phase.status === "done" && <CheckCircle2 className="w-4 h-4" />}
                      {phase.status === "failed" && <XCircle className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center flex-wrap gap-1">
                        <p className="font-medium text-sm">{phase.label}</p>
                        {phase.fallbackUsed && (
                          <Badge variant="outline" className="text-amber-600 border-amber-400 text-xs">
                            Fallback
                          </Badge>
                        )}
                        {phase.groundingLost && (
                          <Badge variant="outline" className="text-orange-600 border-orange-400 text-xs">
                            ⚠ Grounding unavailable
                          </Badge>
                        )}
                      </div>
                      {phase.status === "done" && (
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                          {phase.sourcesFound > 0 && (
                            <span className="flex items-center gap-1">
                              <Globe className="w-3 h-3" />
                              {phase.sourcesFound} forrás
                            </span>
                          )}
                          {phase.durationMs && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {(phase.durationMs / 1000).toFixed(1)}s
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {phase.status === "done" && phase.summary && (
                      <button
                        onClick={() => togglePhase(phase.id)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        aria-label="Toggle phase summary"
                      >
                        {phase.expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                  {phase.expanded && phase.summary && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <p className="text-xs text-muted-foreground leading-relaxed">{phase.summary}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Streaming synthesis report */}
          {currentPhase?.id === "synthesis" && streamingReport && (
            <div className="mt-6 rounded-lg border bg-muted/30 p-4 lg:col-span-2">
              <p className="text-sm text-muted-foreground mb-2">
                {t("progress.synthesis.streaming")}
              </p>
              <div className="prose prose-sm max-h-96 overflow-y-auto">
                <Streamdown>{streamingReport}</Streamdown>
              </div>
            </div>
          )}

          {/* Live feed */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-2 h-2 rounded-full",
                overallStatus === "running" ? "bg-green-500 animate-pulse" : "bg-muted"
              )} />
              <p className="text-sm font-medium">Élő tevékenység</p>
            </div>
            <div
              ref={feedRef}
              className="h-80 overflow-y-auto bg-muted/30 rounded-xl border border-border p-3 space-y-1 font-mono"
            >
              {feedItems.length === 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Csatlakozás a pipeline-hoz...
                </div>
              )}
              {feedItems.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "live-feed-item text-xs py-0.5",
                    item.type === "source" && "text-blue-600 dark:text-blue-400",
                    item.type === "phase" && "text-green-600 dark:text-green-400 font-semibold",
                    item.type === "info" && "text-muted-foreground",
                    item.type === "error" && "text-destructive"
                  )}
                >
                  {item.text}
                </div>
              ))}
              {overallStatus === "running" && feedItems.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Feldolgozás...
                </div>
              )}
            </div>

            {/* Error state with auto-refund notice */}
            {error && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                <h3 className="font-semibold text-destructive">
                  {t("progress.error.title")}
                </h3>
                {error.phase && (
                  <p className="text-sm mt-1">
                    {t("progress.error.phase")}: <strong>{error.phase}</strong>
                  </p>
                )}
                <p className="mt-2 text-sm">{error.message}</p>
                {error.wasStreaming && (
                  <p className="mt-2 text-sm text-muted-foreground italic">
                    A részleges riport megtartva a képernyőn. Az újrapróbálás új generálást indít.
                  </p>
                )}
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("progress.error.refunded")}
                </p>
                {error.retriable && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => navigate("/research/new")}
                  >
                    {t("progress.error.retry")}
                  </Button>
                )}
              </div>
            )}

            {/* Success state */}
            {overallStatus === "done" && (
              <Card className="border-green-500/30 bg-green-500/5">
                <CardContent className="pt-4 pb-4">
                  <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                    ✓ Kutatás sikeresen befejezve! Átirányítás a riporthoz...
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
