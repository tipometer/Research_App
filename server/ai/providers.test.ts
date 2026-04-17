import { describe, it, expect } from "vitest";
import { getProvider, type ProviderId } from "./providers";

describe("getProvider", () => {
  it("returns OpenAI provider for 'openai'", () => {
    const p = getProvider("openai", "sk-test");
    expect(typeof p).toBe("function");
  });
  it("returns Anthropic provider for 'anthropic'", () => {
    const p = getProvider("anthropic", "sk-ant-test");
    expect(typeof p).toBe("function");
  });
  it("returns Gemini provider for 'gemini'", () => {
    const p = getProvider("gemini", "AIza-test");
    expect(typeof p).toBe("function");
  });
  it("throws for unknown provider", () => {
    // @ts-expect-error — intentionally passing invalid id
    expect(() => getProvider("unknown" as ProviderId, "key")).toThrow();
  });
});
