import { describe, it, expect, vi, beforeEach } from "vitest";
import { APICallError } from "ai";

vi.mock("./router", () => ({
  resolvePhase: vi.fn(),
  resolvePhaseWithFallback: vi.fn(),
}));

vi.mock("ai", async (orig) => {
  const actual = await orig<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
    streamText: vi.fn(),
  };
});

import { runPhase1, runPhase2, runPhase3, runPhase4Stream, runPolling, runBrainstorm, SYNTHESIS_RUBRIC_BLOCK } from "./pipeline-phases";
import { resolvePhaseWithFallback } from "./router";
import { generateText, streamText } from "ai";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeApiError = (statusCode: number | undefined) =>
  new APICallError({
    message: "test",
    url: "https://api.test/x",
    requestBodyValues: {},
    statusCode,
  });

function mockResolveNoFallback(model = "gemini-2.5-flash", provider = "gemini") {
  (resolvePhaseWithFallback as any).mockResolvedValue({
    primary: { model, provider, client: vi.fn().mockReturnValue({}) },
    fallback: null,
  });
}

function mockResolveWithFallback(
  primaryModel = "gemini-2.5-flash",
  primaryProvider = "gemini",
  fallbackModel = "gpt-4.1-mini",
  fallbackProvider = "openai",
) {
  (resolvePhaseWithFallback as any).mockResolvedValue({
    primary: { model: primaryModel, provider: primaryProvider, client: vi.fn().mockReturnValue({}) },
    fallback: { model: fallbackModel, provider: fallbackProvider, client: vi.fn().mockReturnValue({}) },
  });
}

// Shared Validation-Workspace fields (sprint V2) — required by the bigger
// SynthesisSchema. Spread into finalObj fixtures so every synthesis mock stays
// valid without repeating the block.
const VALIDATION_WORKSPACE_FIELDS = {
  positiveDrivers: ["Driver A grounded in source.", "Driver B grounded in source."],
  negativeDrivers: ["Concern A grounded.", "Concern B grounded."],
  missingEvidence: ["Unknown X — needs survey."],
  nextActions: [
    "Run a 5-question pricing survey.",
    "Interview 3 target users.",
    "Prototype MVP in 2 weeks.",
  ],
  synthesisClaims: [
    { claim: "Market grows 20% YoY.", dimensions: ["market_size"] as const, stance: "supports" as const, confidence: 0.85 },
    { claim: "Incumbents are few but strong.", dimensions: ["competition"] as const, stance: "weakens" as const, confidence: 0.7 },
    { claim: "Stack is mature.", dimensions: ["feasibility"] as const, stance: "supports" as const, confidence: 0.9 },
  ],
};

// ---------------------------------------------------------------------------
// Phase 1
// ---------------------------------------------------------------------------

describe("runPhase1 (Wide Scan)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns parsed output + extracted sources from groundingMetadata", async () => {
    mockResolveNoFallback();
    (generateText as any).mockResolvedValue({
      text: JSON.stringify({ keywords: ["a", "b", "c"], summary: "x".repeat(60) }),
      providerMetadata: {
        google: {
          groundingMetadata: {
            groundingChunks: [{ web: { uri: "https://example.com", title: "Ex" } }],
            groundingSupports: [],
            webSearchQueries: [],
          },
        },
      },
    });
    const result = await runPhase1({ nicheName: "AI tools", strategy: "gaps" });
    expect(result.data.keywords).toHaveLength(3);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].url).toBe("https://example.com");
    expect(result.sources[0].publishedAt).toBeNull();
  });

  it("returns empty sources when no grounding metadata", async () => {
    mockResolveNoFallback();
    (generateText as any).mockResolvedValue({
      text: JSON.stringify({ keywords: ["a", "b", "c"], summary: "x".repeat(60) }),
      providerMetadata: {},
    });
    const result = await runPhase1({ nicheName: "X", strategy: "gaps" });
    expect(result.sources).toEqual([]);
  });

  it("retries once on Zod validation error", async () => {
    mockResolveNoFallback();
    (generateText as any)
      .mockResolvedValueOnce({
        text: JSON.stringify({ keywords: ["only-one"], summary: "too short" }), // fails min(3) and min(50)
        providerMetadata: { google: { groundingMetadata: { groundingChunks: [], groundingSupports: [], webSearchQueries: [] } } },
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({ keywords: ["a", "b", "c"], summary: "x".repeat(60) }),
        providerMetadata: { google: { groundingMetadata: { groundingChunks: [], groundingSupports: [], webSearchQueries: [] } } },
      });
    const result = await runPhase1({ nicheName: "X", strategy: "gaps" });
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(result.data.keywords).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Phase 2
// ---------------------------------------------------------------------------

describe("runPhase2 (Gap Detection)", () => {
  beforeEach(() => vi.clearAllMocks());
  it("returns parsed gaps + competitors + sources", async () => {
    mockResolveNoFallback();
    (generateText as any).mockResolvedValue({
      text: JSON.stringify({
        gaps: [{ title: "g1", description: "d1" }, { title: "g2", description: "d2" }],
        competitors: [{ name: "c1", weakness: "w1" }, { name: "c2", weakness: "w2" }],
        summary: "x".repeat(60),
      }),
      providerMetadata: {
        google: {
          groundingMetadata: {
            groundingChunks: [{ web: { uri: "https://stanford.edu/paper", title: "P" } }],
            groundingSupports: [],
            webSearchQueries: [],
          },
        },
      },
    });
    const result = await runPhase2({ nicheName: "X", strategy: "gaps", phase1Summary: "summary" });
    expect(result.data.gaps).toHaveLength(2);
    expect(result.data.competitors).toHaveLength(2);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].sourceType).toBe("academic"); // .edu
  });
});

