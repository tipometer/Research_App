import { APICallError } from "ai";
import { z } from "zod";
import type { Phase } from "./router";

/**
 * Marker error thrown by runPhase4Stream when a synthesis stream error occurs
 * AFTER the first partial has been yielded (mid-stream). Research-pipeline's
 * catch block checks `instanceof PipelineStreamError` to decide whether to
 * preserve the partial markdown in the error UI (vs. showing an empty state
 * for pre-stream failures).
 *
 * Wraps the original provider/network error as `cause`. The original error's
 * message is preserved; stack trace is appended.
 */
export class PipelineStreamError extends Error {
  readonly wasStreaming = true as const;

  constructor(cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(causeMessage);
    this.name = "PipelineStreamError";
    this.cause = cause;
  }
}

export interface FallbackContext {
  phase: Phase;
  onFallback?: (reason: string) => void;
}

export function isFallbackEligible(err: unknown): boolean {
  if (err instanceof z.ZodError) return true;
  if (err instanceof APICallError) {
    const code = err.statusCode;
    if (code !== undefined && code < 500 && code !== 429) return false;
    return true;
  }
  // Programming errors are code bugs — fallback can't fix them, would just double-latency.
  if (err instanceof TypeError || err instanceof ReferenceError || err instanceof RangeError) {
    console.warn(`[fallback] Code bug suspected (${err.name}: ${err.message}). Not attempting fallback.`);
    return false;
  }
  // Generic Error / AbortError / network / timeout / unknown throw → eligible (transient assumption)
  return true;
}

export async function executeWithFallback<T>(
  primary: () => Promise<T>,
  fallback: (() => Promise<T>) | null,
  ctx: FallbackContext,
): Promise<T> {
  try {
    return await primary();
  } catch (err) {
    if (!isFallbackEligible(err) || !fallback) {
      throw err;
    }
    const reason = err instanceof APICallError
      ? `${err.statusCode}: ${err.message}`
      : String(err);
    console.warn(`[fallback] ${ctx.phase} primary failed (${reason}). Attempting fallback.`);
    // Fire onFallback BEFORE the attempt — user sees the event whether or not fallback succeeds
    ctx.onFallback?.(reason);
    try {
      return await fallback();
    } catch (fallbackErr) {
      console.error(`[fallback] ${ctx.phase} fallback also failed:`, fallbackErr);
      throw fallbackErr;
    }
  }
}
