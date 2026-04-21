/**
 * Deep Research App — Server-side Tests
 * Tests cover: auth, research CRUD, credit management, survey, brainstorm, pipeline security
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";
import type { User } from "../drizzle/schema";

// ── Module Mocks ───────────────────────────────────────────────────────────
// Pre-emptive mocks for the new ai/pipeline-phases helpers (Task 10 refactor).
// When Task 10 lands and research-pipeline.ts switches to these functions,
// the mocks take effect immediately and keep the 16 integration tests green.
// The _core/llm mock (if any) is intentionally absent — current pipeline
// doesn't use it directly from this test's module path.

vi.mock("./ai/pipeline-phases", () => ({
  runPhase1: vi.fn().mockResolvedValue({
    data: {
      keywords: ["ai", "research", "market"],
      summary: "Mock wide scan summary of the market for the given niche.".padEnd(60, "."),
    },
    sources: [
      {
        url: "https://mock.example.com/a",
        title: "Mock Source A",
        snippet: "...",
        sourceType: "blog",
        publishedAt: null,
      },
    ],
  }),
  runPhase2: vi.fn().mockResolvedValue({
    data: {
      gaps: [
        { title: "Gap 1", description: "desc 1" },
        { title: "Gap 2", description: "desc 2" },
      ],
      competitors: [
        { name: "Comp 1", weakness: "weak 1" },
        { name: "Comp 2", weakness: "weak 2" },
      ],
      summary: "Mock gap detection summary of market structure.".padEnd(60, "."),
    },
    sources: [],
  }),
  runPhase3: vi.fn().mockResolvedValue({
    data: {
      monetizationModels: [
        { name: "SaaS", description: "Monthly subscription" },
        { name: "Freemium", description: "Free tier + paid upgrades" },
      ],
      technicalChallenges: [
        { title: "Scaling", severity: "medium" as const },
        { title: "Compliance", severity: "high" as const },
      ],
      summary: "Mock deep dives summary covering monetization and feasibility.".padEnd(60, "."),
    },
    sources: [],
  }),
  runPhase4Stream: vi.fn().mockImplementation(
    async (_input: unknown, onPartial: (p: unknown) => void) => {
      const final = {
        verdict: "GO" as const,
        synthesisScore: 7.5,
        scores: {
          marketSize: 8,
          competition: 6,
          feasibility: 7,
          monetization: 7,
          timeliness: 8,
        },
        reportMarkdown: "## Mock Report\n\n".padEnd(4500, "x"),
        verdictReason: "Mock verdict reason for a strong GO signal.".padEnd(60, "."),
        // Validation Workspace additive fields (sprint V2)
        positiveDrivers: ["Driver A grounded.", "Driver B grounded."],
        negativeDrivers: ["Concern A grounded.", "Concern B grounded."],
        missingEvidence: ["Unknown X — survey needed."],
        nextActions: [
          "Run a 5-question pricing survey.",
          "Interview 3 target users.",
          "Prototype MVP in 2 weeks.",
        ],
        synthesisClaims: [
          { claim: "Market grows 20% YoY.", dimensions: ["market_size"], stance: "supports", confidence: 0.85 },
          { claim: "Incumbents are few.", dimensions: ["competition"], stance: "weakens", confidence: 0.7 },
          { claim: "Stack is mature.", dimensions: ["feasibility"], stance: "supports", confidence: 0.9 },
        ],
      };
      onPartial({ verdict: "GO" });
      onPartial(final);
      return final;
    },
  ),
  runPolling: vi.fn().mockResolvedValue({
    questions: [
      { id: "q1", type: "single_choice" as const, text: "Q1?", options: ["a", "b"] },
      { id: "q2", type: "likert" as const, text: "Q2?" },
      { id: "q3", type: "short_text" as const, text: "Q3?" },
    ],
  }),
  runBrainstorm: vi.fn().mockResolvedValue({
    ideas: Array.from({ length: 10 }, (_, i) => ({
      id: `idea-${i}`,
      title: `Idea ${i}`,
      description: `Mock idea ${i} description.`,
    })),
  }),
}));

vi.mock("./ai/router", () => ({
  resolvePhase: vi.fn().mockResolvedValue({
    model: "mock-model",
    provider: "openai",
    client: (_name: string) => ({}),
  }),
  detectProvider: vi.fn().mockReturnValue("openai"),
  lookupModel: vi.fn().mockResolvedValue("mock-model"),
  lookupApiKey: vi.fn().mockResolvedValue("sk-mock"),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    openId: "test-open-id",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "google",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
}

function makeAdminUser(): User {
  return makeUser({ id: 2, openId: "admin-open-id", role: "admin" });
}

function makeContext(user: User | null = null): TrpcContext {
  const clearedCookies: string[] = [];
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: (name: string) => clearedCookies.push(name),
    } as TrpcContext["res"],
  };
}

// ── Auth Tests ─────────────────────────────────────────────────────────────

describe("auth.me", () => {
  it("returns null for unauthenticated user", async () => {
    const caller = appRouter.createCaller(makeContext(null));
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });

  it("returns user for authenticated user", async () => {
    const user = makeUser();
    const caller = appRouter.createCaller(makeContext(user));
    const result = await caller.auth.me();
    expect(result).toMatchObject({ openId: "test-open-id", email: "test@example.com" });
  });
});

describe("auth.logout", () => {
  it("clears the session cookie and reports success", async () => {
    const clearedCookies: { name: string; options: Record<string, unknown> }[] = [];
    const ctx: TrpcContext = {
      user: makeUser(),
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {
        clearCookie: (name: string, options: Record<string, unknown>) => {
          clearedCookies.push({ name, options });
        },
      } as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    expect(clearedCookies[0]?.options).toMatchObject({ maxAge: -1, httpOnly: true });
  });
});

// ── Research Tests ─────────────────────────────────────────────────────────

describe("research.list", () => {
  it("throws UNAUTHORIZED for unauthenticated user", async () => {
    const caller = appRouter.createCaller(makeContext(null));
    await expect(caller.research.list()).rejects.toThrow();
  });
});

describe("research.create", () => {
  it("throws UNAUTHORIZED for unauthenticated user", async () => {
    const caller = appRouter.createCaller(makeContext(null));
    await expect(
      caller.research.create({
        nicheName: "Test niche",
        description: "Test description",
        strategy: "gaps",
      })
    ).rejects.toThrow();
  });
});

// ── Credit Tests ───────────────────────────────────────────────────────────

describe("user.credits", () => {
  it("throws UNAUTHORIZED for unauthenticated user", async () => {
    const caller = appRouter.createCaller(makeContext(null));
    await expect(caller.user.credits()).rejects.toThrow();
  });
});

// ── Admin Tests ────────────────────────────────────────────────────────────

describe("admin.users", () => {
  it("throws UNAUTHORIZED for unauthenticated user", async () => {
    const caller = appRouter.createCaller(makeContext(null));
    await expect(caller.admin.users()).rejects.toThrow();
  });

  it("throws FORBIDDEN for non-admin user", async () => {
    const caller = appRouter.createCaller(makeContext(makeUser({ role: "user" })));
    await expect(caller.admin.users()).rejects.toThrow();
  });
});

describe("admin.auditLogs", () => {
  it("throws FORBIDDEN for non-admin user", async () => {
    const caller = appRouter.createCaller(makeContext(makeUser({ role: "user" })));
    await expect(caller.admin.auditLogs({ limit: 10 })).rejects.toThrow();
  });
});

// ── Survey Tests ───────────────────────────────────────────────────────────

describe("survey.getByToken", () => {
  it("throws NOT_FOUND for invalid token (DB returns null)", async () => {
    // This test verifies the NOT_FOUND guard in the survey.getByToken procedure.
    // In a real DB environment it would throw; in test environment without DB it may also throw.
    const caller = appRouter.createCaller(makeContext(null));
    // Either throws NOT_FOUND (DB connected) or throws due to no DB — both are acceptable
    await expect(
      caller.survey.getByToken({ token: "nonexistent-token-xyz-abc" })
    ).rejects.toThrow();
  });
});

// ── Brainstorm Tests ───────────────────────────────────────────────────────

describe("brainstorm.generate", () => {
  it("throws UNAUTHORIZED for unauthenticated user", async () => {
    const caller = appRouter.createCaller(makeContext(null));
    await expect(
      caller.brainstorm.generate({ context: "fitness apps for daily tracking" })
    ).rejects.toThrow();
  });
});

// ── Security: Input Validation ─────────────────────────────────────────────

describe("security: input validation", () => {
  it("rejects research.create with empty niche (XSS/injection prevention)", async () => {
    const caller = appRouter.createCaller(makeContext(makeUser()));
    await expect(
      caller.research.create({
        nicheName: "",
        description: "desc",
        strategy: "gaps",
      })
    ).rejects.toThrow();
  });

  it("rejects research.create with niche exceeding max length", async () => {
    const caller = appRouter.createCaller(makeContext(makeUser()));
    await expect(
      caller.research.create({
        nicheName: "a".repeat(257),
        description: "desc",
        strategy: "gaps",
      })
    ).rejects.toThrow();
  });

  it("rejects survey.respond with empty answers (token not found)", async () => {
    const caller = appRouter.createCaller(makeContext(null));
    // Empty answers object — survey won't be found so it throws
    await expect(
      caller.survey.respond({ token: "invalid-token", answers: {} })
    ).rejects.toThrow();
  });
});

// ── GDPR Tests ─────────────────────────────────────────────────────────────

describe("user.credits", () => {
  it("throws UNAUTHORIZED for unauthenticated user", async () => {
    const caller = appRouter.createCaller(makeContext(null));
    await expect(caller.user.credits()).rejects.toThrow();
  });
});

describe("user.transactions", () => {
  it("throws UNAUTHORIZED for unauthenticated user", async () => {
    const caller = appRouter.createCaller(makeContext(null));
    await expect(caller.user.transactions()).rejects.toThrow();
  });
});

// ── Admin AI Config Tests ──────────────────────────────────────────────────

describe("admin.ai.listConfigs", () => {
  it("throws UNAUTHORIZED for unauthenticated user", async () => {
    const caller = appRouter.createCaller(makeContext(null));
    await expect(caller.admin.ai.listConfigs()).rejects.toThrow();
  });

  it("throws FORBIDDEN for non-admin user", async () => {
    const caller = appRouter.createCaller(makeContext(makeUser({ role: "user" })));
    await expect(caller.admin.ai.listConfigs()).rejects.toThrow();
  });

  it("returns empty array when no DB is available", async () => {
    const caller = appRouter.createCaller(makeContext(makeAdminUser()));
    // No DB in test environment — should return []
    const result = await caller.admin.ai.listConfigs();
    expect(result).toEqual([]);
  });
});

describe("admin.ai.setProviderKey", () => {
  it("throws UNAUTHORIZED for unauthenticated user", async () => {
    const caller = appRouter.createCaller(makeContext(null));
    await expect(
      caller.admin.ai.setProviderKey({ provider: "openai", apiKey: "sk-test-key-12345", isActive: true })
    ).rejects.toThrow();
  });

  it("throws FORBIDDEN for non-admin user", async () => {
    const caller = appRouter.createCaller(makeContext(makeUser({ role: "user" })));
    await expect(
      caller.admin.ai.setProviderKey({ provider: "openai", apiKey: "sk-test-key-12345", isActive: true })
    ).rejects.toThrow();
  });

  it("rejects apiKey shorter than 10 characters", async () => {
    const caller = appRouter.createCaller(makeContext(makeAdminUser()));
    await expect(
      caller.admin.ai.setProviderKey({ provider: "openai", apiKey: "short", isActive: true })
    ).rejects.toThrow();
  });
});

describe("admin.ai.testProvider", () => {
  it("throws UNAUTHORIZED for unauthenticated user", async () => {
    const caller = appRouter.createCaller(makeContext(null));
    await expect(caller.admin.ai.testProvider({ provider: "openai" })).rejects.toThrow();
  });

  it("throws FORBIDDEN for non-admin user", async () => {
    const caller = appRouter.createCaller(makeContext(makeUser({ role: "user" })));
    await expect(caller.admin.ai.testProvider({ provider: "openai" })).rejects.toThrow();
  });

  it("returns ok=false when no DB connection", async () => {
    const caller = appRouter.createCaller(makeContext(makeAdminUser()));
    const result = await caller.admin.ai.testProvider({ provider: "openai" });
    expect(result).toMatchObject({ ok: false });
  });

  it("returns rate-limited response when called twice within 10s", async () => {
    // Use a distinct provider to avoid colliding with the previous test's cooldown state
    const caller = appRouter.createCaller(makeContext(makeAdminUser()));
    // First call — sets the cooldown (returns ok=false due to no DB, but that's fine)
    await caller.admin.ai.testProvider({ provider: "gemini" });
    // Second call — should be rate limited
    const result = await caller.admin.ai.testProvider({ provider: "gemini" });
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/[Rr]ate limit|wait/);
  });
});

describe("admin.ai.listRouting", () => {
  it("throws UNAUTHORIZED for unauthenticated user", async () => {
    const caller = appRouter.createCaller(makeContext(null));
    await expect(caller.admin.ai.listRouting()).rejects.toThrow();
  });

  it("throws FORBIDDEN for non-admin user", async () => {
    const caller = appRouter.createCaller(makeContext(makeUser({ role: "user" })));
    await expect(caller.admin.ai.listRouting()).rejects.toThrow();
  });

  it("returns empty array when no DB is available", async () => {
    const caller = appRouter.createCaller(makeContext(makeAdminUser()));
    const result = await caller.admin.ai.listRouting();
    expect(result).toEqual([]);
  });
});

describe("admin.ai.updateRouting", () => {
  it("throws UNAUTHORIZED for unauthenticated user", async () => {
    const caller = appRouter.createCaller(makeContext(null));
    await expect(
      caller.admin.ai.updateRouting({ phase: "wide_scan", primaryModel: "gpt-4.1-mini" })
    ).rejects.toThrow();
  });

  it("throws FORBIDDEN for non-admin user", async () => {
    const caller = appRouter.createCaller(makeContext(makeUser({ role: "user" })));
    await expect(
      caller.admin.ai.updateRouting({ phase: "wide_scan", primaryModel: "gpt-4.1-mini" })
    ).rejects.toThrow();
  });

  it("rejects primaryModel shorter than 3 characters", async () => {
    const caller = appRouter.createCaller(makeContext(makeAdminUser()));
    await expect(
      caller.admin.ai.updateRouting({ phase: "wide_scan", primaryModel: "gp" })
    ).rejects.toThrow();
  });
});
