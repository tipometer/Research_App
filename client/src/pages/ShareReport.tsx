import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useParams } from "wouter";
import { BarChart3, Download, FileText } from "lucide-react";
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer, Tooltip } from "recharts";
import { Streamdown } from "streamdown";

const MOCK = {
  nicheName: "Beer & Dumbbell Coach — Kalóriaszámláló Hedonistáknak",
  verdict: "CONDITIONAL" as "GO" | "KILL" | "CONDITIONAL",
  synthesisScore: 7.8,
  scores: { marketSize: 7, competition: 6, feasibility: 8, monetization: 7, timeliness: 9 },
  reportMarkdown: `## Összefoglalás\n\nA **Beer & Dumbbell Coach** egy egyedülálló niche-t céloz meg...\n\n## Piaci lehetőség\n\nA globális fitnesz alkalmazás piac 2025-ben **15,6 milliárd USD** értékű.\n`,
};

export default function ShareReport() {
  const { token } = useParams<{ token: string }>();
  const data = [
    { axis: "Piacméret", value: MOCK.scores.marketSize, fullMark: 10 },
    { axis: "Verseny", value: MOCK.scores.competition, fullMark: 10 },
    { axis: "Megvalósíthatóság", value: MOCK.scores.feasibility, fullMark: 10 },
    { axis: "Monetizáció", value: MOCK.scores.monetization, fullMark: 10 },
    { axis: "Időszerűség", value: MOCK.scores.timeliness, fullMark: 10 },
  ];

  const verdictCls = MOCK.verdict === "GO" ? "verdict-go" : MOCK.verdict === "KILL" ? "verdict-kill" : "verdict-conditional";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border py-4 px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
            <BarChart3 className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-bold">Deep Research</span>
          <span className="text-muted-foreground text-sm ml-2">Megosztott riport</span>
        </div>
        <Button size="sm" variant="outline" className="gap-2" onClick={() => window.location.href = "/"}>
          Saját kutatás indítása
        </Button>
      </header>
      <div className="max-w-4xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-2">{MOCK.nicheName}</h1>
        <div className="flex items-center gap-4 mb-8">
          <span className={`inline-flex items-center px-4 py-1.5 rounded-full text-sm font-black ${verdictCls}`}>{MOCK.verdict}</span>
          <span className="text-3xl font-black text-primary">{MOCK.synthesisScore}<span className="text-base font-normal text-muted-foreground">/10</span></span>
        </div>
        <div className="grid lg:grid-cols-2 gap-6 mb-8">
          <Card>
            <CardContent className="pt-4">
              <ResponsiveContainer width="100%" height={240}>
                <RadarChart data={data}>
                  <PolarGrid stroke="var(--border)" />
                  <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <Radar dataKey="value" stroke="oklch(0.52 0.22 264)" fill="oklch(0.52 0.22 264)" fillOpacity={0.25} strokeWidth={2} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px", fontSize: 12 }} />
                </RadarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 space-y-3">
              {Object.entries(MOCK.scores).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-32 capitalize">{k}</span>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${v * 10}%` }} />
                  </div>
                  <span className="text-xs font-bold">{v}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <Streamdown>{MOCK.reportMarkdown}</Streamdown>
            </div>
          </CardContent>
        </Card>
        <div className="mt-6 p-4 bg-primary/5 rounded-xl border border-primary/20 text-center">
          <p className="text-sm text-muted-foreground mb-3">Készítsd el a saját kutatásodat!</p>
          <Button onClick={() => window.location.href = "/"}>Ingyenes próba →</Button>
        </div>
      </div>
    </div>
  );
}
