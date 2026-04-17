import { generateText, Output, type ModelMessage } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { resolvePhase, type Phase } from "./router";
import { extractSources, type ExtractedSource, type GroundingMetadata } from "./grounding";
import {
  WideScanSchema, type WideScanOutput,
  GapDetectionSchema, type GapDetectionOutput,
  DeepDivesSchema, type DeepDivesOutput,
} from "./schemas";

const RETRY_RESERVED_MS = 30_000;

/**
 * Google Search grounding tool — the v3 provider API replaced
 * `providerOptions.google.useSearchGrounding` with an explicit tool.
 * Must be named "google_search" per the provider contract.
 */
const GOOGLE_SEARCH_TOOL = google.tools.googleSearch({ name: "google_search" });

export interface PhaseInput {
  nicheName: string;
  strategy: "gaps" | "predator" | "provisioning";
  description?: string;
}

export interface PhaseResult<T> {
  data: T;
  sources: ExtractedSource[];
}

/**
 * Grounded phase invoker. Unlike `invokeWithRetry` (Task 7), this preserves
 * providerMetadata so we can extract groundingMetadata for the sources table.
 * Inlines the 1x Zod retry pattern.
 */
async function invokeGrounded<TSchema extends z.ZodSchema>(
  _phase: Phase,
  schema: TSchema,
  messages: ModelMessage[],
  options: { abortSignal?: AbortSignal; deadline?: number } = {},
): Promise<PhaseResult<z.infer<TSchema>>> {
  const { model, client } = await resolvePhase(_phase);
  const modelInstance = client(model);

  async function oneCall(extraMessages: ModelMessage[] = []) {
    return generateText({
      model: modelInstance,
      messages: [...messages, ...extraMessages],
      experimental_output: Output.object({ schema }),
      tools: { google_search: GOOGLE_SEARCH_TOOL },
      abortSignal: options.abortSignal,
    });
  }

  let rawResult: Awaited<ReturnType<typeof oneCall>>;
  let parsed: z.infer<TSchema>;
  try {
    rawResult = await oneCall();
    parsed = schema.parse((rawResult as any).experimental_output);
  } catch (err) {
    if (!(err instanceof z.ZodError)) throw err;
    if (options.deadline && options.deadline - Date.now() < RETRY_RESERVED_MS) throw err;

    const errorDetails = err.issues
      .map(e => `${e.path.join(".") || "(root)"}: ${e.message}`)
      .join("; ");

    rawResult = await oneCall([
      {
        role: "user",
        content:
          `Your previous response failed validation with these errors: ${errorDetails}. ` +
          `Return a valid JSON object matching the exact schema. Do not add extra fields.`,
      },
    ]);
    parsed = schema.parse((rawResult as any).experimental_output);
  }

  const grounding = (rawResult as any).providerMetadata?.google?.groundingMetadata as
    | GroundingMetadata
    | undefined;
  const sources = grounding ? extractSources(grounding) : [];

  return { data: parsed, sources };
}

export async function runPhase1(
  input: PhaseInput,
  options: { abortSignal?: AbortSignal; deadline?: number } = {},
): Promise<PhaseResult<WideScanOutput>> {
  return invokeGrounded("wide_scan", WideScanSchema, [
    {
      role: "system",
      content: "You are a market research expert. Use web search to find real, recent sources.",
    },
    {
      role: "user",
      content: `Perform a wide scan market analysis for this niche: "${input.nicheName}". Strategy: ${input.strategy}.
${input.description ? `Additional context: ${input.description}` : ""}

Return JSON with:
- keywords: 3-7 search keywords you used
- summary: 2-3 sentence summary of initial findings`,
    },
  ], options);
}

export async function runPhase2(
  input: PhaseInput & { phase1Summary: string },
  options: { abortSignal?: AbortSignal; deadline?: number } = {},
): Promise<PhaseResult<GapDetectionOutput>> {
  return invokeGrounded("gap_detection", GapDetectionSchema, [
    {
      role: "system",
      content: "You are a market research expert. Use web search to identify gaps and competitors.",
    },
    {
      role: "user",
      content: `Based on the wide scan of "${input.nicheName}" (summary: ${input.phase1Summary}), identify market gaps and underserved segments, and competitors with weaknesses.

Return JSON with:
- gaps: 2-5 market gaps (title, description)
- competitors: 2-5 competitors (name, weakness)
- summary: 2-3 sentence summary`,
    },
  ], options);
}

export async function runPhase3(
  input: PhaseInput & { phase2Summary: string },
  options: { abortSignal?: AbortSignal; deadline?: number } = {},
): Promise<PhaseResult<DeepDivesOutput>> {
  return invokeGrounded("deep_dives", DeepDivesSchema, [
    {
      role: "system",
      content: "You are a market research expert. Use web search to find current monetization examples and technical details.",
    },
    {
      role: "user",
      content: `Perform deep dives on "${input.nicheName}" (gap analysis: ${input.phase2Summary}) focusing on monetization models, technical feasibility, and market timing.

Return JSON with:
- monetizationModels: 2-5 models (name, description, revenueEstimate optional)
- technicalChallenges: 2-5 challenges (title, severity: low/medium/high)
- summary: 2-3 sentence summary`,
    },
  ], options);
}
