import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

import { seedModelRouting } from "./seed";
import { getDb } from "../db";

describe("seedModelRouting", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("inserts defaults when table is empty", async () => {
    const valuesMock = vi.fn().mockResolvedValue(undefined);
    const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
    (getDb as any).mockResolvedValue({
      select: () => ({ from: () => ({ limit: async () => [] }) }),
      insert: insertMock,
    });
    await seedModelRouting();
    expect(insertMock).toHaveBeenCalledOnce();
    expect(valuesMock).toHaveBeenCalledOnce();
    // Verify shape: 6 rows, each with phase + primaryModel
    const rows = valuesMock.mock.calls[0][0];
    expect(rows).toHaveLength(6);
    expect(rows.every((r: any) => typeof r.phase === "string" && typeof r.primaryModel === "string")).toBe(true);
  });

  it("does nothing when table already has rows (idempotent)", async () => {
    const insertMock = vi.fn();
    (getDb as any).mockResolvedValue({
      select: () => ({ from: () => ({ limit: async () => [{ id: 1 }] }) }),
      insert: insertMock,
    });
    await seedModelRouting();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("skips when DB is unavailable (getDb returns falsy)", async () => {
    (getDb as any).mockResolvedValue(null);
    // Should not throw
    await expect(seedModelRouting()).resolves.toBeUndefined();
  });
});
