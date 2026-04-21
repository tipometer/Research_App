import { describe, it, expect } from "vitest";
import {
  WideScanSchema,
  GapDetectionSchema,
  DeepDivesSchema,
  SynthesisSchema,
  SynthesisClaimSchema,
  PollingSchema,
  BrainstormSchema,
  EvidenceRowSchema,
  DecisionSnapshotRowSchema,
  DimensionEnum,
} from "./schemas";
import type { Evidence, DecisionSnapshot } from "../../drizzle/schema";

// Helper: build a valid SynthesisOutput fixture. Tests that want to exercise
// specific fields override via `overrides`.
function validSynthesis(overrides: Record<string, unknown> = {}) {
  return {
    verdict: "GO" as const,
    synthesisScore: 7.5,
    scores: {
      marketSize: 8.0, competition: 6.5, feasibility: 7.0,
      monetization: 7.5, timeliness: 8.5,
    },
    reportMarkdown: "x".repeat(4500),
    verdictReason: "x".repeat(100),
    positiveDrivers: ["Growing TAM per 2025 data.", "Weak incumbents."],
    negativeDrivers: ["Regulatory uncertainty.", "Long sales cycle."],
    missingEvidence: ["No pricing data from SMB segment."],
    nextActions: [
      "Run pricing survey on 50 SMB owners.",
      "Prototype MVP in 2 weeks.",
      "Interview 5 target users.",
    ],
    synthesisClaims: [
      { claim: "Market grows 20% YoY.", dimensions: ["market_size"], stance: "supports" as const, confidence: 0.85 },
      { claim: "Three incumbents dominate.", dimensions: ["competition"], stance: "weakens" as const, confidence: 0.7 },
      { claim: "Tech stack is mature.", dimensions: ["feasibility"], stance: "supports" as const, confidence: 0.9 },
    ],
    ...overrides,
  };
}

describe("WideScanSchema", () => {
  it("accepts valid input", () => {
    const valid = {
      keywords: ["ai", "research", "market"],
      summary: "A".repeat(100),
    };
    expect(WideScanSchema.parse(valid)).toEqual(valid);
  });
  it("rejects fewer than 3 keywords", () => {
    expect(() => WideScanSchema.parse({ keywords: ["a", "b"], summary: "x".repeat(60) })).toThrow();
  });
  it("rejects summary shorter than 50 chars", () => {
    expect(() => WideScanSchema.parse({ keywords: ["a", "b", "c"], summary: "short" })).toThrow();
  });
  it("does NOT allow a `sources` field (stripped by parse)", () => {
    const withSources = { keywords: ["a", "b", "c"], summary: "x".repeat(60), sources: [] };
    const result = WideScanSchema.parse(withSources);
    expect("sources" in result).toBe(false);
  });
});

describe("GapDetectionSchema", () => {
  it("accepts valid input", () => {
    const valid = {
      gaps: [{ title: "gap1", description: "desc1" }, { title: "gap2", description: "desc2" }],
      competitors: [{ name: "c1", weakness: "w1" }, { name: "c2", weakness: "w2" }],
      summary: "x".repeat(60),
    };
    expect(GapDetectionSchema.parse(valid)).toEqual(valid);
  });
  it("rejects less than 2 gaps", () => {
    expect(() => GapDetectionSchema.parse({
      gaps: [{ title: "g", description: "d" }],
      competitors: [{ name: "c1", weakness: "w1" }, { name: "c2", weakness: "w2" }],
      summary: "x".repeat(60),
    })).toThrow();
  });
});

describe("DeepDivesSchema", () => {
  it("accepts valid input with nullable revenueEstimate", () => {
    const valid = {
      monetizationModels: [
        { name: "m1", description: "d1", revenueEstimate: null },
        { name: "m2", description: "d2", revenueEstimate: "$10k/mo" },
      ],
      technicalChallenges: [
        { title: "t1", severity: "low" as const },
        { title: "t2", severity: "high" as const },
      ],
      summary: "x".repeat(60),
    };
    expect(DeepDivesSchema.parse(valid)).toEqual(valid);
  });
  it("rejects invalid severity", () => {
    expect(() => DeepDivesSchema.parse({
      monetizationModels: [{ name: "m1", description: "d1" }, { name: "m2", description: "d2" }],
      technicalChallenges: [{ title: "t", severity: "critical" }],
      summary: "x".repeat(60),
    })).toThrow();
  });
});

