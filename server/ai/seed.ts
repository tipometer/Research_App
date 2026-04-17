import { modelRouting } from "../../drizzle/schema";
import { getDb } from "../db";

/**
 * Idempotently seeds the modelRouting table with C1 defaults.
 *
 * IMPORTANT: the model names below are FAMILY names as of 2026-04-17.
 * For production, replace with the EXACT versioned API IDs from provider docs:
 *   - Anthropic:  claude-sonnet-4-6-YYYYMMDD     (e.g. claude-sonnet-4-6-20251001)
 *   - OpenAI:     gpt-4.1-mini-YYYY-MM-DD        (e.g. gpt-4.1-mini-2025-04-14)
 *   - Google:     gemini-2.5-flash                (family name usually OK)
 *
 * Update this comment with the date these IDs were confirmed from provider docs.
 * Admin UI "Model Routing" tab overrides these at runtime — seed is only the
 * first-deploy default.
 */
const DEFAULTS = [
  { phase: "wide_scan" as const,     primaryModel: "gemini-2.5-flash" },
  { phase: "gap_detection" as const, primaryModel: "gemini-2.5-flash" },
  { phase: "deep_dives" as const,    primaryModel: "gemini-2.5-flash" },
  { phase: "synthesis" as const,     primaryModel: "claude-sonnet-4-6" },
  { phase: "polling" as const,       primaryModel: "gpt-4.1-mini" },
  { phase: "brainstorm" as const,    primaryModel: "gpt-4.1-mini" },
];

export async function seedModelRouting(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[seed] No DB connection available, skipping.");
    return;
  }

  const existing = await db.select().from(modelRouting).limit(1);
  if (existing.length > 0) {
    console.log("[seed] modelRouting already populated, skipping.");
    return;
  }

  await db.insert(modelRouting).values(DEFAULTS);
  console.log(`[seed] Inserted ${DEFAULTS.length} default modelRouting rows.`);
}

// Allow running standalone: `corepack pnpm db:seed`
if (import.meta.url === `file://${process.argv[1]}`) {
  seedModelRouting().then(
    () => process.exit(0),
    (err) => { console.error(err); process.exit(1); }
  );
}
