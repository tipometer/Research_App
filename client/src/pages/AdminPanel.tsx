import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Activity, AlertCircle, CheckCircle2, Key, Loader2, Save, Settings, Shield, Users, Zap } from "lucide-react";
import { useState } from "react";
import { trpc } from "@/lib/trpc";

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

const PROVIDERS = ["openai", "anthropic", "gemini"] as const;
type ProviderId = typeof PROVIDERS[number];

const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
};

// ─── ProviderRow sub-component ───────────────────────────────────────────────
interface ProviderRowProps {
  provider: ProviderId;
  hasKey: boolean;
  isActive: boolean;
  onSave: (apiKey: string, isActive: boolean) => void;
  onTest: () => Promise<void>;
  isSaving: boolean;
  isTesting: boolean;
}

function ProviderRow({ provider, hasKey, isActive, onSave, onTest, isSaving, isTesting }: ProviderRowProps) {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState("");

  return (
    <div className="space-y-2 p-4 border rounded-lg">
      <div className="flex items-center justify-between">
        <Label className="font-medium">{PROVIDER_LABELS[provider]}</Label>
        <Badge variant={hasKey ? "default" : "secondary"} className="text-xs">
          {hasKey ? t("admin.ai.configured") : t("admin.ai.notSet")}
        </Badge>
      </div>
      <div className="flex gap-2">
        <Input
          type="password"
          placeholder={t("admin.ai.apiKeyPlaceholder")}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="font-mono text-sm flex-1"
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!apiKey || isSaving}
          onClick={() => {
            onSave(apiKey, isActive);
            setApiKey("");
          }}
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span className="ml-1">{t("admin.ai.save")}</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasKey || isTesting}
          onClick={onTest}
        >
          {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          <span>{t("admin.ai.testConnection")}</span>
        </Button>
      </div>
    </div>
  );
}

// ─── RoutingRow sub-component ─────────────────────────────────────────────────
interface RoutingRowData {
  phase: string;
  primaryModel: string;
  fallbackModel: string | null;
}

interface RoutingRowProps {
  row: RoutingRowData;
  onSave: (updated: { primaryModel: string; fallbackModel: string }) => void;
  isSaving: boolean;
}

