/**
 * validation.router.ts integration tests — Day 7 (scope §5.4).
 *
 * Covers each of the three endpoints:
 *   - getSnapshot
 *   - listEvidence
 *   - getEvidenceByDimension
 *
 * Per scope: ≥1 happy path + ≥1 IDOR-fail test per endpoint.
 *
 * The test mocks `./db` — `getResearchById` controls ownership (drives IDOR),
 * `getDb` returns a chainable thenable that resolves to canned rows, so
 * Drizzle-shaped queries like `db.select().from(t).where(c).orderBy(c).limit(n)`
 * resolve without touching a real database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";
import type { User } from "../drizzle/schema";

// ─── Module mocks ──────────────────────────────────────────────────────────

const mockGetDb = vi.fn();
const mockGetResearchById = vi.fn();

vi.mock("./db", () => ({
  getDb: () => mockGetDb(),
  getResearchById: (id: number) => mockGetResearchById(id),
  // Minimum set so `routers.ts` module-level imports don't break:
  getResearches: vi.fn(),
  createResearch: vi.fn(),
  updateResearch: vi.fn(),
  getResearchSources: vi.fn(),
  getUserCredits: vi.fn(),
  deductCredit: vi.fn(),
  addCredit: vi.fn(),
  getCreditTransactions: vi.fn(),
  getBrainstormSessions: vi.fn(),
  createBrainstormSession: vi.fn(),
  getUsers: vi.fn(),
  getAuditLogs: vi.fn(),
  logAudit: vi.fn(),
  getSurveyByToken: vi.fn(),
  createSurveyResponse: vi.fn(),
  getSurveyByResearchId: vi.fn(),
  createSurvey: vi.fn(),
  getResearchByShareToken: vi.fn(),
}));

// Heavy modules that routers.ts imports but we don't exercise here.
vi.mock("./ai/pipeline-phases", () => ({
  runBrainstorm: vi.fn(),
  runPolling: vi.fn(),
  runPhase1: vi.fn(),
  runPhase2: vi.fn(),
  runPhase3: vi.fn(),
  runPhase4Stream: vi.fn(),
}));
vi.mock("./ai/providers", () => ({ getProvider: vi.fn() }));
vi.mock("./ai/router", () => ({ decryptIfNeeded: (s: string) => s }));
vi.mock("./ai/crypto", () => ({
  encrypt: vi.fn(),
  getMasterKey: vi.fn(),
  DecryptionError: class DecryptionError extends Error {},
}));

import { appRouter } from "./routers";

// ─── Test helpers ──────────────────────────────────────────────────────────

/**
 * A chainable thenable that mimics Drizzle's query builder shape: every call
 * (select / from / where / orderBy / limit) returns the same object; `await`
 * resolves to the rows provided. The table passed to `.from()` is captured so
 * tests that exercise multiple tables can assert dispatch.
 */
function makeChainable(rows: unknown[]) {
  const fromCalls: unknown[] = [];
  const chain = {
    select: vi.fn(() => chain),
    from: vi.fn((table: unknown) => { fromCalls.push(table); return chain; }),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    then: (resolve: (r: unknown[]) => unknown) => resolve(rows),
  };
  return { chain, fromCalls };
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 7,
    openId: "u7",
    email: "u7@example.com",
    name: "User Seven",
    loginMethod: "google",
    role: "user",
    credits: 10,
    language: "hu",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
}