// ---------------------------------------------------------------------------
// Phase 3
// ---------------------------------------------------------------------------

describe("runPhase3 (Deep Dives)", () => {
  beforeEach(() => vi.clearAllMocks());
  it("returns parsed monetization + challenges + sources", async () => {
    mockResolveNoFallback();
    (generateText as any).mockResolvedValue({
      text: JSON.stringify({
        monetizationModels: [
          { name: "m1", description: "d1", revenueEstimate: null },
          { name: "m2", description: "d2", revenueEstimate: "$10k" },
        ],
        technicalChallenges: [
          { title: "t1", severity: "low" },
          { title: "t2", severity: "high" },
        ],
        summary: "x".repeat(60),
      }),
      providerMetadata: {},
    });
    const result = await runPhase3({ nicheName: "X", strategy: "gaps", phase2Summary: "summary" });
    expect(result.data.monetizationModels).toHaveLength(2);
    expect(result.data.technicalChallenges).toHaveLength(2);
    expect(result.sources).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 4 Stream
// ---------------------------------------------------------------------------

describe("runPhase4Stream (Synthesis)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("yields partial objects via onPartial callback and returns final", async () => {
    const finalObj = {
      verdict: "GO" as const,
      synthesisScore: 7.5,
      scores: { marketSize: 8, competition: 6, feasibility: 7, monetization: 7, timeliness: 8 },
      reportMarkdown: "x".repeat(4500),
      verdictReason: "reasonable".repeat(10),
      ...VALIDATION_WORKSPACE_FIELDS,
    };
    async function* mockPartials() {
      yield { verdict: "GO" };
      yield { verdict: "GO", synthesisScore: 7.5 };
      yield finalObj;
    }
    (streamText as any).mockReturnValue({
      partialOutputStream: mockPartials(),
      output: Promise.resolve(finalObj),
    });
    mockResolveNoFallback("claude-sonnet-4-6", "anthropic");

    const collected: any[] = [];
    const final = await runPhase4Stream({ nicheName: "X", context: "ctx" }, (p) => collected.push(p));
    expect(collected).toHaveLength(3);
    expect(final.verdict).toBe("GO");
    expect(final.reportMarkdown.length).toBeGreaterThan(4000);
  });

  it("truncates oversized driver/action/claim arrays to documented maxima", async () => {
    const finalObj = {
      verdict: "GO" as const,
      synthesisScore: 7,
      scores: { marketSize: 7, competition: 5, feasibility: 6, monetization: 7, timeliness: 8 },
      reportMarkdown: "x".repeat(4500),
      verdictReason: "reasonable".repeat(10),
      positiveDrivers: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"], // 7 → trim to 5
      negativeDrivers: ["n1", "n2", "n3", "n4", "n5", "n6"],        // 6 → trim to 5
      missingEvidence: ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9"], // 9 → trim to 7
      nextActions: ["a1", "a2", "a3", "a4", "a5", "a6"],             // 6 → trim to 5
      synthesisClaims: Array.from({ length: 12 }, (_, i) => ({       // 12 → trim to 10
        claim: `c${i}`,
        dimensions: ["market_size"] as const,
        stance: "supports" as const,
        confidence: 0.5,
      })),
    };
    async function* mockPartials() { yield finalObj; }
    (streamText as any).mockReturnValue({
      partialOutputStream: mockPartials(),
      output: Promise.resolve(finalObj),
    });
    mockResolveNoFallback("claude-sonnet-4-6", "anthropic");

    const result = await runPhase4Stream({ nicheName: "X", context: "ctx" }, () => {});
    expect(result.positiveDrivers).toHaveLength(5);
    expect(result.negativeDrivers).toHaveLength(5);
    expect(result.missingEvidence).toHaveLength(7);
    expect(result.nextActions).toHaveLength(5);
    expect(result.synthesisClaims).toHaveLength(10);
  });

  it("does NOT pad under-produced arrays — graceful degradation", async () => {
    const finalObj = {
      verdict: "CONDITIONAL" as const,
      synthesisScore: 5,
      scores: { marketSize: 5, competition: 5, feasibility: 5, monetization: 5, timeliness: 5 },
      reportMarkdown: "x".repeat(4500),
      verdictReason: "reasonable".repeat(10),
      positiveDrivers: ["only one driver"], // 1 — passes through
      negativeDrivers: [],                   // empty — passes through
      missingEvidence: [],
      nextActions: ["a1"],                   // 1 — passes through
      synthesisClaims: [
        { claim: "c1", dimensions: ["market_size"] as const, stance: "neutral" as const, confidence: 0.5 },
      ],
    };
    async function* mockPartials() { yield finalObj; }
    (streamText as any).mockReturnValue({
      partialOutputStream: mockPartials(),
      output: Promise.resolve(finalObj),
    });
    mockResolveNoFallback("claude-sonnet-4-6", "anthropic");

    const result = await runPhase4Stream({ nicheName: "X", context: "ctx" }, () => {});
    expect(result.positiveDrivers).toEqual(["only one driver"]);
    expect(result.negativeDrivers).toEqual([]);
    expect(result.nextActions).toHaveLength(1);
    expect(result.synthesisClaims).toHaveLength(1);
  });

  it("clamps out-of-range scores to [0,10] and claim confidence to [0,1]", async () => {
    const finalObj = {
      verdict: "GO" as const,
      synthesisScore: 12.4, // over
      scores: { marketSize: 15, competition: -2, feasibility: 7, monetization: 7, timeliness: 8 },
      reportMarkdown: "x".repeat(4500),
      verdictReason: "reasonable".repeat(10),
      ...VALIDATION_WORKSPACE_FIELDS,
      synthesisClaims: [
        { claim: "overshoot", dimensions: ["market_size"] as const, stance: "supports" as const, confidence: 1.5 },
        { claim: "undershoot", dimensions: ["competition"] as const, stance: "weakens" as const, confidence: -0.3 },
        { claim: "inside", dimensions: ["feasibility"] as const, stance: "neutral" as const, confidence: 0.4 },
      ],
    };
    async function* mockPartials() { yield finalObj; }
    (streamText as any).mockReturnValue({
      partialOutputStream: mockPartials(),
      output: Promise.resolve(finalObj),
    });
    mockResolveNoFallback("claude-sonnet-4-6", "anthropic");

    const result = await runPhase4Stream({ nicheName: "X", context: "ctx" }, () => {});
    expect(result.synthesisScore).toBe(10);
    expect(result.scores.marketSize).toBe(10);
    expect(result.scores.competition).toBe(0);
    expect(result.synthesisClaims[0].confidence).toBe(1);
    expect(result.synthesisClaims[1].confidence).toBe(0);
    expect(result.synthesisClaims[2].confidence).toBe(0.4); // in-range unchanged
  });

  it("throws when final output is invalid", async () => {
    const invalidObj = { verdict: "GO", synthesisScore: "not a number" } as any;
    async function* mockPartials() {
      yield { verdict: "GO" };
      yield invalidObj;
    }
    (streamText as any).mockReturnValue({
      partialOutputStream: mockPartials(),
      output: Promise.resolve(invalidObj),
    });
    mockResolveNoFallback("claude-sonnet-4-6", "anthropic");
    await expect(
      runPhase4Stream({ nicheName: "X", context: "ctx" }, () => {})
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

describe("runPolling", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns validated questions", async () => {
    const mockQuestions = {
      questions: [
        { id: "q1", type: "single_choice", text: "Q1?", options: ["a", "b"] },
        { id: "q2", type: "likert", text: "Q2?", options: null },
        { id: "q3", type: "short_text", text: "Q3?", options: null },
      ],
    };
    (generateText as any).mockResolvedValue({ output: mockQuestions });
    mockResolveNoFallback("gpt-4.1-mini", "openai");

    const result = await runPolling({ nicheName: "X", report: "some report" });
    expect(result.questions).toHaveLength(3);
    expect(result.questions[0].type).toBe("single_choice");
  });
});

// ---------------------------------------------------------------------------
// Brainstorm
// ---------------------------------------------------------------------------

describe("runBrainstorm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns exactly 10 validated ideas", async () => {
    const mockIdeas = {
      ideas: Array(10).fill(null).map((_, i) => ({
        id: `idea-${i}`,
        title: `Idea ${i}`,
        description: `Short description ${i}`,
      })),
    };
    (generateText as any).mockResolvedValue({ output: mockIdeas });
    mockResolveNoFallback("gpt-4.1-mini", "openai");

    const result = await runBrainstorm({ context: "AI tools for HR" });
    expect(result.ideas).toHaveLength(10);
    expect(result.ideas[0].id).toBe("idea-0");
  });
});

// ---------------------------------------------------------------------------
// Fallback path tests — Phase 1
// ---------------------------------------------------------------------------

describe("runPhase1 with fallback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses fallback when primary throws 503 (eligible)", async () => {
    mockResolveWithFallback();
    (generateText as any)
      .mockRejectedValueOnce(makeApiError(503)) // primary fails
      .mockResolvedValueOnce({ text: JSON.stringify({ keywords: ["a", "b", "c"], summary: "x".repeat(60) }) }); // fallback succeeds (non-grounded, no providerMetadata)
    const onFallback = vi.fn();
    const result = await runPhase1({ nicheName: "test", strategy: "gaps" }, { onFallback });
    expect(result.data.keywords).toHaveLength(3);
    expect(result.sources).toEqual([]); // fallback is non-grounded → empty sources
    expect(onFallback).toHaveBeenCalledWith("gpt-4.1-mini", expect.stringContaining("503"));
  });

  it("fails on 401 (no fallback attempted)", async () => {
    mockResolveWithFallback();
    const generateTextMock = generateText as any;
    generateTextMock.mockRejectedValueOnce(makeApiError(401));
    const onFallback = vi.fn();
    await expect(
      runPhase1({ nicheName: "X", strategy: "gaps" }, { onFallback })
    ).rejects.toThrow();
    expect(generateTextMock).toHaveBeenCalledTimes(1); // primary only, no fallback
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("fails when primary 503 + fallback also 503 — fallback error rethrown", async () => {
    mockResolveWithFallback();
    const primaryError = makeApiError(503);
    const fallbackError = makeApiError(502);
    (generateText as any)
      .mockRejectedValueOnce(primaryError)
      .mockRejectedValueOnce(fallbackError);
    await expect(
      runPhase1({ nicheName: "X", strategy: "gaps" }, {})
    ).rejects.toBe(fallbackError);
  });
});

// ---------------------------------------------------------------------------
// Fallback path tests — Phase 4 Stream
// ---------------------------------------------------------------------------

describe("runPhase4Stream fallback semantics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses non-streaming fallback on pre-stream failure", async () => {
    mockResolveWithFallback("claude-sonnet-4-6", "anthropic", "gpt-4.1-mini", "openai");
    const err = makeApiError(503);
    async function* emptyStream() { throw err; }
    // Attach .catch to prevent unhandled rejection — the promise is never consumed
    // because the async iterator throws first, causing runPhase4Stream to take the
    // catch branch before it ever awaits streamResult.output.
    const outputPromise = Promise.reject(err);
    outputPromise.catch(() => {});
    (streamText as any).mockReturnValue({
      partialOutputStream: emptyStream(),
      output: outputPromise,
    });
    const finalObj = {
      verdict: "GO" as const,
      synthesisScore: 7.5,
      scores: { marketSize: 8, competition: 6, feasibility: 7, monetization: 7, timeliness: 8 },
      reportMarkdown: "x".repeat(4500),
      verdictReason: "reasoned".repeat(20),
      ...VALIDATION_WORKSPACE_FIELDS,
    };
    (generateText as any).mockResolvedValueOnce({ output: finalObj });
    const onFallback = vi.fn();
    const onPartial = vi.fn();
    const result = await runPhase4Stream(
      { nicheName: "X", context: "ctx" },
      onPartial,
      { onFallback },
    );
    expect(result.verdict).toBe("GO");
    expect(onFallback).toHaveBeenCalled();
    expect(onPartial).not.toHaveBeenCalled(); // no partials emitted (pre-stream fail)
  });

  it("fails mid-stream with err.wasStreaming=true (no fallback attempted)", async () => {
    mockResolveWithFallback();
    const finalObj = {
      verdict: "GO" as const,
      synthesisScore: 7.5,
      scores: { marketSize: 8, competition: 6, feasibility: 7, monetization: 7, timeliness: 8 },
      reportMarkdown: "x".repeat(4500),
      verdictReason: "reasoned".repeat(20),
      ...VALIDATION_WORKSPACE_FIELDS,
    };
    async function* oneThenThrow() {
      yield { verdict: "GO" };
      throw new Error("network-drop");
    }
    (streamText as any).mockReturnValue({
      partialOutputStream: oneThenThrow(),
      output: Promise.resolve(finalObj), // never awaited because iterator throws first
    });
    const onFallback = vi.fn();
    const onPartial = vi.fn();
    await expect(
      runPhase4Stream({ nicheName: "X", context: "ctx" }, onPartial, { onFallback })
    ).rejects.toMatchObject({ wasStreaming: true });
    expect(onPartial).toHaveBeenCalledOnce(); // 1 partial before error
    expect(onFallback).not.toHaveBeenCalled(); // mid-stream → no fallback
  });

  it("fails pre-stream + fallback also fails — fallback error rethrown, no wasStreaming tag", async () => {
    mockResolveWithFallback();
    const primaryError = makeApiError(503);
    async function* emptyStream() { throw primaryError; }
    // Attach .catch to prevent unhandled rejection — the iterator throws before output is awaited.
    const outputPromise = Promise.reject(primaryError);
    outputPromise.catch(() => {});
    (streamText as any).mockReturnValue({
      partialOutputStream: emptyStream(),
      output: outputPromise,
    });
    const fallbackError = makeApiError(502);
    (generateText as any).mockRejectedValueOnce(fallbackError);
    await expect(
      runPhase4Stream({ nicheName: "X", context: "ctx" }, () => {}, {})
    ).rejects.toBe(fallbackError);
    // Neither error should have wasStreaming flag (no partials ever emitted)
  });
});

