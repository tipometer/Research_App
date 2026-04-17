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
 * The tool key in the `tools` object must be "google_search" per the provider
 * contract; `googleSearch()` takes no arguments in @ai-sdk/google@3.x.
 */
const GOOGLE_SEARCH_TOOL = google.tools.googleSearch({});

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
 * Inlines the 1x Zod/JSON retry pattern.
 *
 * NOTE: Google Gemini does NOT allow `response_mime_type: application/json`
 * (i.e. `output: Output.object(...)`) combined with googleSearch tool use —
 * these are mutually exclusive on the Google API side. We therefore drop the
 * `output:` parameter and instead:
 *   1. Append a JSON shape instruction to the user message.
 *   2. Call generateText with only `tools: { google_search: ... }`.
 *   3. Manually JSON.parse result.text and validate with Zod.
 *   4. Retry once on SyntaxError or ZodError.
 */
async function invokeGrounded<TSchema extends z.ZodSchema>(
  _phase: Phase,
  schema: TSchema,
  messages: ModelMessage[],
  jsonShapeInstruction: string,
  options: { abortSignal?: AbortSignal; deadline?: number } = {},
): Promise<PhaseResult<z.infer<TSchema>>> {
  const { model, client } = await resolvePhase(_phase);
  const modelInstance = client(model);

  const messagesWithJsonHint: ModelMessage[] = [
    ...messages,
    {
      role: "user" as const,
      content: `Return your response as a single JSON object (no prose before or after, no markdown fences) matching this structure:\n${jsonShapeInstruction}`,
    },
  ];

  async function oneCall(extraMessages: ModelMessage[] = []) {
    return generateText({
      model: modelInstance,
      messages: [...messagesWithJsonHint, ...extraMessages],
      tools: { google_search: GOOGLE_SEARCH_TOOL },
      abortSignal: options.abortSignal,
    });
  }

  function parseAndValidate(raw: string): z.infer<TSchema> {
    // Strip any markdown fences or surrounding prose if the model adds them
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const jsonText = jsonMatch ? jsonMatch[0] : raw;
    const parsed = JSON.parse(jsonText);
    return schema.parse(parsed);
  }

  let rawResult: Awaited<ReturnType<typeof oneCall>>;
  let parsed: z.infer<TSchema>;
  try {
    rawResult = await oneCall();
    parsed = parseAndValidate(rawResult.text);
  } catch (err) {
    const isRetryable = err instanceof z.ZodError || err instanceof SyntaxError;
    if (!isRetryable) throw err;
    if (options.deadline && options.deadline - Date.now() < RETRY_RESERVED_MS) throw err;

    const errorDetails =
      err instanceof z.ZodError
        ? err.issues.map(e => `${e.path.join(".") || "(root)"}: ${e.message}`).join("; ")
        : `JSON parse error: ${(err as Error).message}`;

    rawResult = await oneCall([
      {
        role: "user",
        content:
          `Your previous response failed validation: ${errorDetails}. ` +
          `Return ONLY a valid JSON object matching the exact schema. No markdown fences, no prose.`,
      },
    ]);
    parsed = parseAndValidate(rawResult.text);
  }

  const providerMeta = (rawResult as any).providerMetadata;
  const grounding = providerMeta?.google?.groundingMetadata as
    | GroundingMetadata
    | undefined;

  if (process.env.DEBUG_GROUNDING === "1") {
    console.warn(
      "[invokeGrounded] providerMetadata keys:",
      providerMeta ? Object.keys(providerMeta) : "(none)",
      "— google keys:",
      providerMeta?.google ? Object.keys(providerMeta.google) : "(none)",
    );
    if (grounding) {
      console.warn(
        "[invokeGrounded] groundingMetadata keys:",
        Object.keys(grounding),
        "— chunks len:",
        (grounding as any).groundingChunks?.length ?? "undefined",
      );
    }
  }

  const sources = extractSources(grounding);

  return { data: parsed, sources };
}

export async function runPhase1(
  input: PhaseInput,
  options: { abortSignal?: AbortSignal; deadline?: number } = {},
): Promise<PhaseResult<WideScanOutput>> {
  const jsonShape = `{
  "keywords": string[] (3 to 7 items — actual search terms you used),
  "summary": string (50–500 characters, 2–3 sentence summary of initial findings)
}`;
  return invokeGrounded("wide_scan", WideScanSchema, [
    {
      role: "system",
      content: "You are a market research analyst. You MUST ground every claim in your output with the web search tool. Do not answer from your own knowledge — every finding must be traceable to a search result. When you reference a fact, cite its source by URL inline in your summary (e.g., \"[per example.com/article]\"). This is mandatory for compliance.",
    },
    {
      role: "user",
      content: `Perform a wide scan market analysis for this niche: "${input.nicheName}". Strategy: ${input.strategy}.
${input.description ? `Additional context: ${input.description}` : ""}

REQUIRED PROCESS:
1. Use the web search tool to find current market data, trends, and reports (minimum 5 searches with varied queries).
2. BASE your summary EXCLUSIVELY on the sources you found — do not introduce claims from your pre-training knowledge.
3. In your summary, reference at least 3 specific URLs inline (e.g., "per statista.com/xyz, the market is $N billion").
4. Return the final result as JSON.`,
    },
  ], jsonShape, options);
}