function RoutingRow({ row, onSave, isSaving }: RoutingRowProps) {
  const { t } = useTranslation();
  const [primaryModel, setPrimaryModel] = useState(row.primaryModel);
  const [fallbackModel, setFallbackModel] = useState(row.fallbackModel ?? "");

  const phaseKey = row.phase as keyof typeof t extends never ? string : string;
  const phaseLabel = t(`admin.ai.phases.${row.phase}`, { defaultValue: row.phase });

  return (
    <TableRow>
      <TableCell className="font-medium w-36">{phaseLabel}</TableCell>
      <TableCell>
        <Input
          value={primaryModel}
          onChange={(e) => setPrimaryModel(e.target.value)}
          placeholder={t("admin.ai.primaryModel")}
          className="text-sm font-mono"
        />
      </TableCell>
      <TableCell>
        <Input
          value={fallbackModel}
          onChange={(e) => setFallbackModel(e.target.value)}
          placeholder={t("admin.ai.fallbackModel")}
          className="text-sm font-mono"
        />
      </TableCell>
      <TableCell className="w-20">
        <Button
          size="sm"
          variant="outline"
          disabled={isSaving}
          onClick={() => onSave({ primaryModel, fallbackModel })}
        >
          {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
        </Button>
      </TableCell>
    </TableRow>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function AdminPanel() {
  const { t } = useTranslation();

  // ── Providers ──
  const { data: configs, refetch: refetchConfigs } = trpc.admin.ai.listConfigs.useQuery();
  const [testingProvider, setTestingProvider] = useState<ProviderId | null>(null);
  const [savingProvider, setSavingProvider] = useState<ProviderId | null>(null);

  const setKey = trpc.admin.ai.setProviderKey.useMutation({
    onSuccess: (_data, variables) => {
      toast.success(t("admin.ai.keySaved"));
      setSavingProvider(null);
      refetchConfigs();
    },
    onError: (err) => {
      toast.error(err.message);
      setSavingProvider(null);
    },
  });

  const testProvider = trpc.admin.ai.testProvider.useMutation();

  // ── Model Routing ──
  const { data: routing, refetch: refetchRouting } = trpc.admin.ai.listRouting.useQuery();
  const [savingPhase, setSavingPhase] = useState<string | null>(null);

  const updateRouting = trpc.admin.ai.updateRouting.useMutation({
    onSuccess: () => {
      toast.success(t("admin.ai.routingSaved"));
      setSavingPhase(null);
      refetchRouting();
    },
    onError: (err) => {
      toast.error(err.message);
      setSavingPhase(null);
    },
  });

  const handleTestProvider = async (provider: ProviderId) => {
    setTestingProvider(provider);
    try {
      const result = await testProvider.mutateAsync({ provider });
      if (result.ok) {
        toast.success(t("admin.ai.testOk"));
      } else {
        toast.error(t("admin.ai.testFail") + ": " + (result.error ?? ""));
      }
    } finally {
      setTestingProvider(null);
    }
  };

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
              <Zap className="w-4 h-4" /> {t("admin.aiConfig")}
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-2">
              <Users className="w-4 h-4" /> {t("admin.users")}
            </TabsTrigger>
            <TabsTrigger value="audit" className="gap-2">
              <Activity className="w-4 h-4" /> {t("admin.auditLogs")}
            </TabsTrigger>
          </TabsList>

          {/* AI Config Tab — two sub-tabs: Providers + Model Routing */}
          <TabsContent value="ai-config" className="space-y-6">
            <Tabs defaultValue="providers">
              <TabsList className="mb-4">
                <TabsTrigger value="providers" className="gap-2">
                  <Key className="w-4 h-4" /> {t("admin.ai.providersTab")}
                </TabsTrigger>
                <TabsTrigger value="routing" className="gap-2">
                  <Settings className="w-4 h-4" /> {t("admin.ai.routingTab")}
                </TabsTrigger>
              </TabsList>

              {/* Providers sub-tab */}
              <TabsContent value="providers">
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <Key className="w-4 h-4 text-muted-foreground" />
                      <CardTitle className="text-base">{t("admin.ai.providersTab")}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {PROVIDERS.map((provider) => {
                      const config = configs?.find((c) => c.provider === provider);
                      return (
                        <ProviderRow
                          key={provider}
                          provider={provider}
                          hasKey={config?.hasKey ?? false}
                          isActive={config?.isActive ?? false}
                          isSaving={savingProvider === provider}
                          isTesting={testingProvider === provider}
                          onSave={(apiKey, isActive) => {
                            setSavingProvider(provider);
                            setKey.mutate({ provider, apiKey, isActive });
                          }}
                          onTest={() => handleTestProvider(provider)}
                        />
                      );
                    })}
                    <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      Az API kulcsok kizárólag szerver oldalon tárolódnak. A böngészőből soha nem érhetők el (CSP védett).
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Model Routing sub-tab */}
              <TabsContent value="routing">
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <Settings className="w-4 h-4 text-muted-foreground" />
                      <CardTitle className="text-base">{t("admin.ai.routingTab")}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {routing && routing.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Phase</TableHead>
                            <TableHead>{t("admin.ai.primaryModel")}</TableHead>
                            <TableHead>{t("admin.ai.fallbackModel")}</TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {routing.map((row) => (
                            <RoutingRow
                              key={row.phase}
                              row={row}
                              isSaving={savingPhase === row.phase}
                              onSave={(updated) => {
                                setSavingPhase(row.phase);
                                updateRouting.mutate({
                                  phase: row.phase as "wide_scan" | "gap_detection" | "deep_dives" | "synthesis" | "polling" | "brainstorm",
                                  primaryModel: updated.primaryModel,
                                  fallbackModel: updated.fallbackModel || undefined,
                                });
                              }}
                            />
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        {routing === undefined ? t("common.loading") : "No routing rows found in database."}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
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
                          {t("common.edit")}
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