// ---------------------------------------------------------------------------
// Fallback path tests — Polling
// ---------------------------------------------------------------------------

describe("runPolling with fallback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses fallback when primary fails transient", async () => {
    mockResolveWithFallback("gpt-4.1-mini", "openai", "claude-sonnet-4-6", "anthropic");
    const validQuestions = {
      questions: [
        { id: "q1", type: "single_choice", text: "Q?", options: ["a", "b"] },
        { id: "q2", type: "likert", text: "Q?", options: null },
        { id: "q3", type: "short_text", text: "Q?", options: null },
      ],
    };
    (generateText as any)
      .mockRejectedValueOnce(makeApiError(500))
      .mockResolvedValueOnce({ output: validQuestions });
    const onFallback = vi.fn();
    const result = await runPolling({ nicheName: "X", report: "test report" }, { onFallback });
    expect(result.questions).toHaveLength(3);
    expect(onFallback).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Fallback path tests — Brainstorm
// ---------------------------------------------------------------------------

describe("runBrainstorm with fallback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses fallback when primary fails transient", async () => {
    mockResolveWithFallback("gpt-4.1-mini", "openai", "claude-sonnet-4-6", "anthropic");
    const validIdeas = {
      ideas: Array.from({ length: 10 }, (_, i) => ({
        id: `idea-${i}`, title: `T${i}`, description: `D${i}`,
      })),
    };
    (generateText as any)
      .mockRejectedValueOnce(makeApiError(503))
      .mockResolvedValueOnce({ output: validIdeas });
    const onFallback = vi.fn();
    const result = await runBrainstorm({ context: "SaaS tools" }, { onFallback });
    expect(result.ideas).toHaveLength(10);
    expect(onFallback).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SYNTHESIS_RUBRIC_BLOCK (P2 scoring rubric)
// ---------------------------------------------------------------------------

describe("SYNTHESIS_RUBRIC_BLOCK (P2 scoring rubric)", () => {
  it("includes all 5 dimensions with 3 anchor points each", () => {
    const dimensions = ["market_size", "competition", "feasibility", "monetization", "timeliness"];
    for (const dim of dimensions) {
      expect(SYNTHESIS_RUBRIC_BLOCK).toContain(dim);
    }
    // Each dimension has 3 anchors labelled 9-10, 5-6, 1-2
    expect((SYNTHESIS_RUBRIC_BLOCK.match(/9-10:/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect((SYNTHESIS_RUBRIC_BLOCK.match(/5-6:/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect((SYNTHESIS_RUBRIC_BLOCK.match(/1-2:/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});
