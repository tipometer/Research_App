import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// Mock the ai package's generateText
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

import { generateText } from "ai";
import { invokeWithRetry } from "./retry";

const TestSchema = z.object({ n: z.number() });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("invokeWithRetry", () => {
  it("returns validated object on first success", async () => {
    (generateText as any).mockResolvedValueOnce({
      output: { n: 42 },
    });
    const result = await invokeWithRetry({} as any, TestSchema, []);
    expect(result).toEqual({ n: 42 });
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("retries once on ZodError-shaped output mismatch, succeeds second time", async () => {
    // First call: returns output that doesn't match schema → invokeWithRetry triggers Zod parse
    // In v6, Output.object probably validates internally; if not, our wrapper does.
    // Simulating a bad-then-good sequence:
    (generateText as any)
      .mockResolvedValueOnce({ output: { n: "not a number" } }) // will fail Zod
      .mockResolvedValueOnce({ output: { n: 7 } });
    const result = await invokeWithRetry({} as any, TestSchema, []);
    expect(result).toEqual({ n: 7 });
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("retries once on Zod validation, fails again → throws", async () => {
    (generateText as any)
      .mockResolvedValueOnce({ output: { n: "bad" } })
      .mockResolvedValueOnce({ output: { n: "still bad" } });
    await expect(invokeWithRetry({} as any, TestSchema, [])).rejects.toThrow();
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("does not retry on unrelated errors (e.g., network)", async () => {
    (generateText as any).mockRejectedValueOnce(new Error("network down"));
    await expect(invokeWithRetry({} as any, TestSchema, [])).rejects.toThrow("network down");
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("skips retry when remainingMs is below threshold", async () => {
    (generateText as any).mockResolvedValueOnce({ output: { n: "bad" } });
    const deadline = Date.now() + 10_000; // 10s remaining, below 30s threshold
    await expect(invokeWithRetry({} as any, TestSchema, [], { deadline })).rejects.toThrow();
    expect(generateText).toHaveBeenCalledOnce();
  });

  it("embeds Zod error details in retry prompt", async () => {
    (generateText as any)
      .mockResolvedValueOnce({ output: { n: "bad" } })
      .mockResolvedValueOnce({ output: { n: 1 } });
    await invokeWithRetry({} as any, TestSchema, [{ role: "user", content: "initial" }]);
    const secondCallArgs = (generateText as any).mock.calls[1][0];
    const lastMessage = secondCallArgs.messages[secondCallArgs.messages.length - 1];
    expect(lastMessage.content).toContain("failed validation");
    expect(lastMessage.content).toContain("n");
  });
});