function makeCtx(user: User | null): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("validation.getSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the snapshot row for the owner (happy path)", async () => {
    mockGetResearchById.mockResolvedValue({ id: 42, userId: 7, status: "done" });
    const snapshotRow = {
      id: 100,
      researchId: 42,
      verdict: "GO",
      evidenceVersion: 1,
      evidenceCount: 9,
      createdAt: new Date(),
    };
    const { chain } = makeChainable([snapshotRow]);
    mockGetDb.mockResolvedValue({ select: chain.select });

    const caller = appRouter.createCaller(makeCtx(makeUser()));
    const result = await caller.validation.getSnapshot({ researchId: 42 });

    expect(result).toMatchObject({ id: 100, researchId: 42, verdict: "GO" });
    expect(chain.limit).toHaveBeenCalledWith(1);
  });

  it("throws FORBIDDEN when research belongs to another user (IDOR guard)", async () => {
    // Research owned by user 9, caller is user 7
    mockGetResearchById.mockResolvedValue({ id: 42, userId: 9, status: "done" });

    const caller = appRouter.createCaller(makeCtx(makeUser({ id: 7 })));
    await expect(caller.validation.getSnapshot({ researchId: 42 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // Must NOT have hit the DB beyond the ownership lookup
    expect(mockGetDb).not.toHaveBeenCalled();
  });

  it("admin can read any user's snapshot (role escape for support workflows)", async () => {
    mockGetResearchById.mockResolvedValue({ id: 42, userId: 9, status: "done" });
    const { chain } = makeChainable([{ id: 100, researchId: 42, verdict: "KILL" }]);
    mockGetDb.mockResolvedValue({ select: chain.select });

    const admin = makeUser({ id: 999, role: "admin" });
    const caller = appRouter.createCaller(makeCtx(admin));
    const result = await caller.validation.getSnapshot({ researchId: 42 });
    expect(result.verdict).toBe("KILL");
  });

  it("throws NOT_FOUND when no snapshot persisted yet (mapper failed or research not done)", async () => {
    mockGetResearchById.mockResolvedValue({ id: 42, userId: 7 });
    const { chain } = makeChainable([]); // empty result
    mockGetDb.mockResolvedValue({ select: chain.select });

    const caller = appRouter.createCaller(makeCtx(makeUser()));
    await expect(caller.validation.getSnapshot({ researchId: 42 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws UNAUTHORIZED for anonymous caller", async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    await expect(caller.validation.getSnapshot({ researchId: 42 })).rejects.toThrow();
  });
});

describe("validation.listEvidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns evidence rows for the owner (happy path)", async () => {
    mockGetResearchById.mockResolvedValue({ id: 42, userId: 7 });
    const rows = [
      { id: 1, researchId: 42, type: "web_source", dimensions: ["market_size"], stance: "neutral" },
      { id: 2, researchId: 42, type: "synthesis_claim", dimensions: ["competition"], stance: "weakens" },
    ];
    const { chain } = makeChainable(rows);
    mockGetDb.mockResolvedValue({ select: chain.select });

    const caller = appRouter.createCaller(makeCtx(makeUser()));
    const result = await caller.validation.listEvidence({ researchId: 42 });
    expect(result).toHaveLength(2);
  });

  it("filters by dimension in JS (contains-check over JSON array)", async () => {
    mockGetResearchById.mockResolvedValue({ id: 42, userId: 7 });
    const rows = [
      { id: 1, researchId: 42, type: "web_source", dimensions: ["market_size", "timeliness"], stance: "neutral" },
      { id: 2, researchId: 42, type: "synthesis_claim", dimensions: ["competition"], stance: "weakens" },
      { id: 3, researchId: 42, type: "synthesis_claim", dimensions: ["market_size"], stance: "supports" },
    ];
    const { chain } = makeChainable(rows);
    mockGetDb.mockResolvedValue({ select: chain.select });

    const caller = appRouter.createCaller(makeCtx(makeUser()));
    const result = await caller.validation.listEvidence({ researchId: 42, dimension: "market_size" });
    expect(result.map((r) => r.id)).toEqual([1, 3]);
  });

  it("throws FORBIDDEN when research belongs to another user (IDOR guard)", async () => {
    mockGetResearchById.mockResolvedValue({ id: 42, userId: 9 });
    const caller = appRouter.createCaller(makeCtx(makeUser({ id: 7 })));
    await expect(caller.validation.listEvidence({ researchId: 42 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mockGetDb).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND for non-existent research", async () => {
    mockGetResearchById.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(makeCtx(makeUser()));
    await expect(caller.validation.listEvidence({ researchId: 99999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects negative/zero researchId at input validation", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser()));
    await expect(caller.validation.listEvidence({ researchId: 0 })).rejects.toThrow();
    await expect(caller.validation.listEvidence({ researchId: -1 })).rejects.toThrow();
  });
});

describe("validation.getEvidenceByDimension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("buckets evidence per dimension, duplicating multi-dim rows across buckets (happy path)", async () => {
    mockGetResearchById.mockResolvedValue({ id: 42, userId: 7 });
    const rows = [
      { id: 1, researchId: 42, dimensions: ["market_size", "timeliness"], stance: "supports" },
      { id: 2, researchId: 42, dimensions: ["competition"], stance: "weakens" },
      { id: 3, researchId: 42, dimensions: [], stance: "neutral" }, // empty dim → in NO bucket
      { id: 4, researchId: 42, dimensions: ["feasibility", "monetization"], stance: "supports" },
    ];
    const { chain } = makeChainable(rows);
    mockGetDb.mockResolvedValue({ select: chain.select });

    const caller = appRouter.createCaller(makeCtx(makeUser()));
    const buckets = await caller.validation.getEvidenceByDimension({ researchId: 42 });

    expect(buckets.market_size.map((r) => r.id)).toEqual([1]);
    expect(buckets.timeliness.map((r) => r.id)).toEqual([1]);
    expect(buckets.competition.map((r) => r.id)).toEqual([2]);
    expect(buckets.feasibility.map((r) => r.id)).toEqual([4]);
    expect(buckets.monetization.map((r) => r.id)).toEqual([4]);
    // Row 3 (empty dim) should not surface in any bucket
    const allBucketed = Object.values(buckets).flat().map((r) => r.id);
    expect(allBucketed).not.toContain(3);
  });

  it("returns empty buckets when research has no evidence yet", async () => {
    mockGetResearchById.mockResolvedValue({ id: 42, userId: 7 });
    const { chain } = makeChainable([]);
    mockGetDb.mockResolvedValue({ select: chain.select });

    const caller = appRouter.createCaller(makeCtx(makeUser()));
    const buckets = await caller.validation.getEvidenceByDimension({ researchId: 42 });

    expect(buckets.market_size).toEqual([]);
    expect(buckets.competition).toEqual([]);
    expect(Object.keys(buckets)).toEqual([
      "market_size", "competition", "feasibility", "monetization", "timeliness",
    ]);
  });

  it("throws FORBIDDEN when research belongs to another user (IDOR guard)", async () => {
    mockGetResearchById.mockResolvedValue({ id: 42, userId: 9 });
    const caller = appRouter.createCaller(makeCtx(makeUser({ id: 7 })));
    await expect(caller.validation.getEvidenceByDimension({ researchId: 42 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mockGetDb).not.toHaveBeenCalled();
  });

  it("throws UNAUTHORIZED for anonymous caller", async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    await expect(caller.validation.getEvidenceByDimension({ researchId: 42 })).rejects.toThrow();
  });
});
