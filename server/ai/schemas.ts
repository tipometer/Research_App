import { z } from "zod";

export const WideScanSchema = z.object({
  keywords: z.array(z.string()).min(3).max(7),
  summary: z.string().min(50).max(1500),
});
export type WideScanOutput = z.infer<typeof WideScanSchema>;

export const GapDetectionSchema = z.object({
  gaps: z.array(z.object({
    title: z.string(),
    description: z.string(),
  })).min(2).max(5),
  competitors: z.array(z.object({
    name: z.string(),
    weakness: z.string(),
  })).min(2).max(5),
  summary: z.string().min(50).max(1500),
});
export type GapDetectionOutput = z.infer<typeof GapDetectionSchema>;

export const DeepDivesSchema = z.object({
  monetizationModels: z.array(z.object({
    name: z.string(),
    description: z.string(),
    revenueEstimate: z.string().nullable(),
  })).min(2).max(5),
  technicalChallenges: z.array(z.object({
    title: z.string(),
    severity: z.enum(["low", "medium", "high"]),
  })).min(2).max(5),
  summary: z.string().min(50).max(1500),
});
export type DeepDivesOutput = z.infer<typeof DeepDivesSchema>;

// Anthropic structured output constraints (discovered Day 4 live smoke):
//   1. Number types reject `minimum`/`maximum` JSON Schema properties (v3.2 changelog).
//   2. Array types reject `minItems`/`maxItems` with values other than 0 or 1
//      (400 Bad Request: "For 'array' type, 'minItems' values other than 0 or 1
//      are not supported"). String length constraints (min/max) remain supported.
// Pattern: keep the Zod schema permissive (no array cardinality, no number range),
// enforce desired counts via the prompt, and apply a post-parse guard in
// `clampSynthesisOutput` (pipeline-phases.ts) that truncates to the target max
// and leaves low-count outputs unchanged (graceful degradation — UI still
// renders, the business reviewer can judge quality at CP2).
export const SynthesisClaimSchema = z.object({
  claim: z.string(),
  dimensions: z.array(
    z.enum(["market_size", "competition", "feasibility", "monetization", "timeliness"]),
  ),
  stance: z.enum(["supports", "weakens", "neutral"]),
  confidence: z.number(), // [0,1] enforced by prompt + post-parse clamp
});
export type SynthesisClaim = z.infer<typeof SynthesisClaimSchema>;

export const SynthesisSchema = z.object({
  verdict: z.enum(["GO", "KILL", "CONDITIONAL"]),
  synthesisScore: z.number(),
  scores: z.object({
    marketSize:   z.number(),
    competition:  z.number(),
    feasibility:  z.number(),
    monetization: z.number(),
    timeliness:   z.number(),
  }),
  reportMarkdown: z.string().min(4000),
  verdictReason: z.string().min(50).max(1500),
  // Validation Workspace additive fields (sprint V2). Array cardinality is
  // enforced by the prompt (2-5, 0-7, 3-5, 3-10) and the post-parse truncator;
  // the schema itself is permissive to satisfy Anthropic's structured-output API.
  positiveDrivers: z.array(z.string()),
  negativeDrivers: z.array(z.string()),
  missingEvidence: z.array(z.string()),
  nextActions:     z.array(z.string()),
  synthesisClaims: z.array(SynthesisClaimSchema),
});
export type SynthesisOutput = z.infer<typeof SynthesisSchema>;

export const PollingSchema = z.object({
  questions: z.array(z.object({
    id: z.string(),
    type: z.enum(["single_choice", "multiple_choice", "likert", "short_text"]),
    text: z.string(),
    options: z.array(z.string()).nullable(),
  })).min(3).max(5),
});
export type PollingOutput = z.infer<typeof PollingSchema>;

export const BrainstormSchema = z.object({
  ideas: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().max(300),
  })).length(10),
});
export type BrainstormOutput = z.infer<typeof BrainstormSchema>;

// ─── Validation Workspace (additive, sprint V2) ───────────────────────────────
// DB row shape schemas for the `evidence` and `decision_snapshots` tables.
// Used by the synthesis-to-evidence-mapper and the validation.* tRPC router
// to validate persisted/returned rows.

export const DimensionEnum = z.enum([
  "market_size",
  "competition",
  "feasibility",
  "monetization",
  "timeliness",
]);
export type Dimension = z.infer<typeof DimensionEnum>;

// Sprint-scoped evidence types. Future additions (survey_result, manual_claim,
// csv_import) land in later sprints — column is varchar(32) to keep the schema
// stable through those additions.
export const EvidenceTypeEnum = z.enum(["web_source", "synthesis_claim"]);
export type EvidenceType = z.infer<typeof EvidenceTypeEnum>;

export const EvidenceStanceEnum = z.enum(["supports", "weakens", "neutral"]);
export type EvidenceStance = z.infer<typeof EvidenceStanceEnum>;

export const EvidenceSourceQualityEnum = z.enum(["low", "medium", "high"]);
export type EvidenceSourceQuality = z.infer<typeof EvidenceSourceQualityEnum>;

// Evidence row as returned from the DB. JSON columns are narrowed to the
// expected shapes. `confidence` comes back as a string from MySQL decimal
// columns via mysql2 — coerce defensively. Dates (`sourceDate`) come back as
// Date or null.
export const EvidenceRowSchema = z.object({
  id: z.number().int(),
  researchId: z.number().int(),
  type: EvidenceTypeEnum,
  claim: z.string(),
  sourceUrl: z.string().nullable(),
  sourceTitle: z.string().nullable(),
  sourceDate: z.date().nullable(),
  sourceQuality: EvidenceSourceQualityEnum.nullable(),
  confidence: z.coerce.number().min(0).max(1).nullable(),
  dimensions: z.array(DimensionEnum),
  stance: EvidenceStanceEnum,
  rawPayload: z.unknown().nullable(),
  createdAt: z.date(),
});
export type EvidenceRow = z.infer<typeof EvidenceRowSchema>;

// Snapshot row as returned from the DB. `scores` mirrors the researches table's
// 5-dimension shape. `verdict` matches the researches.verdict enum values.
export const SnapshotScoresSchema = z.object({
  market_size: z.number(),
  competition: z.number(),
  feasibility: z.number(),
  monetization: z.number(),
  timeliness: z.number(),
});
export type SnapshotScores = z.infer<typeof SnapshotScoresSchema>;

export const DecisionSnapshotRowSchema = z.object({
  id: z.number().int(),
  researchId: z.number().int(),
  scores: SnapshotScoresSchema,
  verdict: z.enum(["GO", "KILL", "CONDITIONAL"]),
  rationale: z.array(z.string()),
  positiveDrivers: z.array(z.string()).nullable(),
  negativeDrivers: z.array(z.string()).nullable(),
  missingEvidence: z.array(z.string()).nullable(),
  nextActions: z.array(z.string()).nullable(),
  evidenceVersion: z.number().int(),
  evidenceCount: z.number().int(),
  sourceSynthesisId: z.number().int().nullable(),
  createdAt: z.date(),
});
export type DecisionSnapshotRow = z.infer<typeof DecisionSnapshotRowSchema>;