export async function runPhase2(
  input: PhaseInput & { phase1Summary: string },
  options: { abortSignal?: AbortSignal; deadline?: number } = {},
): Promise<PhaseResult<GapDetectionOutput>> {
  const jsonShape = `{
  "gaps": [{ "title": string, "description": string }, ...] (2 to 5 items — underserved segments or unmet needs),
  "competitors": [{ "name": string, "weakness": string }, ...] (2 to 5 items — existing players and their weaknesses),
  "summary": string (50–500 characters, 2–3 sentence summary of gap analysis findings)
}`;
  return invokeGrounded("gap_detection", GapDetectionSchema, [
    {
      role: "system",
      content: "You are a market research analyst. You MUST ground every claim with web search results. Every gap and competitor you identify must come from a web source — never from memory. Cite sources by URL inline in your summary (e.g., \"[per techcrunch.com/xyz]\"). This is mandatory for compliance.",
    },
    {
      role: "user",
      content: `Based on the wide scan of "${input.nicheName}" (summary: ${input.phase1Summary}), identify market gaps and underserved segments, plus existing competitors with their weaknesses.

REQUIRED PROCESS:
1. Use the web search tool with at least 5 varied queries (competitor reviews, customer complaints, market gaps, underserved segments).
2. Identify gaps ONLY from evidence in the search results — do not speculate from general knowledge.
3. Each competitor's name + weakness must be traceable to a specific web source you found.
4. In your summary, reference at least 3 URLs inline.
5. Return the result as JSON.`,
    },
  ], jsonShape, options);
}

export async function runPhase3(
  input: PhaseInput & { phase2Summary: string },
  options: { abortSignal?: AbortSignal; deadline?: number } = {},
): Promise<PhaseResult<DeepDivesOutput>> {
  const jsonShape = `{
  "monetizationModels": [{ "name": string, "description": string, "revenueEstimate": string | null }, ...] (2 to 5 items — use null for revenueEstimate when unknown),
  "technicalChallenges": [{ "title": string, "severity": "low" | "medium" | "high" }, ...] (2 to 5 items),
  "summary": string (50–500 characters, 2–3 sentence summary of deep dive findings)
}`;
  return invokeGrounded("deep_dives", DeepDivesSchema, [
    {
      role: "system",
      content: "You are a market research analyst. You MUST ground every claim with web search results. Every monetization model and technical challenge must come from real-world examples found via web search — never from memory. Cite sources by URL inline in your summary (e.g., \"[per crunchbase.com/xyz]\"). This is mandatory for compliance.",
    },
    {
      role: "user",
      content: `Perform deep dives on "${input.nicheName}" (gap analysis: ${input.phase2Summary}) focusing on monetization models, technical feasibility, and market timing.

REQUIRED PROCESS:
1. Use the web search tool with at least 5 varied queries (pricing models, revenue data, technical stack examples, implementation challenges).
2. Monetization examples must be traceable to REAL companies/products found in searches — not hypothetical.
3. Technical challenges must come from engineering blogs, case studies, or industry reports you find.
4. In your summary, reference at least 3 URLs inline.
5. Return the result as JSON.`,
    },
  ], jsonShape, options);
}

/**
 * Phase 4 — Synthesis with progressive streaming via `streamText` + `output`.
 * Partials are emitted via `onPartial` for live UI streaming.
 * The final validated object is obtained from `streamResult.output` (a
 * PromiseLike<InferCompleteOutput<OUTPUT>>) which resolves only after the
 * stream completes — this is reliable in Vercel AI SDK v6 unlike using the
 * last partial emitted from `partialOutputStream`.
 * No retry in C1 — streaming retry is C2 scope.
 */
export async function runPhase4Stream(
  input: { nicheName: string; context: string },
  onPartial: (partial: Partial<SynthesisOutput>) => void,
  options: { abortSignal?: AbortSignal } = {},
): Promise<SynthesisOutput> {
  const { model, client } = await resolvePhase("synthesis");

  const streamResult = streamText({
    model: client(model),
    output: Output.object({ schema: SynthesisSchema }),
    maxOutputTokens: 8192,
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

  // Emit partials for live UI streaming while the stream is in progress
  for await (const partial of streamResult.partialOutputStream) {
    onPartial(partial as Partial<SynthesisOutput>);
  }

  // Use the stream's final output promise — resolves to the fully-validated
  // structured object only after the stream completes successfully (v6 API).
  const final = await streamResult.output;
  const parsed = SynthesisSchema.parse(final);
  // Clamp numeric scores to 0-10 range — the schema can't enforce this because
  // Anthropic's structured output rejects minimum/maximum on number types.
  const clamp = (v: number) => Math.max(0, Math.min(10, v));
  return {
    ...parsed,
    synthesisScore: clamp(parsed.synthesisScore),
    scores: {
      marketSize:   clamp(parsed.scores.marketSize),
      competition:  clamp(parsed.scores.competition),
      feasibility:  clamp(parsed.scores.feasibility),
      monetization: clamp(parsed.scores.monetization),
      timeliness:   clamp(parsed.scores.timeliness),
    },
  };
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

Return JSON: { questions: [{ id, type, text, options: string[] | null }] }
IMPORTANT: For likert and short_text questions, set options to null (not omit it).`,
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
