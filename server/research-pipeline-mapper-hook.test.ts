/**
 * Pipeline ↔ Mapper hook integration tests (Validation Workspace sprint V2 Day 6).
 *
 * Verifies the graceful-degradation contract scope §5.5 prescribes:
 *
 *   1. Happy path: mapper succeeds → research reaches status='done' with
 *      scores/reportMarkdown persisted AND mapper.success is logged.
 *
 *   2. Mapper throws: research STILL reaches status='done' — the classic
 *      report must ship even if the Validation Workspace persistence fails.
 *      `mapper.failed` is logged with the error.
 *
 *   3. No DB (getDb returns null): mapper is skipped entirely, no errors,
 *      research reaches status='done' via the existing code path.
 *
 * The test drives the `runResearchPipeline` export end-to-end with all
 * AI calls + DB modules mocked. A minimal Express Request/Response double
 * is synthesized locally.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

// ─── Module mocks ──────────────────────────────────────────────────────────
//
// Hoist these BEFORE importing runResearchPipeline so the imports inside that
// module resolve to the mocks.

vi.mock("./ai/pipeline-phases", () => ({
  runPhase1: vi.fn().mockResolvedValue({
    data: { keywords: ["k1", "k2", "k3"], summary: "Wide scan summary.".padEnd(60, ".") },
    sources: [
      { url: "https://s1.com", title: "S1", snippet: "snip1", sourceType: "blog", publishedAt: null },
    ],
  }),
  runPhase2: vi.fn().mockResolvedValue({
    data: {
      gaps: [{ title: "g1", description: "d1" }, { title: "g2", description: "d2" }],
      competitors: [{ name: "c1", weakness: "w1" }, { name: "c2", weakness: "w2" }],
      summary: "Gap detection summary.".padEnd(60, "."),
    },
    sources: [],
  }),
  runPhase3: vi.fn().mockResolvedValue({
    data: {
      monetizationModels: [
        { name: "SaaS", description: "d", revenueEstimate: null },
        { name: "Freemium", description: "d", revenueEstimate: null },
      ],
      technicalChallenges: [
        { title: "Scaling", severity: "medium" as const },
        { title: "Compliance", severity: "high" as const },
      ],
      summary: "Deep dives summary.".padEnd(60, "."),
    },
    sources: [],
  }),
  runPhase4Stream: vi.fn().mockImplementation(
    async (_input: unknown, onPartial: (p: unknown) => void) => {
      const final = {
        verdict: "GO" as const,
        synthesisScore: 7.5,
        scores: { marketSize: 8, competition: 6, feasibility: 7, monetization: 7, timeliness: 8 },
        reportMarkdown: "## Report\n\n".padEnd(4500, "x"),
        verdictReason: "Verdict reasoning sentence.".padEnd(60, "."),
        positiveDrivers: ["p1", "p2"],
        negativeDrivers: ["n1", "n2"],
        missingEvidence: ["m1"],
        nextActions: ["a1", "a2", "a3"],
        synthesisClaims: [
          { claim: "c1", dimensions: ["market_size"] as const, stance: "supports" as const, confidence: 0.8 },
          { claim: "c2", dimensions: ["competition"] as const, stance: "weakens" as const, confidence: 0.7 },
          { claim: "c3", dimensions: ["feasibility"] as const, stance: "supports" as const, confidence: 0.9 },
        ],
      };
      onPartial({ verdict: "GO" });
      return final;
    },
  ),
}));

const mockUpdateResearch = vi.fn().mockResolvedValue(undefined);
const mockLogAudit = vi.fn().mockResolvedValue(undefined);
const mockAddCredit = vi.fn().mockResolvedValue(undefined);
const mockGetDb = vi.fn();

function wasAuditLogged(action: string): ReturnType<typeof mockLogAudit.mock.calls.find> {
  return mockLogAudit.mock.calls.find((c) => c[1] === action);
}

vi.mock("./db", () => ({
  getResearchById: vi.fn().mockResolvedValue({
    id: 42,
    userId: 7,
    nicheName: "Test niche",
    description: "test desc",
    strategy: "gaps",
    status: "pending",
    creditsUsed: 1,
  }),
  updateResearch: (...args: unknown[]) => mockUpdateResearch(...args),
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
  addCredit: (...args: unknown[]) => mockAddCredit(...args),
  getDb: () => mockGetDb(),
}));

const mockPersistEvidenceAndSnapshot = vi.fn();
vi.mock("./synthesis-to-evidence-mapper", () => ({
  persistEvidenceAndSnapshot: (...args: unknown[]) => mockPersistEvidenceAndSnapshot(...args),
}));

const loggerInfo = vi.fn();
const loggerError = vi.fn();
vi.mock("./_core/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: (...args: unknown[]) => loggerInfo(...args),
    warn: vi.fn(),
    error: (...args: unknown[]) => loggerError(...args),
  },
}));

// ─── Import AFTER mocks are registered ─────────────────────────────────────
import { runResearchPipeline } from "./research-pipeline";

// ─── Test harness ──────────────────────────────────────────────────────────

function makeReqRes(): { req: Request; res: Response; writes: string[] } {
  const writes: string[] = [];
  const req = {
    params: { id: "42" },
    user: { id: 7 },
  } as unknown as Request;
  const res = {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => { writes.push(chunk); return true; }),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    end: vi.fn(),
  } as unknown as Response;
  return { req, res, writes };
}

function makeMockDb() {
  // Matches the shape research-pipeline expects:
  //   db.insert(table).values({...})  — returns array-wrapped header for mysql2
  return {
    insert: vi.fn(() => ({
      values: vi.fn().mockResolvedValue([{ insertId: 1, affectedRows: 1 }]),
    })),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("runResearchPipeline — mapper hook integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: mapper succeeds → research reaches status='done' AND mapper.success logged", async () => {
    mockGetDb.mockResolvedValue(makeMockDb());
    mockPersistEvidenceAndSnapshot.mockResolvedValue({
      evidenceInserted: 4,
      snapshotId: 100,
      webSourceEvidenceCount: 1,
      synthesisClaimEvidenceCount: 3,
    });

    const { req, res } = makeReqRes();
    await runResearchPipeline(req, res);

    // research reached status='done'
    const doneCall = mockUpdateResearch.mock.calls.find(
      (c) => (c[1] as { status?: string }).status === "done",
    );
    expect(doneCall).toBeDefined();
    expect(doneCall?.[1]).toMatchObject({ verdict: "GO", status: "done" });

    // mapper was invoked with expected shape
    expect(mockPersistEvidenceAndSnapshot).toHaveBeenCalledTimes(1);
    const mapperInput = mockPersistEvidenceAndSnapshot.mock.calls[0][1];
    expect(mapperInput).toMatchObject({
      researchId: 42,
      sources: expect.any(Array),
      sourceSynthesisId: null,
    });

    // structured log emitted
    const successLog = loggerInfo.mock.calls.find(
      (c) => (c[0] as { event?: string }).event === "mapper.success",
    );
    expect(successLog).toBeDefined();
    expect(successLog?.[0]).toMatchObject({
      event: "mapper.success",
      researchId: 42,
      evidenceCount: 4,
      snapshotId: 100,
    });
    expect((successLog?.[0] as { mapperDuration_ms?: number }).mapperDuration_ms).toBeTypeOf("number");

    // NO mapper.failed log in happy path
    expect(loggerError.mock.calls.find((c) => (c[0] as { event?: string }).event === "mapper.failed")).toBeUndefined();

    // Audit log `decision_snapshot.created` was emitted with the expected payload
    const snapshotAudit = wasAuditLogged("decision_snapshot.created");
    expect(snapshotAudit).toBeDefined();
    expect(snapshotAudit?.[2]).toMatchObject({
      researchId: 42,
      snapshotId: 100,
      evidenceCount: 4,
      verdict: "GO",
    });
  });

  it("mapper throws → research STILL reaches status='done' (graceful degradation)", async () => {
    mockGetDb.mockResolvedValue(makeMockDb());
    mockPersistEvidenceAndSnapshot.mockRejectedValue(new Error("simulated DB outage"));

    const { req, res } = makeReqRes();
    await runResearchPipeline(req, res);

    // research STILL reached status='done' despite mapper failure
    const doneCall = mockUpdateResearch.mock.calls.find(
      (c) => (c[1] as { status?: string }).status === "done",
    );
    expect(doneCall).toBeDefined();

    // mapper.failed logged with error message
    const failedLog = loggerError.mock.calls.find(
      (c) => (c[0] as { event?: string }).event === "mapper.failed",
    );
    expect(failedLog).toBeDefined();
    expect(failedLog?.[0]).toMatchObject({
      event: "mapper.failed",
      researchId: 42,
      error: "simulated DB outage",
      errorName: "Error",
    });
    expect((failedLog?.[0] as { mapperDuration_ms?: number }).mapperDuration_ms).toBeTypeOf("number");

    // pipeline did NOT enter the top-level catch (no status='failed' update)
    const failedStatusCall = mockUpdateResearch.mock.calls.find(
      (c) => (c[1] as { status?: string }).status === "failed",
    );
    expect(failedStatusCall).toBeUndefined();

    // NO decision_snapshot.created audit on mapper failure
    expect(wasAuditLogged("decision_snapshot.created")).toBeUndefined();
  });

  it("no DB (getDb returns null) → mapper is skipped, no errors, research still completes", async () => {
    mockGetDb.mockResolvedValue(null);

    const { req, res } = makeReqRes();
    await runResearchPipeline(req, res);

    // mapper NOT invoked (guarded by `if (db)`)
    expect(mockPersistEvidenceAndSnapshot).not.toHaveBeenCalled();

    // research still reached status='done'
    const doneCall = mockUpdateResearch.mock.calls.find(
      (c) => (c[1] as { status?: string }).status === "done",
    );
    expect(doneCall).toBeDefined();

    // neither mapper.success nor mapper.failed logged
    expect(loggerInfo.mock.calls.find((c) => (c[0] as { event?: string }).event === "mapper.success")).toBeUndefined();
    expect(loggerError.mock.calls.find((c) => (c[0] as { event?: string }).event === "mapper.failed")).toBeUndefined();
  });
});
