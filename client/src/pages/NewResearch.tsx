import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useState } from "react";
import { toast } from "sonner";
import { Crosshair, Layers, Search, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const strategies = [
  {
    id: "gaps",
    icon: Search,
    color: "text-blue-500",
    bgColor: "bg-blue-50 dark:bg-blue-900/20",
    borderColor: "border-blue-200 dark:border-blue-700",
  },
  {
    id: "predator",
    icon: Crosshair,
    color: "text-red-500",
    bgColor: "bg-red-50 dark:bg-red-900/20",
    borderColor: "border-red-200 dark:border-red-700",
  },
  {
    id: "provisioning",
    icon: Layers,
    color: "text-green-500",
    bgColor: "bg-green-50 dark:bg-green-900/20",
    borderColor: "border-green-200 dark:border-green-700",
  },
];

export default function NewResearch() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [nicheName, setNicheName] = useState("");
  const [description, setDescription] = useState("");
  const [strategy, setStrategy] = useState("gaps");
  const [batchMode, setBatchMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const creditCost = batchMode ? 3 : 1;
  const userCredits = 12; // mock

  const handleStart = async () => {
    if (!nicheName.trim()) {
      toast.error("A niche neve kötelező!");
      return;
    }
    if (userCredits < creditCost) {
      toast.error(t("newResearch.insufficientCredits"));
      return;
    }
    setIsLoading(true);
    // Mock: navigate to progress page
    setTimeout(() => {
      navigate("/research/demo/progress");
    }, 500);
  };

  return (
    <AppLayout>
      <div className="p-8 max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">{t("newResearch.title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Add meg a kutatni kívánt niche-t és válaszd ki a stratégiát.
          </p>
        </div>

        <div className="space-y-6">
          {/* Niche name */}
          <div className="space-y-2">
            <Label htmlFor="nicheName">{t("newResearch.nicheName")}</Label>
            <Input
              id="nicheName"
              placeholder={t("newResearch.nicheNamePlaceholder")}
              value={nicheName}
              onChange={(e) => setNicheName(e.target.value)}
              maxLength={200}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">{t("newResearch.description")}</Label>
            <Textarea
              id="description"
              placeholder={t("newResearch.descriptionPlaceholder")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={2000}
            />
            <p className="text-xs text-muted-foreground text-right">{description.length}/2000</p>
          </div>

          {/* Strategy selector */}
          <div className="space-y-3">
            <Label>{t("newResearch.strategy")}</Label>
            <div className="grid gap-3">
              {strategies.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStrategy(s.id)}
                  className={cn(
                    "flex items-start gap-4 p-4 rounded-xl border-2 text-left transition-all",
                    strategy === s.id
                      ? `${s.bgColor} ${s.borderColor}`
                      : "border-border hover:border-muted-foreground/30 bg-card"
                  )}
                >
                  <div className={cn("mt-0.5 p-2 rounded-lg", s.bgColor)}>
                    <s.icon className={cn("w-5 h-5", s.color)} />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{t(`newResearch.strategies.${s.id}`)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {s.id === "gaps" && "Azonosítja a kielégítetlen piaci igényeket és a fehér foltokat."}
                      {s.id === "predator" && "Elemzi a versenytársak gyengeségeit és lehetőségeit."}
                      {s.id === "provisioning" && "Feltérképezi az ellátási lánc hiányosságait és lehetőségeit."}
                    </p>
                  </div>
                  {strategy === s.id && (
                    <div className={cn("ml-auto w-5 h-5 rounded-full flex items-center justify-center", s.bgColor, s.color)}>
                      <Zap className="w-3 h-3" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Batch mode */}
          <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-card">
            <div>
              <p className="font-medium text-sm">{t("newResearch.batchMode")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Egyszerre 3 párhuzamos kutatás (+2 kredit)</p>
            </div>
            <Switch checked={batchMode} onCheckedChange={setBatchMode} />
          </div>

          {/* Credit cost + start */}
          <Card className="bg-muted/30">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm text-muted-foreground">{t("newResearch.creditCost")}</p>
                  <p className="text-2xl font-bold">{creditCost} kredit</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Egyenleg</p>
                  <p className={cn("text-lg font-bold", userCredits < creditCost ? "text-destructive" : "text-primary")}>
                    {userCredits} kredit
                  </p>
                </div>
              </div>
              <Button
                className="w-full"
                size="lg"
                onClick={handleStart}
                disabled={isLoading || !nicheName.trim() || userCredits < creditCost}
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Indítás...
                  </span>
                ) : (
                  t("newResearch.start")
                )}
              </Button>
              {userCredits < creditCost && (
                <p className="text-xs text-destructive text-center mt-2">{t("newResearch.insufficientCredits")}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
