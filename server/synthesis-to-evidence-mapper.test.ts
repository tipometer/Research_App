import { describe, it, expect, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  dedupeSourcesByUrl,
  mapWebSourceEvidence,
  mapSynthesisClaimEvidence,
  buildDecisionSnapshot,
  persistEvidenceAndSnapshot,
  type MapperSource,
} from "./synthesis-to-evidence-mapper";
import type { SynthesisOutput } from "./ai/schemas";

// ─── Fixture helpers ────────────────────────────────────────────────────────

const FIXTURES_DIR = resolve(__dirname, "ai/__fixtures__");

function loadFixture(slug: string): { synthesis: SynthesisOutput } | null {
  const path = resolve(FIXTURES_DIR, `synthesis-output-${slug}.json`);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return { synthesis: raw.synthesis };
}

/** Inline synthetic fixture for edge cases — not dependent on live API runs. */
function syntheticSynthesis(overrides: Partial<SynthesisOutput> = {}): SynthesisOutput {
  return {
    verdict: "CONDITIONAL",
    synthesisScore: 6.5,
    scores: {
      marketSize: 7.0, competition: 5.5, feasibility: 6.0, monetization: 7.5, timeliness: 6.0,
    },
    reportMarkdown: "x".repeat(4500),
    verdictReason: "Synthetic reason for testing. ".repeat(5),
    positiveDrivers: ["Synthetic positive 1", "Synthetic positive 2"],
    negativeDrivers: ["Synthetic negative 1", "Synthetic negative 2"],
    missingEvidence: ["Synthetic missing evidence"],
    nextActions: ["Action 1", "Action 2", "Action 3"],
    synthesisClaims: [
      { claim: "Claim A", dimensions: ["market_size"], stance: "supports", confidence: 0.85 },
      { claim: "Claim B", dimensions: ["competition", "feasibility"], stance: "weakens", confidence: 0.7 },
      { claim: "Claim C", dimensions: ["monetization"], stance: "neutral", confidence: 0.6 },
    ],
    ...overrides,
  };
}

function syntheticSources(count: number, startIdx = 0): MapperSource[] {
  return Array.from({ length: count }, (_, i) => ({
    url: `https://example.com/source-${startIdx + i}`,
    title: `Source ${startIdx + i} title`,
    snippet: `Snippet text for source ${startIdx + i} — describes some finding.`,
    sourceType: (["academic", "industry", "news", "blog", "community"] as const)[(startIdx + i) % 5],
    publishedAt: null,
  }));
}

// ─── Pure helper tests ──────────────────────────────────────────────────────

describe("dedupeSourcesByUrl", () => {
  it("removes duplicate URLs, keeps first occurrence", () => {
    const sources: MapperSource[] = [
      { url: "https://a.com", title: "A1", snippet: "first", sourceType: "news", publishedAt: null },
      { url: "https://b.com", title: "B", snippet: "x", sourceType: "blog", publishedAt: null },
      { url: "https://a.com", title: "A2", snippet: "dup", sourceType: "news", publishedAt: null },
    ];
    const out = dedupeSourcesByUrl(sources);
    expect(out).toHaveLength(2);
    expect(out[0].title).toBe("A1"); // first wins
  });

  it("skips sources with empty url", () => {
    const sources: MapperSource[] = [
      { url: "", title: "empty", snippet: "", sourceType: "blog", publishedAt: null },
      { url: "https://valid.com", title: "ok", snippet: "ok", sourceType: "news", publishedAt: null },
    ];
    expect(dedupeSourcesByUrl(sources)).toHaveLength(1);
  });

  it("handles empty input", () => {
    expect(dedupeSourcesByUrl([])).toEqual([]);
  });
});

