import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Activity, AlertCircle, CheckCircle2, Key, Save, Settings, Shield, Users, Zap } from "lucide-react";
import { useState } from "react";

const MOCK_USERS = [
  { id: 1, name: "Kovács Péter", email: "peter@example.com", credits: 15, role: "user", researches: 5, createdAt: "2026-03-01" },
  { id: 2, name: "Nagy Anna", email: "anna@example.com", credits: 3, role: "user", researches: 12, createdAt: "2026-02-15" },
  { id: 3, name: "Admin User", email: "admin@example.com", credits: 999, role: "admin", researches: 0, createdAt: "2026-01-01" },
];

const MOCK_AUDIT_LOG = [
  { id: 1, user: "peter@example.com", action: "research.create", ip: "192.168.1.1", ts: "2026-04-17 09:12:33", status: "success" },
  { id: 2, user: "anna@example.com", action: "billing.purchase", ip: "10.0.0.5", ts: "2026-04-17 08:45:11", status: "success" },
  { id: 3, user: "unknown", action: "auth.login", ip: "203.0.113.42", ts: "2026-04-17 07:30:00", status: "failed" },
  { id: 4, user: "peter@example.com", action: "report.export", ip: "192.168.1.1", ts: "2026-04-16 18:22:05", status: "success" },
];

const AI_PHASES = [
  { id: "wide_scan", label: "Wide Scan" },
  { id: "gap_detection", label: "Gap Detection" },
  { id: "deep_dives", label: "Deep Dives" },
  { id: "synthesis", label: "Synthesis" },
];

const AI_MODELS = [
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash (Gyors, olcsó)" },
  { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro (Erős, drágább)" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 Mini (Közepes)" },
  { value: "gpt-4.1", label: "GPT-4.1 (Erős)" },
  { value: "claude-haiku", label: "Claude Haiku (Gyors)" },
  { value: "claude-sonnet", label: "Claude Sonnet (Prémium)" },
];

export default function AdminPanel() {
  const { t } = useTranslation();
  const [phaseModels, setPhaseModels] = useState<Record<string, string>>({
    wide_scan: "gemini-2.0-flash",
    gap_detection: "gemini-2.0-flash",
    deep_dives: "claude-haiku",
    synthesis: "claude-sonnet",
  });
  const [geminiKey, setGeminiKey] = useState("AIza••••••••••••••••••••••••••••••");
  const [openaiKey, setOpenaiKey] = useState("sk-••••••••••••••••••••••••••••••••");
  const [anthropicKey, setAnthropicKey] = useState("sk-ant-••••••••••••••••••••••••");

  return (
    <AppLayout>
      <div className="p-8 max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t("admin.title")}</h1>
            <p className="text-muted-foreground text-sm">Rendszer konfiguráció és felhasználók kezelése</p>
          </div>
        </div>

        <Tabs defaultValue="ai-config">
          <TabsList className="mb-6">
            <TabsTrigger value="ai-config" className="gap-2">
              <Zap className="w-4 h-4" /> AI Konfiguráció
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-2">
              <Users className="w-4 h-4" /> Felhasználók
            </TabsTrigger>
            <TabsTrigger value="audit" className="gap-2">
              <Activity className="w-4 h-4" /> Audit Log
            </TabsTrigger>
          </TabsList>

          {/* AI Config Tab */}
          <TabsContent value="ai-config" className="space-y-6">
            {/* API Keys */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-muted-foreground" />
                  <CardTitle className="text-base">API Kulcsok</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Google Gemini API Key</Label>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={geminiKey}
                      onChange={(e) => setGeminiKey(e.target.value)}
                      className="font-mono text-sm"
                    />
                    <Button variant="outline" size="sm" onClick={() => toast.success("Kulcs mentve!")}>
                      <Save className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>OpenAI API Key</Label>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={openaiKey}
                      onChange={(e) => setOpenaiKey(e.target.value)}
                      className="font-mono text-sm"
                    />
                    <Button variant="outline" size="sm" onClick={() => toast.success("Kulcs mentve!")}>
                      <Save className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Anthropic API Key</Label>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={anthropicKey}
                      onChange={(e) => setAnthropicKey(e.target.value)}
                      className="font-mono text-sm"
                    />
                    <Button variant="outline" size="sm" onClick={() => toast.success("Kulcs mentve!")}>
                      <Save className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  Az API kulcsok kizárólag szerver oldalon tárolódnak. A böngészőből soha nem érhetők el (CSP védett).
                </div>
              </CardContent>
            </Card>

            {/* Model Routing */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-muted-foreground" />
                  <CardTitle className="text-base">Modell Routing Fázisonként</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {AI_PHASES.map((phase) => (
                  <div key={phase.id} className="flex items-center gap-4">
                    <Label className="w-32 flex-shrink-0 text-sm">{phase.label}</Label>
                    <Select
                      value={phaseModels[phase.id]}
                      onValueChange={(val) => setPhaseModels((p) => ({ ...p, [phase.id]: val }))}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AI_MODELS.map((m) => (
                          <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                <Button className="w-full gap-2" onClick={() => toast.success("Modell routing mentve!")}>
                  <Save className="w-4 h-4" />
                  Mentés
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Users Tab */}
          <TabsContent value="users">
            <Card>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {MOCK_USERS.map((user) => (
                    <div key={user.id} className="flex items-center gap-4 px-6 py-4">
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary flex-shrink-0">
                        {user.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{user.name}</p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <Badge variant={user.role === "admin" ? "default" : "secondary"} className="text-xs">
                          {user.role}
                        </Badge>
                        <span className="text-sm font-bold text-primary">{user.credits} kr.</span>
                        <span className="text-xs text-muted-foreground">{user.researches} kutatás</span>
                        <Button variant="outline" size="sm" onClick={() => toast.info("Kredit módosítás — hamarosan")}>
                          Szerkesztés
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Audit Log Tab */}
          <TabsContent value="audit">
            <Card>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {MOCK_AUDIT_LOG.map((log) => (
                    <div key={log.id} className="flex items-center gap-4 px-6 py-3">
                      <div className="flex-shrink-0">
                        {log.status === "success" ? (
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-red-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-mono">{log.action}</p>
                        <p className="text-xs text-muted-foreground">{log.user} · {log.ip}</p>
                      </div>
                      <div className="text-xs text-muted-foreground flex-shrink-0">{log.ts}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
