import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useParams } from "wouter";
import { useState } from "react";
import { toast } from "sonner";
import { BarChart3, CheckCircle2 } from "lucide-react";

const MOCK_SURVEY = {
  title: "Beer & Dumbbell Coach — Validációs Kérdőív",
  description: "Segíts megérteni, mennyire lenne hasznos ez az alkalmazás számodra!",
  questions: [
    { id: "q1", text: "Mennyire érdekelne egy olyan alkalmazás, ami egyszerre kezeli az alkohol kalóriákat és a fitnesz céljaidat?", type: "scale", options: ["1 — Egyáltalán nem", "2", "3", "4", "5 — Nagyon érdekelne"] },
    { id: "q2", text: "Mennyit fizetnél havonta egy ilyen alkalmazásért?", type: "radio", options: ["Semmit (csak ingyenes)", "500-1000 Ft", "1000-2000 Ft", "2000 Ft felett"] },
    { id: "q3", text: "Mi lenne a legfontosabb funkció számodra?", type: "radio", options: ["Alkohol kalória követés", "Edzésterv generálás", "Étkezési napló", "Közösségi funkciók"] },
    { id: "q4", text: "Van bármilyen megjegyzésed vagy javaslatod?", type: "text" },
  ],
};

export default function SurveyPage() {
  const { token } = useParams<{ token: string }>();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    const required = MOCK_SURVEY.questions.filter((q) => q.type !== "text");
    const missing = required.filter((q) => !answers[q.id]);
    if (missing.length > 0) { toast.error("Kérlek, válaszolj az összes kötelező kérdésre!"); return; }
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold mb-2">Köszönjük a visszajelzést!</h2>
          <p className="text-muted-foreground text-sm mb-6">Válaszaid segítenek a kutatás pontosításában.</p>
          <p className="text-xs text-muted-foreground">Készítsd el a saját kutatásodat a Deep Research-hel!</p>
          <Button className="mt-3 w-full" onClick={() => window.location.href = "/"}>Kipróbálom →</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border py-4 px-6 flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
          <BarChart3 className="w-4 h-4 text-primary-foreground" />
        </div>
        <span className="font-bold">Deep Research</span>
        <span className="text-muted-foreground text-sm ml-2">Kérdőív</span>
      </header>
      <div className="max-w-2xl mx-auto p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">{MOCK_SURVEY.title}</h1>
          <p className="text-muted-foreground">{MOCK_SURVEY.description}</p>
          <p className="text-xs text-muted-foreground mt-2">GDPR: Adatait bizalmasan kezeljük, csak aggregált formában használjuk fel.</p>
        </div>
        <div className="space-y-6">
          {MOCK_SURVEY.questions.map((q, idx) => (
            <Card key={q.id}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">{idx + 1}. {q.text}</CardTitle>
              </CardHeader>
              <CardContent>
                {q.type === "text" ? (
                  <Textarea placeholder="Opcionális megjegyzés..." value={answers[q.id] || ""} onChange={(e) => setAnswers((p) => ({ ...p, [q.id]: e.target.value }))} rows={3} />
                ) : (
                  <RadioGroup value={answers[q.id] || ""} onValueChange={(v) => setAnswers((p) => ({ ...p, [q.id]: v }))}>
                    {q.options?.map((opt) => (
                      <div key={opt} className="flex items-center gap-2">
                        <RadioGroupItem value={opt} id={`${q.id}-${opt}`} />
                        <Label htmlFor={`${q.id}-${opt}`} className="text-sm cursor-pointer">{opt}</Label>
                      </div>
                    ))}
                  </RadioGroup>
                )}
              </CardContent>
            </Card>
          ))}
          <Button className="w-full" size="lg" onClick={handleSubmit}>Beküldés</Button>
        </div>
      </div>
    </div>
  );
}
