// server/ai/sanitize.ts

export const DELIMS = {
  user_input:          ["<user_input>",          "</user_input>"],
  admin_system_prompt: ["<admin_system_prompt>", "</admin_system_prompt>"],
  phase_summary:       ["<phase_summary>",       "</phase_summary>"],
  grounded_snippet:    ["<grounded_snippet>",    "</grounded_snippet>"],
} as const;

const ALL_DELIMITER_TOKENS = [
  "<user_input>", "</user_input>",
  "<admin_system_prompt>", "</admin_system_prompt>",
  "<phase_summary>", "</phase_summary>",
  "<grounded_snippet>", "</grounded_snippet>",
];

// Strip control chars, null bytes, and ANSI escape sequences
const STRIP_REGEX = /\x1b\[[0-9;]*[a-zA-Z]|[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

const INJECTION_KEYWORDS: RegExp[] = [
  /\bignore\s+(previous|prior|above|all)\s+(instructions?|rules?|prompts?)\b/i,
  /\b(system|assistant|user)\s*[:>]\s*/i,
  /###\s*SYSTEM\s*###/i,
  /<(user_input|system_prompt|grounded_content|admin_system_prompt)\b[^>]*>.*?<\/\1\s*>/i,
  /<\/?(user_input|system_prompt|grounded_content|admin_system_prompt)\b[^>]*>/i,
  /\bnew\s+task\s*:\s*/i,
  /\bforget\s+(everything|all|previous)\b/i,
  /\bact\s+as\s+(a\s+)?(?:different|new|another)\b/i,
  /\byou\s+are\s+now\s+/i,
  /\bpretend\s+(you\s+are|to\s+be)\b/i,
  /\bjailbreak\b/i,
  /\bDAN\b/,
];

export interface SanitizeContext {
  field: string;
  userId?: number;
}

export function sanitizeUserInput(raw: string, ctx: SanitizeContext): string {
  let cleaned = raw;

  const lenBefore = cleaned.length;
  cleaned = cleaned.replace(STRIP_REGEX, "");
  if (cleaned.length !== lenBefore) {
    console.warn(`[sanitize] ${ctx.field} stripped ${lenBefore - cleaned.length} control chars. userId=${ctx.userId ?? "anon"}`);
  }

  // Strip injection keywords first, which includes delimiter-like patterns
  for (const pattern of INJECTION_KEYWORDS) {
    if (pattern.test(cleaned)) {
      console.warn(`[sanitize] ${ctx.field} matched pattern ${pattern.source}. userId=${ctx.userId ?? "anon"}. Snippet: ${JSON.stringify(cleaned.slice(0, 200))}`);
      cleaned = cleaned.replace(pattern, "");
    }
  }

  // Then strip all delimiter tokens (cross-escape prevention)
  for (const token of ALL_DELIMITER_TOKENS) {
    cleaned = cleaned.replaceAll(token, "");
  }

  const [open, close] = DELIMS.user_input;
  return `${open}\n${cleaned.trim()}\n${close}`;
}

export function wrapIndirect(content: string, kind: "summary" | "snippet"): string {
  const [open, close] = kind === "summary" ? DELIMS.phase_summary : DELIMS.grounded_snippet;
  let cleaned = content;
  for (const token of ALL_DELIMITER_TOKENS) {
    cleaned = cleaned.replaceAll(token, "");
  }
  return `${open}\n${cleaned}\n${close}`;
}

export function escapeTitle(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .trim();
}

export function escapeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.href;
  } catch {
    return "";
  }
}
