import { and, eq } from "drizzle-orm";
import { aiConfigs, modelRouting } from "../../drizzle/schema";
import { getDb } from "../db";
import { getProvider, type ProviderId } from "./providers";
import { decrypt, getMasterKey } from "./crypto";

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

/**
 * Single point-of-truth format detection + decrypt-or-passthrough for stored API keys.
 *
 * - `ENC1:...` prefix → decrypt via AES-256-GCM (throws DecryptionError on failure).
 * - Anything else → lazy-migration passthrough: returns the string verbatim and
 *   logs a WARN in dev/staging (silenced in production to avoid noise during
 *   the migration period).
 *
 * The `aad` parameter binds ciphertext to its provider context — see spec §4.4.
 *
 * Exported for reuse by admin routes (testProvider in server/routers.ts).
 */
export function decryptIfNeeded(stored: string, aad: string): string {
  if (!stored.startsWith("ENC1:")) {
    if (process.env.NODE_ENV !== "production") {
      // NOTE: AAD included intentionally for dev diagnostics — NOT a log hygiene bug.
      // The fallback-layer DecryptionError WARN (server/ai/fallback.ts) is different:
      // it MUST NOT include AAD. See Task 4.
      console.warn(
        `[crypto] Plaintext API key detected for ${aad} — ` +
        `will encrypt on next admin save (lazy migration)`
      );
    }
    return stored;
  }
  return decrypt(stored, getMasterKey(), aad);
}

export async function lookupApiKey(provider: ProviderId): Promise<string> {
  const db = await getDb();
  if (db) {
    const rows = await db
      .select({ apiKey: aiConfigs.apiKey })
      .from(aiConfigs)
      .where(and(eq(aiConfigs.provider, provider), eq(aiConfigs.isActive, true)))
      .limit(1);
    if (rows.length > 0 && rows[0].apiKey) {
      const aad = `aiConfig:${provider.toLowerCase()}`;
      return decryptIfNeeded(rows[0].apiKey, aad);
    }
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

/**
 * Resolves primary + fallback (model, provider, client) for a given phase.
 * Performs a single DB lookup to fetch both primaryModel and fallbackModel.
 * If fallbackModel is not configured or resolution fails, fallback is null.
 * Used by executeWithFallback (fallback.ts) to implement resilient phase execution.
 */
export async function resolvePhaseWithFallback(phase: Phase): Promise<{
  primary: { model: string; provider: ProviderId; client: ReturnType<typeof getProvider> };
  fallback: { model: string; provider: ProviderId; client: ReturnType<typeof getProvider> } | null;
}> {
  const db = await getDb();
  let primaryModel: string | undefined;
  let fallbackModel: string | null | undefined;

  if (db) {
    const rows = await db
      .select({ primaryModel: modelRouting.primaryModel, fallbackModel: modelRouting.fallbackModel })
      .from(modelRouting)
      .where(eq(modelRouting.phase, phase))
      .limit(1);
    if (rows.length > 0) {
      primaryModel = rows[0].primaryModel;
      fallbackModel = rows[0].fallbackModel;
    }
  }

  // Primary resolution (reuse lookupModel's ENV/hardcoded fallback chain if DB missed)
  const resolvedPrimaryModel = primaryModel ?? await lookupModel(phase);
  const primaryProvider = detectProvider(resolvedPrimaryModel);
  const primaryApiKey = await lookupApiKey(primaryProvider);
  const primaryClient = getProvider(primaryProvider, primaryApiKey);

  // Fallback resolution (optional)
  let fallback: {
    model: string;
    provider: ProviderId;
    client: ReturnType<typeof getProvider>;
  } | null = null;
  if (fallbackModel) {
    try {
      const fbProvider = detectProvider(fallbackModel);
      const fbApiKey = await lookupApiKey(fbProvider);
      fallback = {
        model: fallbackModel,
        provider: fbProvider,
        client: getProvider(fbProvider, fbApiKey),
      };
    } catch (err) {
      console.warn(`[router] Fallback for ${phase} misconfigured (${err instanceof Error ? err.message : err}). Proceeding without fallback.`);
      fallback = null;
    }
  }

  return {
    primary: { model: resolvedPrimaryModel, provider: primaryProvider, client: primaryClient },
    fallback,
  };
}
