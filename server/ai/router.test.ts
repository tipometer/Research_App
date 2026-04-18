import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

vi.mock("./providers", () => ({
  getProvider: vi.fn(),
}));

import { detectProvider, lookupModel, lookupApiKey, resolvePhaseWithFallback } from "./router";
import { getDb } from "../db";
import { getProvider } from "./providers";

describe("detectProvider", () => {
  it("returns 'gemini' for gemini-* models", () => {
    expect(detectProvider("gemini-2.5-flash")).toBe("gemini");
    expect(detectProvider("gemini-2.5-pro")).toBe("gemini");
  });
  it("returns 'openai' for gpt-* / o3-* / o4-* models", () => {
    expect(detectProvider("gpt-4.1-mini")).toBe("openai");
    expect(detectProvider("gpt-4.1")).toBe("openai");
    expect(detectProvider("o3-mini")).toBe("openai");
    expect(detectProvider("o4-mini-2025-04-16")).toBe("openai");
  });
  it("returns 'anthropic' for claude-* models", () => {
    expect(detectProvider("claude-sonnet-4-6")).toBe("anthropic");
    expect(detectProvider("claude-opus-4-7")).toBe("anthropic");
  });
  it("throws for unknown model prefix", () => {
    expect(() => detectProvider("llama-3")).toThrow(/Unknown provider/);
    expect(() => detectProvider("")).toThrow();
  });
});

describe("lookupModel", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { delete process.env.DEFAULT_MODEL_WIDE_SCAN; });

  it("returns DB value when modelRouting row exists", async () => {
    (getDb as any).mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ primaryModel: "gemini-2.5-pro" }],
          }),
        }),
      }),
    });
    expect(await lookupModel("wide_scan")).toBe("gemini-2.5-pro");
  });

  it("falls back to ENV when DB row missing", async () => {
    process.env.DEFAULT_MODEL_WIDE_SCAN = "gemini-2.5-flash";
    (getDb as any).mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [] }),
        }),
      }),
    });
    expect(await lookupModel("wide_scan")).toBe("gemini-2.5-flash");
  });

  it("falls back to hardcoded default when DB and ENV empty", async () => {
    (getDb as any).mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [] }),
        }),
      }),
    });
    // no ENV var set
    expect(await lookupModel("wide_scan")).toBe("gemini-2.5-flash");  // from HARDCODED_DEFAULTS
  });
});

describe("lookupApiKey", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("returns DB value when aiConfig active row exists", async () => {
    (getDb as any).mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [{ apiKey: "sk-from-db" }] }),
        }),
      }),
    });
    expect(await lookupApiKey("openai")).toBe("sk-from-db");
  });

  it("falls back to ENV when DB row missing", async () => {
    process.env.OPENAI_API_KEY = "sk-from-env";
    (getDb as any).mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [] }),
        }),
      }),
    });
    expect(await lookupApiKey("openai")).toBe("sk-from-env");
  });

  it("throws when no key in DB and no ENV var", async () => {
    (getDb as any).mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [] }),
        }),
      }),
    });
    await expect(lookupApiKey("openai")).rejects.toThrow(/No API key configured/);
  });
});

describe("resolvePhaseWithFallback", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("returns primary + null fallback when fallbackModel not configured", async () => {
    (getDb as any).mockResolvedValue({
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ primaryModel: "gemini-2.5-flash", fallbackModel: null }] }) }) }),
    });
    process.env.GEMINI_API_KEY = "sk-gem";

    const result = await resolvePhaseWithFallback("wide_scan");
    expect(result.primary.model).toBe("gemini-2.5-flash");
    expect(result.primary.provider).toBe("gemini");
    expect(result.fallback).toBeNull();
  });

  it("returns both primary and fallback when fallbackModel set (same provider)", async () => {
    (getDb as any).mockResolvedValue({
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ primaryModel: "gemini-2.5-flash", fallbackModel: "gemini-1.5-pro" }] }) }) }),
    });
    process.env.GEMINI_API_KEY = "sk-gem";
    const result = await resolvePhaseWithFallback("wide_scan");
    expect(result.primary.model).toBe("gemini-2.5-flash");
    expect(result.fallback?.model).toBe("gemini-1.5-pro");
    expect(result.fallback?.provider).toBe("gemini");
  });

  it("returns cross-provider fallback (Gemini primary → OpenAI fallback)", async () => {
    (getDb as any).mockResolvedValue({
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ primaryModel: "gemini-2.5-flash", fallbackModel: "gpt-4.1-mini" }] }) }) }),
    });
    process.env.GEMINI_API_KEY = "sk-gem";
    process.env.OPENAI_API_KEY = "sk-openai";
    const result = await resolvePhaseWithFallback("wide_scan");
    expect(result.primary.provider).toBe("gemini");
    expect(result.fallback?.provider).toBe("openai");
  });

  it("returns fallback: null when fallback lookup fails (missing API key)", async () => {
    (getDb as any).mockResolvedValue({
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ primaryModel: "gemini-2.5-flash", fallbackModel: "gpt-4.1-mini" }] }) }) }),
    });
    process.env.GEMINI_API_KEY = "sk-gem";
    // OPENAI_API_KEY intentionally NOT set → lookupApiKey throws → fallback resolve catches → null
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await resolvePhaseWithFallback("wide_scan");
    expect(result.primary.model).toBe("gemini-2.5-flash");
    expect(result.fallback).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Fallback"));
    warnSpy.mockRestore();
  });
});
