import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Bookmark, Loader2, RefreshCw, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

// New BrainstormSchema shape (post-C1): { id: string (kebab-case), title: string, description: string }
type BrainstormIdea = {
  id: string;
  title: string;
  description: string;
  saved: boolean;
};

export default function Brainstorm() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [context, setContext] = useState("");
  const [ideas, setIdeas] = useState<BrainstormIdea[] | null>(null);
  const [savedIdeas, setSavedIdeas] = useState<BrainstormIdea[]>([]);
  const [refinement, setRefinement] = useState("");

  const generateMutation = trpc.brainstorm.generate.useMutation({
    onSuccess: (data) => {
      setIdeas(data.ideas.map((idea) => ({ ...idea, saved: false })));
      toast.success("10 ötlet generálva!");
    },
    onError: (err) => {
      toast.error(err.message ?? "Hiba a generálás során.");
    },
  });

  const refineMutation = trpc.brainstorm.generate.useMutation({
    onSuccess: (data) => {
      setIdeas(data.ideas.map((idea) => ({ ...idea, saved: false })));
      setRefinement("");
      toast.success("Ötletek finomítva!");
    },
    onError: (err) => {
      toast.error(err.message ?? "Hiba a finomítás során.");
    },
  });

  const isLoading = generateMutation.isPending || refineMutation.isPending;

  const handleGenerate = () => {
    if (!context.trim()) {
      toast.error("Adj meg egy kontextust a brainstormhoz!");
      return;
    }
    generateMutation.mutate({ context });
  };

  const handleRefine = () => {
    if (!refinement.trim()) return;
    refineMutation.mutate({ context, refinement });
  };

  const toggleSave = (id: string) => {
    setIdeas((prev) =>
      prev?.map((idea) => idea.id === id ? { ...idea, saved: !idea.saved } : idea) ?? null
    );
    const idea = ideas?.find((i) => i.id === id);
    if (idea) {
      if (!idea.saved) {
        setSavedIdeas((prev) => [...prev, { ...idea, saved: true }]);
        toast.success(`"${idea.title}" mentve!`);
      } else {
        setSavedIdeas((prev) => prev.filter((i) => i.id !== id));
      }
    }
  };

  const startResearch = (title: string) => {
    navigate(`/research/new?niche=${encodeURIComponent(title)}`);
  };

  return (
    <AppLayout>
      <div className="p-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">{t("brainstorm.title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t("brainstorm.subtitle")}
          </p>
        </div>

        {/* Input */}
        <Card className="mb-6">
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <Label>{t("brainstorm.contextLabel")}</Label>
              <Textarea
                placeholder={t("brainstorm.contextPlaceholder")}
                value={context}
                onChange={(e) => setContext(e.target.value)}
                rows={3}
                maxLength={1000}
              />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Ára: 0.25 kredit / generálás</p>
              <Button onClick={handleGenerate} disabled={isLoading || !context.trim()} className="gap-2">
                {isLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Generálás...</>
                ) : (
                  <><Zap className="w-4 h-4" /> {t("brainstorm.generate")}</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        {ideas && (
          <>
            {/* Refinement */}
            <div className="flex gap-2 mb-4">
              <Textarea
                placeholder="Finomítsd az ötleteket... pl. 'Fókuszálj inkább a B2B lehetőségekre'"
                value={refinement}
                onChange={(e) => setRefinement(e.target.value)}
                rows={2}
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={handleRefine}
                disabled={isLoading || !refinement.trim()}
                className="gap-2 self-end"
              >
                <RefreshCw className="w-4 h-4" />
                {t("brainstorm.refine")}
              </Button>
            </div>

            {/* Ideas grid */}
            <div className="grid sm:grid-cols-2 gap-3">
              {ideas.map((idea) => (
                <Card
                  key={idea.id}
                  className={cn(
                    "border transition-all hover:shadow-md",
                    idea.saved && "border-primary/50 bg-primary/5"
                  )}
                >
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-semibold text-sm leading-tight">{idea.title}</h3>
                      <button
                        onClick={() => toggleSave(idea.id)}
                        className={cn(
                          "p-1 rounded transition-colors flex-shrink-0",
                          idea.saved ? "text-primary" : "text-muted-foreground hover:text-primary"
                        )}
                      >
                        <Bookmark className={cn("w-4 h-4", idea.saved && "fill-current")} />
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{idea.description}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full gap-2 text-xs"
                      onClick={() => startResearch(idea.title)}
                    >
                      {t("brainstorm.startResearch")}
                      <ArrowRight className="w-3 h-3" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Saved ideas */}
            {savedIdeas.length > 0 && (
              <Card className="mt-6">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">{t("brainstorm.savedIdeas")} ({savedIdeas.length})</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-2">
                    {savedIdeas.map((idea) => (
                      <button
                        key={idea.id}
                        onClick={() => startResearch(idea.title)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary rounded-full text-xs font-medium hover:bg-primary/20 transition-colors"
                      >
                        {idea.title}
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
