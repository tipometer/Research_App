/**
 * Regression tests for the addCredit / deductCredit SQL-expression bug fix.
 *
 * Previous form (broken): `set({ credits: (users.credits as any) + amount })`
 *   — JS `+` on a Drizzle column reference coerced it to "[object Object]",
 *   producing UPDATE bind parameters like `"[object Object]5"` and a 500 on
 *   every call (research.create, admin.adjustCredits, stripe webhooks, refund).
 *
 * Fixed form: `set({ credits: sql\`\${users.credits} + \${amount}\` })` —
 *   produces a proper `credits = credits + ?` SQL expression.
 *
 * We mock `mysql2/promise` at module boundary (the only layer whose functions
 * are called cross-module from db.ts) and assert the resulting SQL text.
 * Drizzle's internal chain is unmocked so the bug — which manifested in the
 * bind parameters — can be caught end-to-end.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Capture layer ──────────────────────────────────────────────────────────

// Shared capture arrays; reset in beforeEach.
const executedQueries: Array<{ sql: string; params: unknown[] }> = [];

const mockConnection = {
  execute: vi.fn(async (queryOrOptions: unknown, params?: unknown[]) => {
    const sqlText = typeof queryOrOptions === "string"
      ? queryOrOptions
      : (queryOrOptions as { sql: string }).sql;
    executedQueries.push({ sql: sqlText, params: params ?? [] });
    // Return mysql2-style [results, fields]
    return [{ affectedRows: 1, insertId: 1 }, []];
  }),
  query: vi.fn(async (queryOrOptions: unknown, params?: unknown[]) => {
    const sqlText = typeof queryOrOptions === "string"
      ? queryOrOptions
      : (queryOrOptions as { sql: string }).sql;
    executedQueries.push({ sql: sqlText, params: params ?? [] });
    return [{ affectedRows: 1, insertId: 1 }, []];
  }),
  end: vi.fn(),
  release: vi.fn(),
};

// Pool-like: mysql2 drizzle driver calls getConnection(), execute(), query() on the pool.
const mockPool = {
  ...mockConnection,
  getConnection: vi.fn(async () => mockConnection),
};

vi.mock("mysql2/promise", () => ({
  default: {
    createPool: vi.fn(() => mockPool),
  },
  createPool: vi.fn(() => mockPool),
}));

// Ensure getDb() actually tries to connect (it guards on process.env.DATABASE_URL).
process.env.DATABASE_URL = "mysql://test:test@localhost:3306/testdb";

// ─── Import AFTER mocks + env ───────────────────────────────────────────────

import { addCredit, deductCredit } from "./db";

// ─── Tests ──────────────────────────────────────────────────────────────────

function findQuery(fragment: string): { sql: string; params: unknown[] } | undefined {
  return executedQueries.find((q) => q.sql.includes(fragment));
}

describe("addCredit — SQL expression fix", () => {
  beforeEach(() => {
    executedQueries.length = 0;
    vi.clearAllMocks();
  });

  it("UPDATEs credits = credits + ? (SQL expression, not '[object Object]N' param)", async () => {
    await addCredit(1, 5, "test grant");

    const update = findQuery("update") ?? findQuery("UPDATE");
    expect(update, "no UPDATE query observed — check mock capture").toBeDefined();

    // Primary regression assertion: bind params must not contain the coercion artifact.
    const paramsStr = JSON.stringify(update!.params);
    expect(paramsStr).not.toContain("[object Object]");

    // Positive shape check: the UPDATE should reference credits on both sides
    // (the SQL expression `credits + ?` expands to `\`users\`.\`credits\` + ?`).
    expect(update!.sql.toLowerCase()).toMatch(/credits.*\+/);

    // The numeric `amount` should end up as a proper bind param (number or stringified number).
    const numericParam = update!.params.find((p) => p === 5 || p === "5");
    expect(numericParam).toBeDefined();
  });

  it("INSERTs a positive credit_transactions row with type=purchase", async () => {
    await addCredit(7, 10, "stripe top-up");
    const insert = findQuery("credit_transactions") ?? findQuery("insert");
    expect(insert).toBeDefined();
    // Amount should be positive 10, type should be "purchase"
    expect(insert!.params).toContain(10);
    expect(insert!.params.some((p) => p === "purchase")).toBe(true);
    expect(insert!.params.some((p) => p === "stripe top-up")).toBe(true);
  });
});

describe("deductCredit — SQL expression fix", () => {
  beforeEach(() => {
    executedQueries.length = 0;
    vi.clearAllMocks();
  });

  it("UPDATEs credits = credits - ? (SQL expression, not '[object Object]N' param)", async () => {
    await deductCredit(1, 3, "research cost");

    const update = findQuery("update") ?? findQuery("UPDATE");
    expect(update, "no UPDATE query observed — check mock capture").toBeDefined();
    const paramsStr = JSON.stringify(update!.params);
    expect(paramsStr).not.toContain("[object Object]");
    expect(update!.sql.toLowerCase()).toMatch(/credits.*-/);
    const numericParam = update!.params.find((p) => p === 3 || p === "3");
    expect(numericParam).toBeDefined();
  });

  it("INSERTs a negative credit_transactions row with type=usage", async () => {
    await deductCredit(7, 4, "research cost");
    const insert = findQuery("credit_transactions") ?? findQuery("insert");
    expect(insert).toBeDefined();
    // Amount should be -4 (negated), type should be "usage"
    expect(insert!.params).toContain(-4);
    expect(insert!.params.some((p) => p === "usage")).toBe(true);
  });
});
