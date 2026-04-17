import { generateText, Output } from "ai";
import { z } from "zod";
import type { LanguageModel, ModelMessage } from "ai";

const RETRY_RESERVED_MS = 30_000;

export interface RetryOptions {
  deadline?: number;
}

/**
 * Invokes a Vercel AI SDK v6 generateText call with Zod-validated structured output.
 * Retries once on z.ZodError with the error details embedded in the prompt.
 * Honors a deadline — skips retry if insufficient time remains.
 */
export async function invokeWithRetry<T extends z.ZodTypeAny>(
  model: LanguageModel,
  schema: T,
  messages: ModelMessage[],
  options: RetryOptions = {},
): Promise<z.infer<T>> {
  try {
    const result = await generateText({
      model,
      messages,
      experimental_output: Output.object({ schema }),
    });
    // Be defensive: parse through the schema to guarantee validation
    // even if Output.object validated internally.
    const parsed = schema.parse((result as any).experimental_output);
    return parsed as z.infer<T>;
  } catch (err) {
    if (!(err instanceof z.ZodError)) throw err;

    if (options.deadline) {
      const remaining = options.deadline - Date.now();
      if (remaining < RETRY_RESERVED_MS) throw err;
    }

    // Zod v4 uses .issues (not .errors)
    const errorDetails = err.issues
      .map((e) => `${e.path.join(".") || "(root)"}: ${e.message}`)
      .join("; ");

    const retryResult = await generateText({
      model,
      messages: [
        ...messages,
        {
          role: "user",
          content:
            `Your previous response failed validation with these errors: ${errorDetails}. ` +
            `Return a valid JSON object matching the exact schema. Do not add extra fields.`,
        },
      ],
      experimental_output: Output.object({ schema }),
    });
    const parsed = schema.parse((retryResult as any).experimental_output);
    return parsed as z.infer<T>;
  }
}
