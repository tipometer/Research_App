import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

export type ProviderId = "openai" | "anthropic" | "gemini";

/**
 * Returns a Vercel AI SDK model factory for the given provider, configured with
 * the given API key. The returned function is called with a model name and
 * produces a LanguageModel instance suitable for generateObject/streamObject.
 *
 * Example:
 *   const openai = getProvider("openai", "sk-...");
 *   await generateObject({ model: openai("gpt-4.1-mini"), ... });
 */
export function getProvider(provider: ProviderId, apiKey: string) {
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey });
    case "anthropic":
      return createAnthropic({ apiKey });
    case "gemini":
      return createGoogleGenerativeAI({ apiKey });
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}
