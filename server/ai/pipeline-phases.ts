import { generateText, streamText, Output, type ModelMessage } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { resolvePhase, type Phase } from "./router";
import { extractSources, type ExtractedSource, type GroundingMetadata } from "./grounding";
import {
  WideScanSchema, type WideScanOutput,
  GapDetectionSchema, type GapDetectionOutput,
  DeepDivesSchema, type DeepDivesOutput,
  SynthesisSchema, type SynthesisOutput,
  PollingSchema, type PollingOutput,
  BrainstormSchema, type BrainstormOutput,
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
      output: Output.object({ schema }),
      tools: { google_search: GOOGLE_SEARCH_TOOL },
      abortSignal: options.abortSignal,
    });
  }

  let rawResult: Awaited<ReturnType<typeof oneCall>>;
  let parsed: z.infer<TSchema>;
  try {
    rawResult = await oneCall();
    parsed = schema.parse(rawResult.output);
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
    parsed = schema.parse(rawResult.output);
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

/**
 * Phase 4 — Synthesis with progressive streaming via `streamText` + `output`.
 * In v6, the last partial emitted from `partialOutputStream` equals the complete
 * validated object (once the stream finishes successfully).
 * No retry in C1 — streaming retry is C2 scope.
 */
export async function runPhase4Stream(
  input: { nicheName: string; context: string },
  onPartial: (partial: Partial<SynthesisOutput>) => void,
  options: { abortSignal?: AbortSignal } = {},
): Promise<SynthesisOutput> {
  const { model, client } = await resolvePhase("synthesis");

  const { partialOutputStream } = streamText({
    model: client(model),
    output: Output.object({ schema: SynthesisSchema }),
    messages: [
      {
        role: "system",
        content: "You are a senior market research analyst. Synthesize all findings into a comprehensive report.",
      },
      {
        role: "user",
        content: `Synthesize research findings for "${input.nicheName}" and produce a final verdict.

Findings context:
${input.context}

Return JSON with:
- verdict: "GO" | "KILL" | "CONDITIONAL"
- synthesisScore: 0-10 (one decimal)
- scores: { marketSize, competition, feasibility, monetization, timeliness } all 0-10
- reportMarkdown: full markdown report MIN 800 WORDS (~4000+ characters) with sections:
  ## Összefoglalás, ## Piaci Lehetőség, ## Versenyhelyzet, ## Megvalósíthatóság, ## Monetizáció, ## Időszerűség, ## Következő Lépések, ## Validációs Kérdések
- verdictReason: 2-3 sentence explanation`,
      },
    ],
    abortSignal: options.abortSignal,
  });

  let lastPartial: Partial<SynthesisOutput> = {};
  for await (const partial of partialOutputStream) {
    lastPartial = partial as Partial<SynthesisOutput>;
    onPartial(lastPartial);
  }
  return SynthesisSchema.parse(lastPartial);
}

/**
 * Polling — generate 3-5 survey questions from a completed research report.
 * Non-grounded (no web search needed). No retry in C1.
 */
export async function runPolling(
  input: { nicheName: string; report: string },
  options: { abortSignal?: AbortSignal } = {},
): Promise<PollingOutput> {
  const { model, client } = await resolvePhase("polling");
  const { output } = await generateText({
    model: client(model),
    output: Output.object({ schema: PollingSchema }),
    messages: [
      {
        role: "system",
        content: "You generate targeted survey questions for market research validation.",
      },
      {
        role: "user",
        content: `Given this research report for "${input.nicheName}":
${input.report.substring(0, 2000)}

Generate 3-5 focused questions to validate the most critical market unknowns (e.g. pricing willingness, feature preferences). Mix question types: single_choice (with options), multiple_choice (with options), likert, short_text.

Return JSON: { questions: [{ id, type, text, options? }] }`,
      },
    ],
    abortSignal: options.abortSignal,
  });
  return PollingSchema.parse(output);
}

/**
 * Brainstorm — generate exactly 10 niche business ideas.
 * Non-grounded. No retry in C1.
 */
export async function runBrainstorm(
  input: { context: string },
  options: { abortSignal?: AbortSignal } = {},
): Promise<BrainstormOutput> {
  const { model, client } = await resolvePhase("brainstorm");
  const { output } = await generateText({
    model: client(model),
    output: Output.object({ schema: BrainstormSchema }),
    messages: [
      {
        role: "system",
        content: "You are a creative market niche ideator. Generate diverse, specific, non-obvious business ideas.",
      },
      {
        role: "user",
        content: `Context: ${input.context}

Generate EXACTLY 10 niche business ideas. Each with: id (kebab-case unique), title (concise), description (max 300 chars, specific target audience + value prop).`,
      },
    ],
    abortSignal: options.abortSignal,
  });
  return BrainstormSchema.parse(output);
}
