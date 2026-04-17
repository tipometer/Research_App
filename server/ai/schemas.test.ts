import { describe, it, expect } from "vitest";
import {
  WideScanSchema,
  GapDetectionSchema,
  DeepDivesSchema,
  SynthesisSchema,
  PollingSchema,
  BrainstormSchema,
} from "./schemas";

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
  it("accepts valid input with full markdown", () => {
    const valid = {
      verdict: "GO" as const,
      synthesisScore: 7.5,
      scores: {
        marketSize: 8.0, competition: 6.5, feasibility: 7.0,
        monetization: 7.5, timeliness: 8.5,
      },
      reportMarkdown: "x".repeat(4500),
      verdictReason: "x".repeat(100),
    };
    expect(SynthesisSchema.parse(valid)).toEqual(valid);
  });
  it("rejects reportMarkdown shorter than 4000 chars", () => {
    expect(() => SynthesisSchema.parse({
      verdict: "GO",
      synthesisScore: 7.5,
      scores: { marketSize: 8, competition: 6, feasibility: 7, monetization: 7, timeliness: 8 },
      reportMarkdown: "x".repeat(3000),
      verdictReason: "x".repeat(100),
    })).toThrow();
  });
  it("accepts scores outside 0-10 — range enforced by prompt + post-parse clamp, not schema", () => {
    // Anthropic's structured output doesn't support minimum/maximum on number types,
    // so the schema itself is permissive. Range is enforced by the synthesis prompt
    // and clamped post-parse in runPhase4Stream.
    const result = SynthesisSchema.parse({
      verdict: "GO",
      synthesisScore: 7.5,
      scores: { marketSize: 11, competition: 6, feasibility: 7, monetization: 7, timeliness: 8 },
      reportMarkdown: "x".repeat(4500),
      verdictReason: "x".repeat(100),
    });
    expect(result.scores.marketSize).toBe(11);
  });
  it("rejects invalid verdict", () => {
    expect(() => SynthesisSchema.parse({
      verdict: "MAYBE",
      synthesisScore: 7.5,
      scores: { marketSize: 8, competition: 6, feasibility: 7, monetization: 7, timeliness: 8 },
      reportMarkdown: "x".repeat(4500),
      verdictReason: "x".repeat(100),
    })).toThrow();
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
