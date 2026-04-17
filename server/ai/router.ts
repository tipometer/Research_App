import { and, eq } from "drizzle-orm";
import { aiConfigs, modelRouting } from "../../drizzle/schema";
import { getDb } from "../db";
import { getProvider, type ProviderId } from "./providers";

export type Phase = "wide_scan" | "gap_detection" | "deep_dives" | "synthesis" | "polling" | "brainstorm";

const HARDCODED_DEFAULTS: Record<Phase, string> = {
  wide_scan: "gemini-2.5-flash",
  gap_detection: "gemini-2.5-flash",
  deep_dives: "gemini-2.5-flash",
  synthesis: "claude-sonnet-4-6",
  polling: "gpt-4.1-mini",
  brainstorm: "gpt-4.1-mini",
};

export function detectProvider(modelName: string): ProviderId {
  if (modelName.startsWith("gemini-")) return "gemini";
  if (modelName.startsWith("gpt-") || modelName.startsWith("o3-") || modelName.startsWith("o4-")) return "openai";
  if (modelName.startsWith("claude-")) return "anthropic";
  throw new Error(`Unknown provider for model: ${modelName}`);
}

export async function lookupModel(phase: Phase): Promise<string> {
  const db = await getDb();
  if (db) {
    const rows = await db
      .select({ primaryModel: modelRouting.primaryModel })
      .from(modelRouting)
      .where(eq(modelRouting.phase, phase))
      .limit(1);
    if (rows.length > 0 && rows[0].primaryModel) return rows[0].primaryModel;
  }
  const envKey = `DEFAULT_MODEL_${phase.toUpperCase()}`;
  const envValue = process.env[envKey];
  if (envValue) return envValue;
  const fallback = HARDCODED_DEFAULTS[phase];
  if (fallback) return fallback;
  throw new Error(`No model configured for phase: ${phase}`);
}

export async function lookupApiKey(provider: ProviderId): Promise<string> {
  const db = await getDb();
  if (db) {
    const rows = await db
      .select({ apiKey: aiConfigs.apiKey })
      .from(aiConfigs)
      .where(and(eq(aiConfigs.provider, provider), eq(aiConfigs.isActive, true)))
      .limit(1);
    if (rows.length > 0 && rows[0].apiKey) return rows[0].apiKey;
  }
  const envKey = `${provider.toUpperCase()}_API_KEY`;
  const envValue = process.env[envKey];
  if (envValue) return envValue;
  throw new Error(`No API key configured for provider: ${provider}`);
}

/**
 * Resolves (model, provider, client) for a given phase.
 * Used by pipeline-phases.ts (Task 8/9) to obtain a ready-to-call SDK instance.
 */
export async function resolvePhase(phase: Phase): Promise<{
  model: string;
  provider: ProviderId;
  client: ReturnType<typeof getProvider>;
}> {
  const model = await lookupModel(phase);
  const provider = detectProvider(model);
  const apiKey = await lookupApiKey(provider);
  const client = getProvider(provider, apiKey);
  return { model, provider, client };
}
