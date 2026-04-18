import { describe, it, expect, vi } from "vitest";
import { APICallError } from "ai";
import { z } from "zod";
import { isFallbackEligible, executeWithFallback } from "./fallback";

const makeApiError = (statusCode: number | undefined) => new APICallError({
  message: "test",
  url: "https://api.test/x",
  requestBodyValues: {},
  statusCode,
});

describe("isFallbackEligible", () => {
  it("returns true for ZodError (retry exhausted)", () => {
    expect(isFallbackEligible(new z.ZodError([]))).toBe(true);
  });

  it("returns true for APICallError 503 (transient server)", () => {
    expect(isFallbackEligible(makeApiError(503))).toBe(true);
  });

  it("returns true for APICallError 429 (rate limit)", () => {
    expect(isFallbackEligible(makeApiError(429))).toBe(true);
  });

  it("returns false for APICallError 401 (auth)", () => {
    expect(isFallbackEligible(makeApiError(401))).toBe(false);
  });

  it("returns false for APICallError 400 (bad request)", () => {
    expect(isFallbackEligible(makeApiError(400))).toBe(false);
  });

  it("returns false for APICallError 403 (forbidden)", () => {
    expect(isFallbackEligible(makeApiError(403))).toBe(false);
  });

  it("returns false for APICallError 404 (model not found — explicit, per spec §4.1)", () => {
    expect(isFallbackEligible(makeApiError(404))).toBe(false);
  });

  it("returns true for APICallError with undefined statusCode (network)", () => {
    expect(isFallbackEligible(makeApiError(undefined))).toBe(true);
  });
});

describe("executeWithFallback", () => {
  it("returns primary result when primary succeeds — fallback never called", async () => {
    const primary = vi.fn().mockResolvedValue("ok");
    const fallback = vi.fn();
    const result = await executeWithFallback(primary, fallback, { phase: "wide_scan" });
    expect(result).toBe("ok");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("calls fallback when primary throws eligible error; returns fallback result", async () => {
    const primary = vi.fn().mockRejectedValue(makeApiError(503));
    const fallback = vi.fn().mockResolvedValue("fb-ok");
    const onFallback = vi.fn();
    const result = await executeWithFallback(primary, fallback, { phase: "wide_scan", onFallback });
    expect(result).toBe("fb-ok");
    expect(fallback).toHaveBeenCalledOnce();
    expect(onFallback).toHaveBeenCalledWith(expect.stringContaining("503"));
  });

  it("rethrows when primary throws NON-eligible error (401); no fallback attempt", async () => {
    const err = makeApiError(401);
    const primary = vi.fn().mockRejectedValue(err);
    const fallback = vi.fn();
    await expect(
      executeWithFallback(primary, fallback, { phase: "wide_scan" })
    ).rejects.toBe(err);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("rethrows original error when fallback is null", async () => {
    const err = makeApiError(503);
    const primary = vi.fn().mockRejectedValue(err);
    await expect(
      executeWithFallback(primary, null, { phase: "wide_scan" })
    ).rejects.toBe(err);
  });

  it("rethrows fallback error when fallback ALSO fails", async () => {
    const primary = vi.fn().mockRejectedValue(makeApiError(503));
    const fallbackErr = new Error("fallback-also-fail");
    const fallback = vi.fn().mockRejectedValue(fallbackErr);
    await expect(
      executeWithFallback(primary, fallback, { phase: "wide_scan" })
    ).rejects.toBe(fallbackErr);
  });

  it("invokes onFallback callback with reason string", async () => {
    const primary = vi.fn().mockRejectedValue(makeApiError(503));
    const fallback = vi.fn().mockResolvedValue("ok");
    const onFallback = vi.fn();
    await executeWithFallback(primary, fallback, { phase: "synthesis", onFallback });
    expect(onFallback).toHaveBeenCalledOnce();
    expect(onFallback).toHaveBeenCalledWith(expect.stringMatching(/503/));
  });
});
