/**
 * Synthesis → Evidence + Decision Snapshot mapper (Validation Workspace sprint V2).
 *
 * Converts the output of the existing synthesis phase into structured rows in
 * the `evidence` and `decision_snapshots` tables. This is the sprint's only
 * new orchestration seam — all other changes are schema / prompt / endpoint
 * additions. See `backend_scope_v2_autonomous.md` §5.3, §5.5.
 *
 * Design notes:
 *
 *   1. **Additive only.** This module does NOT touch the `researches`, `sources`,
 *      or `research_phases` tables. The existing pipeline keeps writing there.
 *      The mapper writes two NEW tables in parallel.
 *
 *   2. **Graceful degradation.** If any insert fails, the caller (pipeline
 *      completion hook in research-pipeline.ts) should catch and log — the
 *      research must still reach `status='done'` so the classic report keeps
 *      working. This mapper DOES throw on failure; the catch lives at the hook.
 *
 *   3. **Web-source evidence** (one row per deduplicated `ExtractedSource`):
 *      - `claim` = snippet when non-empty, else title (avoid empty claims)
 *      - `sourceQuality` mapped from `sourceType` (academic/industry→high,
 *        news/blog→medium, community→low)
 *      - `dimensions = []` because groundingChunks arrive un-tagged. The UI's
 *        "by dimension" filter won't surface them; a general-evidence panel will.
 *      - `stance = 'neutral'`, `confidence = null` — we don't know.
 *
 *   4. **Synthesis-claim evidence** (one row per `SynthesisClaim`):
 *      - Claim carries its own `dimensions`, `stance`, `confidence` — trust them.
 *      - No source_* fields (claims are LLM-synthesized, not single-URL derived).
 *
 *   5. **Decision snapshot** (single row per research for v1):
 *      - `rationale` wraps the single `verdictReason` string into a 1-element
 *        array — the schema is array-shaped for future multi-reason support.
 *      - `evidenceVersion = 1` always for now; future re-computation sprints
 *        will increment.
 *      - `evidenceCount` is the total rows the mapper persisted in this run.
 */
import type { MySql2Database } from "drizzle-orm/mysql2";
import { evidence, decisionSnapshots } from "../drizzle/schema";
import type { InsertEvidence, InsertDecisionSnapshot } from "../drizzle/schema";
import type { SynthesisOutput, SynthesisClaim, Dimension } from "./ai/schemas";

// Mirror the shape `research-pipeline.ts` uses for `allSources` — the mapper
// accepts either the ExtractedSource type from ai/grounding.ts or plain objects
// of the same shape. We use structural typing to avoid an import cycle.
export interface MapperSource {
  url: string;
  title: string;
  snippet: string;
  sourceType: string; // "academic" | "industry" | "news" | "blog" | "community"
  publishedAt: string | null;
}

export interface MapperInput {
  researchId: number;
  synthesis: SynthesisOutput;
  sources: MapperSource[];
  /**
   * Optional pointer to the research_phases row for this synthesis run.
   * Persisted on the decision_snapshot for audit traceability. If the caller
   * didn't insert a phase row (e.g., in-memory smoke test), pass undefined.
   */
  sourceSynthesisId?: number | null;
}

export interface MapperResult {
  evidenceInserted: number;
  snapshotId: number;
  webSourceEvidenceCount: number;
  synthesisClaimEvidenceCount: number;
}

const QUALITY_BY_SOURCE_TYPE: Record<string, "high" | "medium" | "low" | null> = {
  academic: "high",
  industry: "high",
  news: "medium",
  blog: "medium",
  community: "low",
};

function qualityForSourceType(sourceType: string): "high" | "medium" | "low" | null {
  return QUALITY_BY_SOURCE_TYPE[sourceType] ?? null;
}

/**
 * Deduplicate sources by URL, keeping the first occurrence. Sources arrive
 * aggregated from phases 1-3 and the same URL frequently surfaces in multiple
 * phases — one evidence row per unique URL is cleaner for downstream UX.
 */
export function dedupeSourcesByUrl(sources: MapperSource[]): MapperSource[] {
  const seen = new Set<string>();
  const out: MapperSource[] = [];
  for (const s of sources) {
    if (!s.url || seen.has(s.url)) continue;
    seen.add(s.url);
    out.push(s);
  }
  return out;
}