describe("SynthesisSchema", () => {
  it("accepts valid input with full markdown and all validation-workspace fields", () => {
    const valid = validSynthesis();
    expect(SynthesisSchema.parse(valid)).toEqual(valid);
  });
  it("rejects reportMarkdown shorter than 4000 chars", () => {
    expect(() => SynthesisSchema.parse(validSynthesis({ reportMarkdown: "x".repeat(3000) }))).toThrow();
  });
  it("accepts scores outside 0-10 — range enforced by prompt + post-parse clamp, not schema", () => {
    // Anthropic's structured output doesn't support minimum/maximum on number types,
    // so the schema itself is permissive. Range is enforced by the synthesis prompt
    // and clamped post-parse in runPhase4Stream.
    const result = SynthesisSchema.parse(
      validSynthesis({ scores: { marketSize: 11, competition: 6, feasibility: 7, monetization: 7, timeliness: 8 } }),
    );
    expect(result.scores.marketSize).toBe(11);
  });
  it("rejects invalid verdict", () => {
    expect(() => SynthesisSchema.parse(validSynthesis({ verdict: "MAYBE" }))).toThrow();
  });
  it("accepts any positiveDrivers count at schema level (cardinality enforced in prompt + post-parse truncator)", () => {
    // Anthropic structured output rejects minItems/maxItems > 1 on arrays, so
    // the schema stays permissive. Low counts are intentionally allowed —
    // clampSynthesisOutput truncates high counts; low counts pass through as
    // graceful degradation.
    expect(SynthesisSchema.parse(validSynthesis({ positiveDrivers: [] })).positiveDrivers).toEqual([]);
    expect(SynthesisSchema.parse(validSynthesis({ positiveDrivers: ["only one"] })).positiveDrivers).toHaveLength(1);
  });
  it("accepts oversized arrays at schema level — truncator handles trimming", () => {
    const parsed = SynthesisSchema.parse(
      validSynthesis({ negativeDrivers: ["a", "b", "c", "d", "e", "f", "g"] }),
    );
    expect(parsed.negativeDrivers).toHaveLength(7); // schema passes, truncation is runtime
  });
  it("accepts empty missingEvidence (AI can be confident enough to list none)", () => {
    const parsed = SynthesisSchema.parse(validSynthesis({ missingEvidence: [] }));
    expect(parsed.missingEvidence).toEqual([]);
  });
  it("accepts synthesisClaims with fewer than 3 entries (graceful degradation)", () => {
    const parsed = SynthesisSchema.parse(
      validSynthesis({
        synthesisClaims: [
          { claim: "c1", dimensions: ["market_size"], stance: "supports", confidence: 0.9 },
          { claim: "c2", dimensions: ["competition"], stance: "weakens", confidence: 0.8 },
        ],
      }),
    );
    expect(parsed.synthesisClaims).toHaveLength(2);
  });
  it("accepts confidence outside [0,1] — range enforced by prompt + post-parse clamp, not schema", () => {
    // Mirror of the existing 0-10 score relaxation: Anthropic rejects numeric
    // min/max in JSON Schema, so Zod stays permissive. Runtime clamp in
    // clampSynthesisOutput (pipeline-phases.ts) corrects the value.
    const parsed = SynthesisSchema.parse(
      validSynthesis({
        synthesisClaims: [
          { claim: "c1", dimensions: ["market_size"], stance: "supports", confidence: 1.5 },
          { claim: "c2", dimensions: ["competition"], stance: "weakens", confidence: -0.3 },
          { claim: "c3", dimensions: ["feasibility"], stance: "neutral", confidence: 0.5 },
        ],
      }),
    );
    expect(parsed.synthesisClaims[0].confidence).toBe(1.5);
    expect(parsed.synthesisClaims[1].confidence).toBe(-0.3);
  });
});

