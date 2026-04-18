import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseJsonResponse } from "./parse-json-response";

const TestSchema = z.object({ n: z.number(), s: z.string() });

describe("parseJsonResponse", () => {
  it("extracts and validates plain JSON", () => {
    const result = parseJsonResponse('{"n": 42, "s": "hello"}', TestSchema);
    expect(result).toEqual({ n: 42, s: "hello" });
  });

  it("extracts JSON from text with surrounding prose", () => {
    const text = 'Here is the response: {"n": 1, "s": "x"} let me know if anything else.';
    const result = parseJsonResponse(text, TestSchema);
    expect(result).toEqual({ n: 1, s: "x" });
  });

  it("extracts JSON from markdown code fences", () => {
    const text = '```json\n{"n": 5, "s": "code"}\n```';
    const result = parseJsonResponse(text, TestSchema);
    expect(result).toEqual({ n: 5, s: "code" });
  });

  it("throws SyntaxError on malformed JSON", () => {
    expect(() => parseJsonResponse('{"n": 42, "s":}', TestSchema)).toThrow(SyntaxError);
  });

  it("throws ZodError on schema mismatch", () => {
    expect(() => parseJsonResponse('{"n": "not a number"}', TestSchema)).toThrow(z.ZodError);
  });

  it("does NOT retry on failure (caller responsibility)", () => {
    // This is a documentation test — parseJsonResponse is single-shot.
    // If called with malformed JSON, it throws once — no automatic retry.
    expect(() => parseJsonResponse('{malformed', TestSchema)).toThrow();
    // No visible retry side-effects (nothing to assert, just confirming no loop)
  });
});