describe("mapWebSourceEvidence", () => {
  it("produces a valid InsertEvidence row with web_source type", () => {
    const source: MapperSource = {
      url: "https://example.com/report",
      title: "Q1 Market Report",
      snippet: "The market is growing 20% YoY.",
      sourceType: "industry",
      publishedAt: null,
    };
    const row = mapWebSourceEvidence(source, 42);
    expect(row.researchId).toBe(42);
    expect(row.type).toBe("web_source");
    expect(row.claim).toBe("The market is growing 20% YoY.");
    expect(row.sourceUrl).toBe("https://example.com/report");
    expect(row.sourceTitle).toBe("Q1 Market Report");
    expect(row.sourceQuality).toBe("high"); // industry → high
    expect(row.stance).toBe("neutral");
    expect(row.confidence).toBeNull();
    expect(row.dimensions).toEqual([]);
  });

  it("falls back to title when snippet is empty", () => {
    const source: MapperSource = {
      url: "https://example.com", title: "Title only source", snippet: "",
      sourceType: "blog", publishedAt: null,
    };
    expect(mapWebSourceEvidence(source, 1).claim).toBe("Title only source");
  });

  it("uses '(no claim)' when both snippet and title are empty", () => {
    const source: MapperSource = {
      url: "https://example.com", title: "", snippet: "",
      sourceType: "community", publishedAt: null,
    };
    expect(mapWebSourceEvidence(source, 1).claim).toBe("(no claim)");
  });

  it("truncates very long snippets to 1000 chars with ellipsis", () => {
    const source: MapperSource = {
      url: "https://example.com", title: "t", snippet: "x".repeat(1500),
      sourceType: "news", publishedAt: null,
    };
    const row = mapWebSourceEvidence(source, 1);
    expect(row.claim?.length).toBe(1000);
    expect(row.claim?.endsWith("...")).toBe(true);
  });

  it("maps sourceType to expected sourceQuality tier", () => {
    const makeSrc = (t: string): MapperSource => ({
      url: `https://${t}.com`, title: "t", snippet: "s", sourceType: t, publishedAt: null,
    });
    expect(mapWebSourceEvidence(makeSrc("academic"), 1).sourceQuality).toBe("high");
    expect(mapWebSourceEvidence(makeSrc("industry"), 1).sourceQuality).toBe("high");
    expect(mapWebSourceEvidence(makeSrc("news"), 1).sourceQuality).toBe("medium");
    expect(mapWebSourceEvidence(makeSrc("blog"), 1).sourceQuality).toBe("medium");
    expect(mapWebSourceEvidence(makeSrc("community"), 1).sourceQuality).toBe("low");
    expect(mapWebSourceEvidence(makeSrc("unknown"), 1).sourceQuality).toBeNull();
  });
});

describe("mapSynthesisClaimEvidence", () => {
  it("produces a valid synthesis_claim row with claim-provided metadata", () => {
    const row = mapSynthesisClaimEvidence(
      {
        claim: "Market grows 20% YoY.",
        dimensions: ["market_size", "timeliness"],
        stance: "supports",
        confidence: 0.85,
      },
      42,
    );
    expect(row.type).toBe("synthesis_claim");
    expect(row.researchId).toBe(42);
    expect(row.claim).toBe("Market grows 20% YoY.");
    expect(row.dimensions).toEqual(["market_size", "timeliness"]);
    expect(row.stance).toBe("supports");
    expect(row.confidence).toBe("0.85"); // drizzle decimal column expects string
    expect(row.sourceUrl).toBeNull();
    expect(row.sourceTitle).toBeNull();
  });
});

describe("buildDecisionSnapshot", () => {
  it("converts synthesis scores from camelCase to snake_case", () => {
    const synth = syntheticSynthesis();
    const snap = buildDecisionSnapshot({
      researchId: 42, synthesis: synth, evidenceCount: 7, sourceSynthesisId: 99,
    });
    expect((snap.scores as Record<string, number>).market_size).toBe(synth.scores.marketSize);
    expect((snap.scores as Record<string, number>).competition).toBe(synth.scores.competition);
    expect((snap.scores as Record<string, number>).timeliness).toBe(synth.scores.timeliness);
  });

  it("wraps verdictReason into a single-element rationale array", () => {
    const synth = syntheticSynthesis({ verdictReason: "Because reasons." });
    const snap = buildDecisionSnapshot({ researchId: 1, synthesis: synth, evidenceCount: 0 });
    expect(snap.rationale).toEqual(["Because reasons."]);
  });

  it("defaults evidenceVersion to 1 and sourceSynthesisId to null when omitted", () => {
    const snap = buildDecisionSnapshot({
      researchId: 1, synthesis: syntheticSynthesis(), evidenceCount: 3,
    });
    expect(snap.evidenceVersion).toBe(1);
    expect(snap.sourceSynthesisId).toBeNull();
  });

  it("forwards evidenceCount as passed", () => {
    const snap = buildDecisionSnapshot({
      researchId: 1, synthesis: syntheticSynthesis(), evidenceCount: 42,
    });
    expect(snap.evidenceCount).toBe(42);
  });
});

// ─── persistEvidenceAndSnapshot (mocked DB) ─────────────────────────────────

/**
 * Minimal mock of `MySql2Database.insert()` that captures calls and returns
 * a mysql2-like ResultSetHeader with `insertId`. Returns a tuple [header, ...]
 * as mysql2 does.
 */
function makeMockDb(insertId = 1000) {
  const insertCalls: Array<{ table: unknown; values: unknown }> = [];
  const insert = vi.fn((table: unknown) => ({
    values: vi.fn(async (values: unknown) => {
      insertCalls.push({ table, values });
      return [{ insertId, affectedRows: Array.isArray(values) ? values.length : 1 }];
    }),
  }));
  return { db: { insert } as unknown, calls: insertCalls };
}