describe("SynthesisClaimSchema", () => {
  it("accepts a typical supports claim", () => {
    const parsed = SynthesisClaimSchema.parse({
      claim: "Market grows 20% YoY.",
      dimensions: ["market_size", "timeliness"],
      stance: "supports",
      confidence: 0.85,
    });
    expect(parsed.stance).toBe("supports");
    expect(parsed.dimensions).toHaveLength(2);
  });
  it("rejects unknown dimension", () => {
    expect(() =>
      SynthesisClaimSchema.parse({
        claim: "x",
        dimensions: ["regulatory_risk"],
        stance: "neutral",
        confidence: 0.5,
      }),
    ).toThrow();
  });
  it("rejects unknown stance", () => {
    expect(() =>
      SynthesisClaimSchema.parse({
        claim: "x",
        dimensions: ["market_size"],
        stance: "unsure",
        confidence: 0.5,
      }),
    ).toThrow();
  });
});

describe("PollingSchema", () => {
  it("accepts 3-5 questions with null options for non-choice types", () => {
    const valid = {
      questions: [
        { id: "q1", type: "single_choice" as const, text: "Q1?", options: ["a", "b"] },
        { id: "q2", type: "likert" as const, text: "Q2?", options: null },
        { id: "q3", type: "short_text" as const, text: "Q3?", options: null },
      ],
    };
    expect(PollingSchema.parse(valid)).toEqual(valid);
  });
  it("rejects more than 5 questions", () => {
    const invalid = {
      questions: Array(6).fill({ id: "q", type: "short_text", text: "Q?" }),
    };
    expect(() => PollingSchema.parse(invalid)).toThrow();
  });
});

describe("EvidenceRowSchema", () => {
  it("accepts a valid web_source row", () => {
    const row = {
      id: 1,
      researchId: 42,
      type: "web_source" as const,
      claim: "Market size is growing 20% YoY.",
      sourceUrl: "https://example.com/report",
      sourceTitle: "Q1 Market Report",
      sourceDate: new Date("2026-01-15"),
      sourceQuality: "high" as const,
      confidence: 0.85,
      dimensions: ["market_size", "timeliness"],
      stance: "supports" as const,
      rawPayload: { raw: "chunk" },
      createdAt: new Date(),
    };
    const parsed = EvidenceRowSchema.parse(row);
    expect(parsed.confidence).toBe(0.85);
    expect(parsed.dimensions).toEqual(["market_size", "timeliness"]);
  });

  it("coerces MySQL decimal string confidence to number", () => {
    const row = {
      id: 2,
      researchId: 42,
      type: "synthesis_claim" as const,
      claim: "Competition is heavy.",
      sourceUrl: null,
      sourceTitle: null,
      sourceDate: null,
      sourceQuality: null,
      confidence: "0.67", // mysql2 returns decimal as string
      dimensions: ["competition"],
      stance: "weakens" as const,
      rawPayload: null,
      createdAt: new Date(),
    };
    const parsed = EvidenceRowSchema.parse(row);
    expect(parsed.confidence).toBe(0.67);
  });

  it("rejects unknown evidence type", () => {
    expect(() =>
      EvidenceRowSchema.parse({
        id: 1,
        researchId: 1,
        type: "survey_result", // not in this sprint's enum
        claim: "x",
        sourceUrl: null,
        sourceTitle: null,
        sourceDate: null,
        sourceQuality: null,
        confidence: null,
        dimensions: ["market_size"],
        stance: "neutral",
        rawPayload: null,
        createdAt: new Date(),
      }),
    ).toThrow();
  });

  it("rejects unknown dimension", () => {
    expect(() =>
      EvidenceRowSchema.parse({
        id: 1,
        researchId: 1,
        type: "web_source",
        claim: "x",
        sourceUrl: null,
        sourceTitle: null,
        sourceDate: null,
        sourceQuality: null,
        confidence: null,
        dimensions: ["regulatory_risk"], // not in dimension enum
        stance: "neutral",
        rawPayload: null,
        createdAt: new Date(),
      }),
    ).toThrow();
  });

  it("DimensionEnum lists the five radar axes", () => {
    expect(DimensionEnum.options).toEqual([
      "market_size",
      "competition",
      "feasibility",
      "monetization",
      "timeliness",
    ]);
  });

  it("row shape is compatible with Drizzle $inferSelect (compile-time)", () => {
    // Type-level assertion: any Drizzle-inferred Evidence row must satisfy the
    // runtime Zod schema's input type. If this stops compiling, the schema and
    // DB table have drifted.
    const _assertAssignable = (_row: Evidence): Parameters<typeof EvidenceRowSchema.parse>[0] => _row;
    expect(typeof _assertAssignable).toBe("function");
  });
});

