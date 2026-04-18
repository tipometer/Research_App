import { APICallError } from "ai";
import { z } from "zod";
import type { Phase } from "./router";

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