describe("persistEvidenceAndSnapshot — happy path with real CP2 fixtures", () => {
  it("persists expected evidence counts + snapshot for Beer and Dumbbell fixture", async () => {
    const fixture = loadFixture("beer-dumbbell-coach");
    if (!fixture) return; // fixture unavailable in this checkout — skip silently

    const sources = syntheticSources(10); // simulate pipeline phase aggregation
    const { db, calls } = makeMockDb(5555);

    const result = await persistEvidenceAndSnapshot(db as never, {
      researchId: 42,
      synthesis: fixture.synthesis,
      sources,
      sourceSynthesisId: 7,
    });

    expect(result.webSourceEvidenceCount).toBe(10);
    expect(result.synthesisClaimEvidenceCount).toBe(fixture.synthesis.synthesisClaims.length);
    expect(result.evidenceInserted).toBe(10 + fixture.synthesis.synthesisClaims.length);
    expect(result.snapshotId).toBe(5555);
    expect(calls).toHaveLength(2); // one evidence-batch insert, one snapshot insert
  });

  it("persists expected evidence counts + snapshot for B2B Contract Reviewer fixture", async () => {
    const fixture = loadFixture("b2b-contract-reviewer-hu");
    if (!fixture) return;

    const { db, calls } = makeMockDb(5556);
    const result = await persistEvidenceAndSnapshot(db as never, {
      researchId: 99,
      synthesis: fixture.synthesis,
      sources: syntheticSources(8),
    });

    expect(result.webSourceEvidenceCount).toBe(8);
    expect(result.synthesisClaimEvidenceCount).toBe(fixture.synthesis.synthesisClaims.length);
    expect(calls[1].values).toMatchObject({
      researchId: 99,
      verdict: fixture.synthesis.verdict,
      evidenceCount: 8 + fixture.synthesis.synthesisClaims.length,
    });
  });
});

describe("persistEvidenceAndSnapshot — edge cases", () => {
  it("empty sources → still persists synthesis_claim evidence and snapshot", async () => {
    const { db, calls } = makeMockDb(1);
    const result = await persistEvidenceAndSnapshot(db as never, {
      researchId: 1, synthesis: syntheticSynthesis(), sources: [],
    });
    expect(result.webSourceEvidenceCount).toBe(0);
    expect(result.synthesisClaimEvidenceCount).toBe(3);
    expect(result.evidenceInserted).toBe(3);
    expect(calls).toHaveLength(2);
  });

  it("empty sources AND empty synthesisClaims → skips evidence insert, still writes snapshot", async () => {
    const { db, calls } = makeMockDb(2);
    const synth = syntheticSynthesis({ synthesisClaims: [] });
    const result = await persistEvidenceAndSnapshot(db as never, {
      researchId: 1, synthesis: synth, sources: [],
    });
    expect(result.evidenceInserted).toBe(0);
    // only the snapshot insert happens when no evidence rows to batch
    expect(calls).toHaveLength(1);
  });

  it("duplicate source URLs across phases produce a single evidence row each", async () => {
    const dup: MapperSource[] = [
      { url: "https://x.com", title: "t1", snippet: "s1", sourceType: "news", publishedAt: null },
      { url: "https://x.com", title: "t2", snippet: "s2", sourceType: "news", publishedAt: null },
      { url: "https://x.com", title: "t3", snippet: "s3", sourceType: "news", publishedAt: null },
    ];
    const { db } = makeMockDb();
    const result = await persistEvidenceAndSnapshot(db as never, {
      researchId: 1, synthesis: syntheticSynthesis(), sources: dup,
    });
    expect(result.webSourceEvidenceCount).toBe(1);
  });

  it("propagates DB errors — caller is responsible for graceful degradation", async () => {
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(async () => {
          throw new Error("simulated DB unavailable");
        }),
      })),
    };
    await expect(
      persistEvidenceAndSnapshot(db as never, {
        researchId: 1, synthesis: syntheticSynthesis(), sources: syntheticSources(3),
      }),
    ).rejects.toThrow("simulated DB unavailable");
  });

  it("snapshot carries all Validation-Workspace fields from synthesis", async () => {
    const synth = syntheticSynthesis({
      positiveDrivers: ["p1", "p2"],
      negativeDrivers: ["n1"],
      missingEvidence: ["m1", "m2", "m3"],
      nextActions: ["a1", "a2", "a3", "a4"],
    });
    const { db, calls } = makeMockDb(77);
    await persistEvidenceAndSnapshot(db as never, {
      researchId: 7, synthesis: synth, sources: [],
    });
    const snapshotInsert = calls.find((c) => (c.values as { verdict?: string }).verdict);
    expect(snapshotInsert?.values).toMatchObject({
      positiveDrivers: ["p1", "p2"],
      negativeDrivers: ["n1"],
      missingEvidence: ["m1", "m2", "m3"],
      nextActions: ["a1", "a2", "a3", "a4"],
    });
  });
});