describe("DecisionSnapshotRowSchema", () => {
  it("accepts a valid snapshot row", () => {
    const row = {
      id: 10,
      researchId: 42,
      scores: {
        market_size: 7.5,
        competition: 5.0,
        feasibility: 6.2,
        monetization: 8.0,
        timeliness: 7.1,
      },
      verdict: "GO" as const,
      rationale: ["Strong market signal", "Low competition barrier"],
      positiveDrivers: ["Growing TAM", "Weak incumbents"],
      negativeDrivers: ["Regulatory uncertainty"],
      missingEvidence: ["No willingness-to-pay data"],
      nextActions: ["Run pricing survey", "Prototype MVP", "Interview 5 users"],
      evidenceVersion: 1,
      evidenceCount: 12,
      sourceSynthesisId: 99,
      createdAt: new Date(),
    };
    const parsed = DecisionSnapshotRowSchema.parse(row);
    expect(parsed.verdict).toBe("GO");
    expect(parsed.scores.market_size).toBe(7.5);
  });

  it("accepts null optional driver arrays", () => {
    const row = {
      id: 11,
      researchId: 42,
      scores: {
        market_size: 3.0,
        competition: 9.0,
        feasibility: 2.0,
        monetization: 4.0,
        timeliness: 3.0,
      },
      verdict: "KILL" as const,
      rationale: ["Saturated market"],
      positiveDrivers: null,
      negativeDrivers: null,
      missingEvidence: null,
      nextActions: null,
      evidenceVersion: 1,
      evidenceCount: 0,
      sourceSynthesisId: null,
      createdAt: new Date(),
    };
    const parsed = DecisionSnapshotRowSchema.parse(row);
    expect(parsed.verdict).toBe("KILL");
    expect(parsed.positiveDrivers).toBeNull();
  });

  it("rejects unknown verdict", () => {
    expect(() =>
      DecisionSnapshotRowSchema.parse({
        id: 1,
        researchId: 1,
        scores: { market_size: 1, competition: 1, feasibility: 1, monetization: 1, timeliness: 1 },
        verdict: "MAYBE",
        rationale: [],
        positiveDrivers: null,
        negativeDrivers: null,
        missingEvidence: null,
        nextActions: null,
        evidenceVersion: 1,
        evidenceCount: 0,
        sourceSynthesisId: null,
        createdAt: new Date(),
      }),
    ).toThrow();
  });

  it("row shape is compatible with Drizzle $inferSelect (compile-time)", () => {
    const _assertAssignable = (_row: DecisionSnapshot): Parameters<typeof DecisionSnapshotRowSchema.parse>[0] => _row;
    expect(typeof _assertAssignable).toBe("function");
  });
});

describe("BrainstormSchema", () => {
  it("accepts exactly 10 ideas", () => {
    const valid = {
      ideas: Array(10).fill(null).map((_, i) => ({
        id: `idea-${i}`,
        title: `Idea ${i}`,
        description: `Description ${i}`.repeat(5),
      })),
    };
    expect(BrainstormSchema.parse(valid)).toEqual(valid);
  });
  it("rejects 9 ideas", () => {
    const invalid = {
      ideas: Array(9).fill(null).map((_, i) => ({
        id: `idea-${i}`, title: `Idea ${i}`, description: "d",
      })),
    };
    expect(() => BrainstormSchema.parse(invalid)).toThrow();
  });
});