/** Map an ExtractedSource-shaped object to a web_source evidence insert row. */
export function mapWebSourceEvidence(
  source: MapperSource,
  researchId: number,
): InsertEvidence {
  // Prefer snippet (segment text from groundingSupports) as the claim; fall
  // back to title when grounding didn't produce a support segment. Truncate
  // to a sane cap — evidence.claim is TEXT and has no hard limit, but overly
  // long claims degrade the UI.
  const rawClaim = (source.snippet && source.snippet.trim()) || source.title || "(no claim)";
  const claim = rawClaim.length > 1000 ? rawClaim.slice(0, 997) + "..." : rawClaim;

  return {
    researchId,
    type: "web_source",
    claim,
    sourceUrl: source.url,
    sourceTitle: source.title?.slice(0, 512) ?? null,
    sourceDate: null, // groundingChunks never carry publishedAt in current v6 API
    sourceQuality: qualityForSourceType(source.sourceType),
    confidence: null,
    dimensions: [] as Dimension[], // un-tagged at source level — see design note 3
    stance: "neutral",
    rawPayload: source,
  };
}

/** Map a SynthesisClaim to a synthesis_claim evidence insert row. */
export function mapSynthesisClaimEvidence(
  claim: SynthesisClaim,
  researchId: number,
): InsertEvidence {
  return {
    researchId,
    type: "synthesis_claim",
    claim: claim.claim,
    sourceUrl: null,
    sourceTitle: null,
    sourceDate: null,
    sourceQuality: null,
    // Confidence stored as fixed(3,2) — format the number for drizzle decimal
    // columns (drizzle-orm expects string for decimal inserts).
    confidence: claim.confidence.toFixed(2),
    dimensions: claim.dimensions,
    stance: claim.stance,
    rawPayload: claim,
  };
}

/**
 * Build the single decision_snapshot insert row for a research run. The
 * evidenceCount is passed in by the caller because the mapper inserts the
 * evidence rows first and counts them before constructing the snapshot.
 */
export function buildDecisionSnapshot(
  input: {
    researchId: number;
    synthesis: SynthesisOutput;
    evidenceCount: number;
    sourceSynthesisId?: number | null;
  },
): InsertDecisionSnapshot {
  const { researchId, synthesis, evidenceCount, sourceSynthesisId } = input;
  return {
    researchId,
    scores: {
      market_size: synthesis.scores.marketSize,
      competition: synthesis.scores.competition,
      feasibility: synthesis.scores.feasibility,
      monetization: synthesis.scores.monetization,
      timeliness: synthesis.scores.timeliness,
    },
    verdict: synthesis.verdict,
    rationale: [synthesis.verdictReason], // schema is array-shaped for future multi-reason support
    positiveDrivers: synthesis.positiveDrivers,
    negativeDrivers: synthesis.negativeDrivers,
    missingEvidence: synthesis.missingEvidence,
    nextActions: synthesis.nextActions,
    evidenceVersion: 1,
    evidenceCount,
    sourceSynthesisId: sourceSynthesisId ?? null,
  };
}

/**
 * Orchestrate the full persistence pass:
 *   1. Deduplicate sources, build evidence rows
 *   2. Insert evidence (single multi-row insert for efficiency)
 *   3. Build + insert the decision_snapshot, referencing the total evidence count
 *
 * Returns counts for the caller to log. Throws on DB error — the caller
 * (pipeline completion hook) is responsible for catching and degrading
 * gracefully so the research completion isn't blocked.
 */
export async function persistEvidenceAndSnapshot(
  db: MySql2Database<Record<string, unknown>>,
  input: MapperInput,
): Promise<MapperResult> {
  const dedupedSources = dedupeSourcesByUrl(input.sources);
  const webSourceRows = dedupedSources.map((s) => mapWebSourceEvidence(s, input.researchId));
  const claimRows = input.synthesis.synthesisClaims.map((c) =>
    mapSynthesisClaimEvidence(c, input.researchId),
  );

  const evidenceRows = [...webSourceRows, ...claimRows];

  // drizzle-orm MySQL insert doesn't return inserted rows by default; we don't
  // need the individual IDs here — count is sufficient for the snapshot.
  if (evidenceRows.length > 0) {
    await db.insert(evidence).values(evidenceRows);
  }

  const snapshotRow = buildDecisionSnapshot({
    researchId: input.researchId,
    synthesis: input.synthesis,
    evidenceCount: evidenceRows.length,
    sourceSynthesisId: input.sourceSynthesisId,
  });

  const [insertHeader] = await db.insert(decisionSnapshots).values(snapshotRow);
  // mysql2 returns a ResultSetHeader-like object with `insertId` for auto-inc PKs.
  const snapshotId = (insertHeader as { insertId?: number } | undefined)?.insertId ?? 0;

  return {
    evidenceInserted: evidenceRows.length,
    snapshotId,
    webSourceEvidenceCount: webSourceRows.length,
    synthesisClaimEvidenceCount: claimRows.length,
  };
}
