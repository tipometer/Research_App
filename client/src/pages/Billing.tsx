import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CheckCircle2, CreditCard, FileText, History, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const PACKAGES = [
  { id: "starter", credits: 5, priceHuf: 4990, priceEur: 12.9, desc: "Kipróbáláshoz", popular: false },
  { id: "pro", credits: 20, priceHuf: 14990, priceEur: 38.9, desc: "Rendszeres kutatáshoz", popular: true },
  { id: "business", credits: 60, priceHuf: 34990, priceEur: 89.9, desc: "Intenzív használathoz", popular: false },
];

const MOCK_TRANSACTIONS = [
  { id: "t1", type: "purchase", amount: 20, price: "14 990 Ft", date: "2026-04-10", invoiceId: "INV-2026-042" },
  { id: "t2", type: "usage", amount: -1, desc: "AI önéletrajz készítő kutatás", date: "2026-04-16" },
  { id: "t3", type: "usage", amount: -1, desc: "Beer & Dumbbell Coach kutatás", date: "2026-04-15" },
  { id: "t4", type: "refund", amount: 1, desc: "Automatikus visszatérítés — sikertelen kutatás", date: "2026-04-14" },
];

export default function Billing() {
  const { t } = useTranslation();
  const currentCredits = 12;

  const handlePurchase = (pkg: typeof PACKAGES[0]) => {
    toast.info(`Stripe fizetés: ${pkg.priceHuf} Ft — (hamarosan elérhető)`);
  };

  return (
    <AppLayout>
      <div className="p-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">{t("billing.title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">Kredit vásárlás és számlák kezelése</p>
        </div>

        {/* Current balance */}
        <Card className="mb-8 bg-primary/5 border-primary/20">
          <CardContent className="pt-6 pb-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <Zap className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("billing.currentBalance")}</p>
                <p className="text-4xl font-black text-primary">{currentCredits}</p>
                <p className="text-xs text-muted-foreground mt-0.5">kredit</p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-xs text-muted-foreground">1 kredit = 1 kutatás</p>
                <p className="text-xs text-muted-foreground">Batch mód = 3 kredit</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Packages */}
        <h2 className="text-lg font-semibold mb-4">{t("billing.buyCredits")}</h2>
        <div className="grid sm:grid-cols-3 gap-4 mb-8">
          {PACKAGES.map((pkg) => (
            <Card
              key={pkg.id}
              className={cn(
                "relative border transition-all",
                pkg.popular ? "border-primary shadow-lg shadow-primary/10" : "border-border"
              )}
            >
              {pkg.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary text-primary-foreground text-xs px-3">
                    Legnépszerűbb
                  </Badge>
                </div>
              )}
              <CardContent className="pt-6 pb-6 text-center">
                <h3 className="font-bold text-lg mb-1 capitalize">{pkg.id}</h3>
                <p className="text-sm text-muted-foreground mb-4">{pkg.desc}</p>
                <div className="mb-2">
                  <span className="text-3xl font-extrabold">{pkg.priceHuf.toLocaleString("hu-HU")}</span>
                  <span className="text-sm text-muted-foreground ml-1">Ft</span>
                </div>
                <p className="text-xs text-muted-foreground mb-4">≈ €{pkg.priceEur}</p>
                <div className="flex items-center justify-center gap-1.5 mb-6">
                  <Zap className="w-4 h-4 text-primary" />
                  <span className="font-bold text-primary">{pkg.credits} kredit</span>
                </div>
                <div className="space-y-2 mb-6 text-left">
                  {["Minden kutatási stratégia", "Riport export (PDF, MD)", "Polling modul", "Megosztható link"].map((f) => (
                    <div key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                      {f}
                    </div>
                  ))}
                </div>
                <Button
                  className="w-full"
                  variant={pkg.popular ? "default" : "outline"}
                  onClick={() => handlePurchase(pkg)}
                >
                  <CreditCard className="w-4 h-4 mr-2" />
                  {t("billing.purchase")}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Transaction history */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-base">{t("billing.history")}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {MOCK_TRANSACTIONS.map((tx) => (
                <div key={tx.id} className="flex items-center gap-4 px-6 py-4">
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                    tx.type === "purchase" && "bg-green-100 dark:bg-green-900/30",
                    tx.type === "usage" && "bg-blue-100 dark:bg-blue-900/30",
                    tx.type === "refund" && "bg-yellow-100 dark:bg-yellow-900/30"
                  )}>
                    {tx.type === "purchase" && <CreditCard className="w-4 h-4 text-green-600" />}
                    {tx.type === "usage" && <Zap className="w-4 h-4 text-blue-600" />}
                    {tx.type === "refund" && <History className="w-4 h-4 text-yellow-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {tx.type === "purchase" && `${tx.amount} kredit vásárlás`}
                      {tx.type === "usage" && tx.desc}
                      {tx.type === "refund" && tx.desc}
                    </p>
                    <p className="text-xs text-muted-foreground">{tx.date}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={cn(
                      "text-sm font-bold",
                      tx.amount > 0 ? "text-green-600" : "text-muted-foreground"
                    )}>
                      {tx.amount > 0 ? `+${tx.amount}` : tx.amount} kredit
                    </p>
                    {tx.price && <p className="text-xs text-muted-foreground">{tx.price}</p>}
                    {tx.invoiceId && (
                      <button className="flex items-center gap-1 text-xs text-primary hover:underline mt-0.5 ml-auto">
                        <FileText className="w-3 h-3" />
                        {tx.invoiceId}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Invoice note */}
        <p className="text-xs text-muted-foreground mt-4 text-center">
          Számlák automatikusan kiállítva a Számlázz.hu rendszeren keresztül. A számlát e-mailben kapod meg.
        </p>
      </div>
    </AppLayout>
  );
}
