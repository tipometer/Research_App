import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./router", () => ({
  resolvePhase: vi.fn(),
}));

vi.mock("ai", async (orig) => {
  const actual = await orig<typeof import("ai")>();
  return { ...actual, generateText: vi.fn() };
});

import { runPhase1, runPhase2, runPhase3 } from "./pipeline-phases";
import { resolvePhase } from "./router";
import { generateText } from "ai";

function mockResolvePhase() {
  (resolvePhase as any).mockResolvedValue({
    model: "gemini-2.5-flash",
    provider: "gemini",
    client: (_name: string) => ({ /* stub model object */ }),
  });
}

describe("runPhase1 (Wide Scan)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns parsed output + extracted sources from groundingMetadata", async () => {
    mockResolvePhase();
    (generateText as any).mockResolvedValue({
      experimental_output: { keywords: ["a", "b", "c"], summary: "x".repeat(60) },
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
    mockResolvePhase();
    (generateText as any).mockResolvedValue({
      experimental_output: { keywords: ["a", "b", "c"], summary: "x".repeat(60) },
      providerMetadata: {},
    });
    const result = await runPhase1({ nicheName: "X", strategy: "gaps" });
    expect(result.sources).toEqual([]);
  });

  it("retries once on Zod validation error", async () => {
    mockResolvePhase();
    (generateText as any)
      .mockResolvedValueOnce({
        experimental_output: { keywords: ["only-one"], summary: "too short" }, // fails min(3) and min(50)
        providerMetadata: { google: { groundingMetadata: { groundingChunks: [], groundingSupports: [], webSearchQueries: [] } } },
      })
      .mockResolvedValueOnce({
        experimental_output: { keywords: ["a", "b", "c"], summary: "x".repeat(60) },
        providerMetadata: { google: { groundingMetadata: { groundingChunks: [], groundingSupports: [], webSearchQueries: [] } } },
      });
    const result = await runPhase1({ nicheName: "X", strategy: "gaps" });
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(result.data.keywords).toHaveLength(3);
  });
});

describe("runPhase2 (Gap Detection)", () => {
  beforeEach(() => vi.clearAllMocks());
  it("returns parsed gaps + competitors + sources", async () => {
    mockResolvePhase();
    (generateText as any).mockResolvedValue({
      experimental_output: {
        gaps: [{ title: "g1", description: "d1" }, { title: "g2", description: "d2" }],
        competitors: [{ name: "c1", weakness: "w1" }, { name: "c2", weakness: "w2" }],
        summary: "x".repeat(60),
      },
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

describe("runPhase3 (Deep Dives)", () => {
  beforeEach(() => vi.clearAllMocks());
  it("returns parsed monetization + challenges + sources", async () => {
    mockResolvePhase();
    (generateText as any).mockResolvedValue({
      experimental_output: {
        monetizationModels: [
          { name: "m1", description: "d1" },
          { name: "m2", description: "d2", revenueEstimate: "$10k" },
        ],
        technicalChallenges: [
          { title: "t1", severity: "low" },
          { title: "t2", severity: "high" },
        ],
        summary: "x".repeat(60),
      },
      providerMetadata: {},
    });
    const result = await runPhase3({ nicheName: "X", strategy: "gaps", phase2Summary: "summary" });
    expect(result.data.monetizationModels).toHaveLength(2);
    expect(result.data.technicalChallenges).toHaveLength(2);
    expect(result.sources).toEqual([]);
  });
});
