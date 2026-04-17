import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { useTheme } from "@/contexts/ThemeContext";
import { DogMascot } from "@/components/DogMascot";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  BarChart3,
  ChevronRight,
  Globe,
  Moon,
  Shield,
  Sun,
  Users,
  Zap,
} from "lucide-react";

export default function Home() {
  const { isAuthenticated } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { t, i18n } = useTranslation();

  const toggleLang = () => {
    const newLang = i18n.language === "hu" ? "en" : "hu";
    i18n.changeLanguage(newLang);
    localStorage.setItem("lang", newLang);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top nav */}
      <header className="fixed top-0 inset-x-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-sm">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg tracking-tight">Deep Research</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={toggleLang} className="text-xs font-bold">
              {i18n.language === "hu" ? "EN" : "HU"}
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleTheme}>
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
            {isAuthenticated ? (
              <Link href="/dashboard">
                <Button size="sm">
                  {t("nav.dashboard")} <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            ) : (
              <a href={getLoginUrl()}>
                <Button size="sm">{t("nav.login")}</Button>
              </a>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-32 pb-20 px-4">
        <div className="container max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
                <Zap className="w-4 h-4" />
                AI-powered market research
              </div>
              <h1 className="text-4xl lg:text-5xl font-extrabold leading-tight mb-6 tracking-tight">
                {t("landing.hero.title")}
              </h1>
              <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
                {t("landing.hero.subtitle")}
              </p>
              <div className="flex flex-wrap gap-3">
                {isAuthenticated ? (
                  <Link href="/research/new">
                    <Button size="lg" className="gap-2">
                      {t("landing.hero.cta")} <ChevronRight className="w-4 h-4" />
                    </Button>
                  </Link>
                ) : (
                  <a href={getLoginUrl()}>
                    <Button size="lg" className="gap-2">
                      {t("landing.hero.cta")} <ChevronRight className="w-4 h-4" />
                    </Button>
                  </a>
                )}
                <Link href="/dashboard">
                  <Button variant="outline" size="lg">
                    {t("landing.hero.watchDemo")}
                  </Button>
                </Link>
              </div>
            </div>

            {/* Animated mascot */}
            <div className="flex justify-center lg:justify-end">
              <div className="relative">
                <div className="absolute inset-0 bg-primary/5 rounded-full blur-3xl scale-150" />
                <div className="relative bg-card border border-border rounded-2xl p-8 shadow-xl">
                  <DogMascot size={200} animate />
                  <div className="mt-4 space-y-2">
                    {["Wide Scan", "Gap Detection", "Deep Dives", "Synthesis"].map((phase, i) => (
                      <div key={phase} className="flex items-center gap-2 text-sm">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{
                            background: `oklch(${0.55 + i * 0.1} 0.2 ${264 - i * 20})`,
                          }}
                        />
                        <span className="text-muted-foreground">{phase}</span>
                        <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary/60"
                            style={{ width: `${100 - i * 15}%`, transition: "width 1s ease" }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-muted/30">
        <div className="container max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-12">
            Minden, amire szükséged van a piackutatáshoz
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: BarChart3,
                title: t("landing.features.pipeline.title"),
                desc: t("landing.features.pipeline.desc"),
                color: "text-blue-500",
              },
              {
                icon: Zap,
                title: t("landing.features.radar.title"),
                desc: t("landing.features.radar.desc"),
                color: "text-purple-500",
              },
              {
                icon: Users,
                title: t("landing.features.polling.title"),
                desc: t("landing.features.polling.desc"),
                color: "text-green-500",
              },
              {
                icon: Shield,
                title: t("landing.features.security.title"),
                desc: t("landing.features.security.desc"),
                color: "text-orange-500",
              },
            ].map((f) => (
              <div key={f.title} className="bg-card border border-border rounded-xl p-6">
                <f.icon className={`w-8 h-8 mb-4 ${f.color}`} />
                <h3 className="font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-20">
        <div className="container max-w-4xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-4">Egyszerű, átlátható árazás</h2>
          <p className="text-muted-foreground mb-12">Kredit alapú modell — csak annyit fizetsz, amennyit használsz</p>
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              { name: "Starter", credits: 5, price: "4 990 Ft", desc: "Kipróbáláshoz" },
              { name: "Pro", credits: 20, price: "14 990 Ft", desc: "Rendszeres kutatáshoz", popular: true },
              { name: "Business", credits: 60, price: "34 990 Ft", desc: "Intenzív használathoz" },
            ].map((pkg) => (
              <div
                key={pkg.name}
                className={`bg-card border rounded-xl p-6 ${pkg.popular ? "border-primary shadow-lg shadow-primary/10" : "border-border"}`}
              >
                {pkg.popular && (
                  <div className="text-xs font-bold text-primary mb-2 uppercase tracking-wider">Legnépszerűbb</div>
                )}
                <h3 className="text-xl font-bold mb-1">{pkg.name}</h3>
                <p className="text-muted-foreground text-sm mb-4">{pkg.desc}</p>
                <div className="text-3xl font-extrabold mb-1">{pkg.price}</div>
                <div className="text-sm text-muted-foreground mb-6">{pkg.credits} kredit</div>
                <a href={getLoginUrl()}>
                  <Button className="w-full" variant={pkg.popular ? "default" : "outline"}>
                    Vásárlás
                  </Button>
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="container flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4" />
            <span>Deep Research © 2026</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="#" className="hover:text-foreground transition-colors">Adatkezelési tájékoztató</a>
            <a href="#" className="hover:text-foreground transition-colors">ÁSZF</a>
            <a href="#" className="hover:text-foreground transition-colors">Kapcsolat</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
