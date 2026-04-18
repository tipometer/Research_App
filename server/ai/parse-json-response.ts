import { z } from "zod";

/**
 * Extracts a JSON object from LLM text output and validates it against a Zod schema.
 *
 * This is a SINGLE-SHOT helper — it does NOT retry on failure. Callers that need
 * retry (e.g. primary grounded-phase calls with 1× Zod-error-aware retry) must
 * implement the retry loop themselves, not inside this helper. Callers that use
 * this as a fallback path (e.g. invokeNonGroundedFallback) intentionally stay
 * one-shot per executeWithFallback design.
 *
 * The extraction tries to find the first/largest `{...}` block in the response
 * text (the LLM may wrap output in prose or markdown fences). If the match
 * succeeds but JSON.parse throws, SyntaxError propagates. If schema.parse throws,
 * ZodError propagates.
 *
 * @throws SyntaxError — if the extracted JSON text cannot be parsed
 * @throws z.ZodError — if the parsed object does not match the schema
 */
export function parseJsonResponse<T extends z.ZodSchema>(
  text: string,
  schema: T,
): z.infer<T> {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const jsonText = jsonMatch ? jsonMatch[0] : text;
  const parsed = JSON.parse(jsonText);
  return schema.parse(parsed);
}
