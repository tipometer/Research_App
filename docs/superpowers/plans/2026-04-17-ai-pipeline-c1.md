# AI Pipeline Migration (C1 Sprint) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec reference:** [docs/superpowers/specs/2026-04-17-ai-pipeline-c1-design.md](../specs/2026-04-17-ai-pipeline-c1-design.md)

**Goal:** Migrate the Deep Research app's AI pipeline from the Manus Forge proxy (`_core/llm.ts` `invokeLLM`) to direct provider SDKs via Vercel AI SDK, with Gemini Search Grounding on phases 1–3, admin-configurable routing (DB-first / ENV fallback), and `streamObject`-based progressive streaming for Synthesis (phase 4).

**Architecture:**
- New `server/ai/` module with 7 focused files: `schemas.ts` (Zod), `classify.ts` (domain heuristic), `grounding.ts` (Gemini extraction), `providers.ts` (SDK factory), `router.ts` (DB→ENV lookup), `seed.ts` (idempotent default seeding), `pipeline-phases.ts` (per-phase invocation logic).
- `research-pipeline.ts` refactored to use the new router; SSE event shape extended with a `synthesis_progress` event for progressive streaming.
- Admin tRPC procedures activated to write `aiConfigs` / `modelRouting` tables; AdminPanel UI wired to these live procedures.
- Existing `_core/llm.ts` deleted (hard delete, no deprecated alias).

**Tech Stack:**
- Vercel AI SDK v5 (`ai` package + `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`)
- Zod v4 (already installed) for schema validation
- Drizzle ORM (already installed) for DB reads/writes
- Vitest (already configured) for unit tests
- SSE (Server-Sent Events) for real-time pipeline streaming
- tRPC v11 (already installed) for admin procedures

**C1 scope is NOT:** fallback model logic (C2), AES-256-GCM API key encryption (C2), prompt injection sanitization (C2), Manus OAuth replacement (separate sub-project), Stripe/Számlázz.hu integration (separate sub-project).

---

## Pre-work: Worktree Setup (Recommended)

Before starting, create an isolated git worktree so this sprint's work doesn't collide with other changes:

```bash
cd /Users/balintkovacs/Work/ClaudeCode/Research_App/repo
git worktree add ../repo-c1-ai-pipeline main
cd ../repo-c1-ai-pipeline
git checkout -b feat/c1-ai-pipeline-migration
```

All tasks below assume you're working in this worktree.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/ai/schemas.ts` | Zod schemas per phase (WideScan, GapDetection, DeepDives, Synthesis, Polling, Brainstorm) — NO `sources` in grounded phase schemas |
| `server/ai/classify.ts` | `classifyDomain(url): SourceType` — domain → academic/industry/news/blog/community heuristic |
| `server/ai/grounding.ts` | `extractOriginalUrl()` + `extractSources()` — Gemini groundingMetadata → ExtractedSource[] |
| `server/ai/providers.ts` | Vercel AI SDK provider factories (`getOpenAI`, `getAnthropic`, `getGemini`) taking API key from caller |
| `server/ai/router.ts` | `lookupModel(phase)`, `detectProvider(modelName)`, `lookupApiKey(provider)`, `invoke(phase, messages, { schema, grounding })` |
| `server/ai/seed.ts` | `seedModelRouting()` — idempotent default seeding for `modelRouting` table |
| `server/ai/pipeline-phases.ts` | `runPhase1()` … `runPhase4()` + `runPolling()` + `runBrainstorm()` — per-phase AI invocation logic |
| `server/research-pipeline.ts` | REFACTOR: SSE + DB write orchestration (keep); AI invocation moved to `pipeline-phases.ts` |
| `server/routers.ts` | MODIFY: admin AI tRPC procedures; replace `invokeLLM` in polling + brainstorm procedures |
| `server/_core/llm.ts` | **DELETE** |
| `client/src/pages/AdminPanel.tsx` | MODIFY: wire AI Config tab to live admin tRPC procedures |
| `client/src/pages/ResearchReport.tsx` | MODIFY: "Dátum ismeretlen" fallback when `publishedAt IS NULL` |
| `client/src/pages/ResearchProgress.tsx` | MODIFY: handle new `synthesis_progress` SSE event |
| `client/src/i18n/hu.ts` + `en.ts` | MODIFY: add `report.sources.unknownDate` + error state keys |
| `package.json` | MODIFY: add deps (`ai`, `@ai-sdk/*`) + scripts (`db:seed`, `test:integration`) |
| `server/deep-research.test.ts` | MODIFY: update 17 existing tests to mock `llmRouter.invoke` instead of `invokeLLM` |
| `server/ai/*.test.ts` | CREATE: unit tests per file (co-located) |
| `server/ai/*.integration.test.ts` | CREATE: opt-in integration tests (real provider calls) |

---

## Task 0: Dependencies and Scaffolding

**Files:**
- Modify: `package.json`
- Create: `server/ai/` directory

- [ ] **Step 1: Install Vercel AI SDK packages**

```bash
cd /Users/balintkovacs/Work/ClaudeCode/Research_App/repo-c1-ai-pipeline
pnpm add ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google
```

Expected: 4 packages added to `dependencies` in `package.json`; pnpm-lock.yaml updated.

- [ ] **Step 2: Verify no version conflicts**

Run: `pnpm check`
Expected: PASS (0 TypeScript errors) or at most existing errors unchanged.

- [ ] **Step 3: Add `db:seed` and `test:integration` scripts to package.json**

Edit `package.json` scripts section:

```json
"scripts": {
  "dev": "NODE_ENV=development tsx watch server/_core/index.ts",
  "build": "vite build && esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist",
  "start": "NODE_ENV=production node dist/index.js",
  "check": "tsc --noEmit",
  "format": "prettier --write .",
  "test": "vitest run",
  "test:integration": "RUN_INTEGRATION_TESTS=1 vitest run --config vitest.integration.config.ts",
  "db:push": "drizzle-kit generate && drizzle-kit migrate",
  "db:seed": "tsx server/ai/seed.ts"
}
```

- [ ] **Step 4: Create `vitest.integration.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.integration.test.ts"],
    testTimeout: 300_000, // 5 minutes for real provider calls
  },
});
```

- [ ] **Step 5: Create `server/ai/` directory placeholder**

```bash
mkdir -p server/ai
touch server/ai/.gitkeep
```

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.integration.config.ts server/ai/.gitkeep
git commit -m "chore: add Vercel AI SDK deps and scaffold server/ai module"
```

---

## Task 1: Zod Schemas (`server/ai/schemas.ts`)

**Files:**
- Create: `server/ai/schemas.ts`
- Test: `server/ai/schemas.test.ts`

- [ ] **Step 1: Write failing tests for all 6 schemas**

Create `server/ai/schemas.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  WideScanSchema,
  GapDetectionSchema,
  DeepDivesSchema,
  SynthesisSchema,
  PollingSchema,
  BrainstormSchema,
} from "./schemas";

describe("WideScanSchema", () => {
  it("accepts valid input", () => {
    const valid = {
      keywords: ["ai", "research", "market"],
      summary: "A".repeat(100),
    };
    expect(WideScanSchema.parse(valid)).toEqual(valid);
  });
  it("rejects fewer than 3 keywords", () => {
    expect(() => WideScanSchema.parse({ keywords: ["a", "b"], summary: "x".repeat(60) })).toThrow();
  });
  it("rejects summary shorter than 50 chars", () => {
    expect(() => WideScanSchema.parse({ keywords: ["a", "b", "c"], summary: "short" })).toThrow();
  });
  it("does NOT allow a `sources` field", () => {
    const withSources = { keywords: ["a", "b", "c"], summary: "x".repeat(60), sources: [] };
    // Zod strips unknown fields by default — verify `sources` is NOT in parsed output
    const result = WideScanSchema.parse(withSources);
    expect("sources" in result).toBe(false);
  });
});

describe("GapDetectionSchema", () => {
  it("accepts valid input", () => {
    const valid = {
      gaps: [{ title: "gap1", description: "desc1" }, { title: "gap2", description: "desc2" }],
      competitors: [{ name: "c1", weakness: "w1" }, { name: "c2", weakness: "w2" }],
      summary: "x".repeat(60),
    };
    expect(GapDetectionSchema.parse(valid)).toEqual(valid);
  });
  it("rejects less than 2 gaps", () => {
    expect(() => GapDetectionSchema.parse({
      gaps: [{ title: "g", description: "d" }],
      competitors: [{ name: "c1", weakness: "w1" }, { name: "c2", weakness: "w2" }],
      summary: "x".repeat(60),
    })).toThrow();
  });
});

describe("DeepDivesSchema", () => {
  it("accepts valid input with optional revenueEstimate", () => {
    const valid = {
      monetizationModels: [
        { name: "m1", description: "d1" },
        { name: "m2", description: "d2", revenueEstimate: "$10k/mo" },
      ],
      technicalChallenges: [
        { title: "t1", severity: "low" as const },
        { title: "t2", severity: "high" as const },
      ],
      summary: "x".repeat(60),
    };
    expect(DeepDivesSchema.parse(valid)).toEqual(valid);
  });
  it("rejects invalid severity", () => {
    expect(() => DeepDivesSchema.parse({
      monetizationModels: [{ name: "m1", description: "d1" }, { name: "m2", description: "d2" }],
      technicalChallenges: [{ title: "t", severity: "critical" }],
      summary: "x".repeat(60),
    })).toThrow();
  });
});

describe("SynthesisSchema", () => {
  it("accepts valid input with full markdown", () => {
    const valid = {
      verdict: "GO" as const,
      synthesisScore: 7.5,
      scores: {
        marketSize: 8.0, competition: 6.5, feasibility: 7.0,
        monetization: 7.5, timeliness: 8.5,
      },
      reportMarkdown: "x".repeat(4500),
      verdictReason: "x".repeat(100),
    };
    expect(SynthesisSchema.parse(valid)).toEqual(valid);
  });
  it("rejects reportMarkdown shorter than 4000 chars", () => {
    expect(() => SynthesisSchema.parse({
      verdict: "GO",
      synthesisScore: 7.5,
      scores: { marketSize: 8, competition: 6, feasibility: 7, monetization: 7, timeliness: 8 },
      reportMarkdown: "x".repeat(3000),
      verdictReason: "x".repeat(100),
    })).toThrow();
  });
  it("rejects score out of 0-10 range", () => {
    expect(() => SynthesisSchema.parse({
      verdict: "GO",
      synthesisScore: 7.5,
      scores: { marketSize: 11, competition: 6, feasibility: 7, monetization: 7, timeliness: 8 },
      reportMarkdown: "x".repeat(4500),
      verdictReason: "x".repeat(100),
    })).toThrow();
  });
  it("rejects invalid verdict", () => {
    expect(() => SynthesisSchema.parse({
      verdict: "MAYBE",
      synthesisScore: 7.5,
      scores: { marketSize: 8, competition: 6, feasibility: 7, monetization: 7, timeliness: 8 },
      reportMarkdown: "x".repeat(4500),
      verdictReason: "x".repeat(100),
    })).toThrow();
  });
});

describe("PollingSchema", () => {
  it("accepts 3-5 questions", () => {
    const valid = {
      questions: [
        { id: "q1", type: "single_choice" as const, text: "Q1?", options: ["a", "b"] },
        { id: "q2", type: "likert" as const, text: "Q2?" },
        { id: "q3", type: "short_text" as const, text: "Q3?" },
      ],
    };
    expect(PollingSchema.parse(valid)).toEqual(valid);
  });
  it("rejects more than 5 questions", () => {
    const invalid = {
      questions: Array(6).fill({ id: "q", type: "short_text", text: "Q?" }),
    };
    expect(() => PollingSchema.parse(invalid)).toThrow();
  });
});

describe("BrainstormSchema", () => {
  it("accepts exactly 10 ideas", () => {
    const valid = {
      ideas: Array(10).fill(null).map((_, i) => ({
        id: `idea-${i}`,
        title: `Idea ${i}`,
        description: `Description ${i}`.repeat(5),
      })),
    };
    expect(BrainstormSchema.parse(valid)).toEqual(valid);
  });
  it("rejects 9 ideas", () => {
    const invalid = {
      ideas: Array(9).fill(null).map((_, i) => ({
        id: `idea-${i}`, title: `Idea ${i}`, description: "d",
      })),
    };
    expect(() => BrainstormSchema.parse(invalid)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test server/ai/schemas.test.ts`
Expected: FAIL (cannot find module './schemas')

- [ ] **Step 3: Implement `server/ai/schemas.ts`**

```typescript
import { z } from "zod";

export const WideScanSchema = z.object({
  keywords: z.array(z.string()).min(3).max(7),
  summary: z.string().min(50).max(500),
});
export type WideScanOutput = z.infer<typeof WideScanSchema>;

export const GapDetectionSchema = z.object({
  gaps: z.array(z.object({
    title: z.string(),
    description: z.string(),
  })).min(2).max(5),
  competitors: z.array(z.object({
    name: z.string(),
    weakness: z.string(),
  })).min(2).max(5),
  summary: z.string().min(50).max(500),
});
export type GapDetectionOutput = z.infer<typeof GapDetectionSchema>;

export const DeepDivesSchema = z.object({
  monetizationModels: z.array(z.object({
    name: z.string(),
    description: z.string(),
    revenueEstimate: z.string().optional(),
  })).min(2).max(5),
  technicalChallenges: z.array(z.object({
    title: z.string(),
    severity: z.enum(["low", "medium", "high"]),
  })).min(2).max(5),
  summary: z.string().min(50).max(500),
});
export type DeepDivesOutput = z.infer<typeof DeepDivesSchema>;

export const SynthesisSchema = z.object({
  verdict: z.enum(["GO", "KILL", "CONDITIONAL"]),
  synthesisScore: z.number().min(0).max(10),
  scores: z.object({
    marketSize:   z.number().min(0).max(10),
    competition:  z.number().min(0).max(10),
    feasibility:  z.number().min(0).max(10),
    monetization: z.number().min(0).max(10),
    timeliness:   z.number().min(0).max(10),
  }),
  reportMarkdown: z.string().min(4000),  // ~800 szó
  verdictReason: z.string().min(50).max(500),
});
export type SynthesisOutput = z.infer<typeof SynthesisSchema>;

export const PollingSchema = z.object({
  questions: z.array(z.object({
    id: z.string(),
    type: z.enum(["single_choice", "multiple_choice", "likert", "short_text"]),
    text: z.string(),
    options: z.array(z.string()).optional(),
  })).min(3).max(5),
});
export type PollingOutput = z.infer<typeof PollingSchema>;

export const BrainstormSchema = z.object({
  ideas: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().max(300),
  })).length(10),
});
export type BrainstormOutput = z.infer<typeof BrainstormSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test server/ai/schemas.test.ts`
Expected: PASS (all schema tests green)

- [ ] **Step 5: Commit**

```bash
git add server/ai/schemas.ts server/ai/schemas.test.ts
git commit -m "feat(ai): add Zod schemas for all 6 pipeline phases"
```

---

## Task 2: Source Classification (`server/ai/classify.ts`)

**Files:**
- Create: `server/ai/classify.ts`
- Test: `server/ai/classify.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { classifyDomain } from "./classify";

describe("classifyDomain", () => {
  it("classifies .edu as academic", () => {
    expect(classifyDomain("https://stanford.edu/research/paper")).toBe("academic");
  });
  it("classifies .ac.uk as academic", () => {
    expect(classifyDomain("https://ox.ac.uk/article")).toBe("academic");
  });
  it("classifies arxiv as academic", () => {
    expect(classifyDomain("https://arxiv.org/abs/2301.12345")).toBe("academic");
  });
  it("classifies reuters as news", () => {
    expect(classifyDomain("https://www.reuters.com/tech/article")).toBe("news");
  });
  it("classifies techcrunch as news", () => {
    expect(classifyDomain("https://techcrunch.com/startup-news")).toBe("news");
  });
  it("classifies reddit as community", () => {
    expect(classifyDomain("https://www.reddit.com/r/startups")).toBe("community");
  });
  it("classifies hackernews as community", () => {
    expect(classifyDomain("https://news.ycombinator.com/item?id=123")).toBe("community");
  });
  it("classifies gartner as industry", () => {
    expect(classifyDomain("https://www.gartner.com/report")).toBe("industry");
  });
  it("classifies statista as industry", () => {
    expect(classifyDomain("https://www.statista.com/chart")).toBe("industry");
  });
  it("defaults to blog for unknown domain", () => {
    expect(classifyDomain("https://somerandomblog.example.com/post")).toBe("blog");
  });
  it("returns blog for invalid URL", () => {
    expect(classifyDomain("not a url")).toBe("blog");
  });
  it("handles URLs without protocol", () => {
    expect(classifyDomain("stanford.edu/research")).toBe("blog"); // no protocol → URL parsing fails
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test server/ai/classify.test.ts`
Expected: FAIL (cannot find module './classify')

- [ ] **Step 3: Implement `classify.ts`**

```typescript
export type SourceType = "academic" | "industry" | "news" | "blog" | "community";

const ACADEMIC_TLDS = [".edu", ".ac.uk", ".ac.hu"];
const ACADEMIC_DOMAINS = [
  "scholar.google.com",
  "pubmed.ncbi.nlm.nih.gov",
  "arxiv.org",
  "researchgate.net",
];

const NEWS_DOMAINS = [
  "bbc.com", "reuters.com", "techcrunch.com", "forbes.com",
  "bloomberg.com", "wsj.com", "ft.com", "nytimes.com",
  "theguardian.com", "cnn.com", "theverge.com", "arstechnica.com",
];

const COMMUNITY_DOMAINS = [
  "reddit.com", "quora.com", "stackoverflow.com",
  "producthunt.com", "news.ycombinator.com", "medium.com",
];

const INDUSTRY_DOMAINS = [
  "gartner.com", "mckinsey.com", "statista.com",
  "crunchbase.com", "pitchbook.com", "forrester.com",
  "idc.com", "deloitte.com", "kpmg.com", "pwc.com",
];

function safeParseHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function classifyDomain(url: string): SourceType {
  const host = safeParseHost(url);
  if (!host) return "blog";

  if (ACADEMIC_TLDS.some(tld => host.endsWith(tld))) return "academic";
  if (ACADEMIC_DOMAINS.some(d => host === d || host.endsWith(`.${d}`))) return "academic";
  if (NEWS_DOMAINS.some(d => host === d || host.endsWith(`.${d}`))) return "news";
  if (COMMUNITY_DOMAINS.some(d => host === d || host.endsWith(`.${d}`))) return "community";
  if (INDUSTRY_DOMAINS.some(d => host === d || host.endsWith(`.${d}`))) return "industry";
  return "blog";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test server/ai/classify.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/ai/classify.ts server/ai/classify.test.ts
git commit -m "feat(ai): add domain-based source classifier"
```

---

## Task 3: Gemini Grounding Extraction (`server/ai/grounding.ts`)

**Files:**
- Create: `server/ai/grounding.ts`
- Test: `server/ai/grounding.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { extractOriginalUrl, extractSources, type GroundingMetadata } from "./grounding";

describe("extractOriginalUrl", () => {
  it("decodes base64-encoded redirect payload", () => {
    const original = "https://example.com/article";
    const encoded = Buffer.from(original, "utf-8").toString("base64");
    const redirect = `https://vertexaisearch.cloud.google.com/grounding-api-redirect/${encoded}`;
    expect(extractOriginalUrl(redirect)).toBe(original);
  });
  it("falls back to raw URL when base64 decode fails", () => {
    const signedToken = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc.def.ghi";
    // Not valid base64 → returned as-is
    expect(extractOriginalUrl(signedToken)).toBe(signedToken);
  });
  it("falls back when decoded result is not a URL", () => {
    const garbage = Buffer.from("not-a-url", "utf-8").toString("base64");
    const redirect = `https://vertexaisearch.cloud.google.com/grounding-api-redirect/${garbage}`;
    expect(extractOriginalUrl(redirect)).toBe(redirect);
  });
  it("returns plain URL unchanged if no redirect prefix", () => {
    const url = "https://example.com/article";
    expect(extractOriginalUrl(url)).toBe(url);
  });
  it("handles percent-encoded decoded URL", () => {
    const original = "https://example.com/article?q=hello world";
    const encoded = Buffer.from(encodeURIComponent(original), "utf-8").toString("base64");
    const redirect = `https://vertexaisearch.cloud.google.com/grounding-api-redirect/${encoded}`;
    expect(extractOriginalUrl(redirect)).toBe(original);
  });
});

describe("extractSources", () => {
  it("maps groundingChunks to ExtractedSource with aggregated snippets", () => {
    const metadata: GroundingMetadata = {
      groundingChunks: [
        { web: { uri: "https://example.com/a", title: "Article A" } },
        { web: { uri: "https://stanford.edu/paper", title: "Paper B" } },
      ],
      groundingSupports: [
        {
          segment: { text: "First finding", startIndex: 0, endIndex: 13 },
          groundingChunkIndices: [0],
        },
        {
          segment: { text: "Second finding", startIndex: 20, endIndex: 34 },
          groundingChunkIndices: [0, 1],
        },
      ],
      webSearchQueries: ["q1"],
    };
    const result = extractSources(metadata);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      url: "https://example.com/a",
      title: "Article A",
      snippet: "First finding … Second finding",
      sourceType: "blog", // example.com is unknown → default
      publishedAt: null,
    });
    expect(result[1].url).toBe("https://stanford.edu/paper");
    expect(result[1].sourceType).toBe("academic");
    expect(result[1].snippet).toBe("Second finding");
    expect(result[1].publishedAt).toBeNull();
  });

  it("returns empty array when no chunks", () => {
    const metadata: GroundingMetadata = {
      groundingChunks: [],
      groundingSupports: [],
      webSearchQueries: [],
    };
    expect(extractSources(metadata)).toEqual([]);
  });

  it("handles chunks with no supporting segments", () => {
    const metadata: GroundingMetadata = {
      groundingChunks: [{ web: { uri: "https://example.com", title: "A" } }],
      groundingSupports: [],
      webSearchQueries: [],
    };
    const result = extractSources(metadata);
    expect(result[0].snippet).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test server/ai/grounding.test.ts`
Expected: FAIL (cannot find module './grounding')

- [ ] **Step 3: Implement `grounding.ts`**

```typescript
import { classifyDomain, type SourceType } from "./classify";

export interface GroundingMetadata {
  groundingChunks: Array<{ web: { uri: string; title: string } }>;
  groundingSupports: Array<{
    segment: { text: string; startIndex: number; endIndex: number };
    groundingChunkIndices: number[];
  }>;
  webSearchQueries: string[];
}

export interface ExtractedSource {
  url: string;
  title: string;
  snippet: string;
  sourceType: SourceType;
  publishedAt: null; // C1: always null (Gemini doesn't provide date)
}

export function extractOriginalUrl(redirectUrl: string): string {
  const match = redirectUrl.match(/grounding-api-redirect\/(.+)/);
  if (match) {
    try {
      let decoded = Buffer.from(match[1], "base64").toString("utf-8");
      if (decoded.includes("%")) {
        try { decoded = decodeURIComponent(decoded); } catch { /* stay as-is */ }
      }
      if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
        return decoded;
      }
    } catch {
      // base64 decode failed — signed token, fall through
    }
  }
  return redirectUrl;
}

export function extractSources(metadata: GroundingMetadata): ExtractedSource[] {
  return metadata.groundingChunks.map((chunk, idx) => ({
    url: extractOriginalUrl(chunk.web.uri),
    title: chunk.web.title,
    snippet: metadata.groundingSupports
      .filter(s => s.groundingChunkIndices.includes(idx))
      .map(s => s.segment.text)
      .join(" … "),
    sourceType: classifyDomain(extractOriginalUrl(chunk.web.uri)),
    publishedAt: null,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test server/ai/grounding.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/ai/grounding.ts server/ai/grounding.test.ts
git commit -m "feat(ai): add Gemini groundingMetadata extractor with redirect URL parsing"
```

---

## Task 4: Provider Factory (`server/ai/providers.ts`)

**Files:**
- Create: `server/ai/providers.ts`
- Test: `server/ai/providers.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { getProvider, type ProviderId } from "./providers";

describe("getProvider", () => {
  it("returns OpenAI provider for 'openai'", () => {
    const p = getProvider("openai", "sk-test");
    expect(typeof p).toBe("function");
  });
  it("returns Anthropic provider for 'anthropic'", () => {
    const p = getProvider("anthropic", "sk-ant-test");
    expect(typeof p).toBe("function");
  });
  it("returns Gemini provider for 'gemini'", () => {
    const p = getProvider("gemini", "AIza-test");
    expect(typeof p).toBe("function");
  });
  it("throws for unknown provider", () => {
    // @ts-expect-error — intentionally passing invalid id
    expect(() => getProvider("unknown" as ProviderId, "key")).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test server/ai/providers.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `providers.ts`**

```typescript
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

export type ProviderId = "openai" | "anthropic" | "gemini";

/**
 * Returns a Vercel AI SDK model factory for the given provider, configured with
 * the given API key. The returned function is called with a model name and
 * produces a LanguageModelV1 instance suitable for generateObject/streamObject.
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test server/ai/providers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/ai/providers.ts server/ai/providers.test.ts
git commit -m "feat(ai): add Vercel AI SDK provider factory (openai/anthropic/gemini)"
```

---

## Task 5: Router (`server/ai/router.ts`)

**Files:**
- Create: `server/ai/router.ts`
- Test: `server/ai/router.test.ts`

This task implements the DB-first / ENV fallback routing logic described in spec §4.

- [ ] **Step 1: Write failing tests for pure functions**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { detectProvider } from "./router";

describe("detectProvider", () => {
  it("returns 'gemini' for gemini-* models", () => {
    expect(detectProvider("gemini-2.5-flash")).toBe("gemini");
    expect(detectProvider("gemini-2.5-pro")).toBe("gemini");
  });
  it("returns 'openai' for gpt-* / o3-* / o4-* models", () => {
    expect(detectProvider("gpt-4.1-mini")).toBe("openai");
    expect(detectProvider("gpt-4.1")).toBe("openai");
    expect(detectProvider("o3-mini")).toBe("openai");
    expect(detectProvider("o4-mini-2025-04-16")).toBe("openai");
  });
  it("returns 'anthropic' for claude-* models", () => {
    expect(detectProvider("claude-sonnet-4-6")).toBe("anthropic");
    expect(detectProvider("claude-opus-4-7")).toBe("anthropic");
  });
  it("throws for unknown model prefix", () => {
    expect(() => detectProvider("llama-3")).toThrow(/Unknown provider/);
    expect(() => detectProvider("")).toThrow();
  });
});
```

Then add failing tests for `lookupModel` and `lookupApiKey`, mocking the DB:

```typescript
import { lookupModel, lookupApiKey } from "./router";

// Mock the db module
vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../db";

describe("lookupModel", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { delete process.env.DEFAULT_MODEL_WIDE_SCAN; });

  it("returns DB value when modelRouting row exists", async () => {
    (getDb as any).mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ primaryModel: "gemini-2.5-pro" }],
          }),
        }),
      }),
    });
    expect(await lookupModel("wide_scan")).toBe("gemini-2.5-pro");
  });

  it("falls back to ENV when DB row missing", async () => {
    process.env.DEFAULT_MODEL_WIDE_SCAN = "gemini-2.5-flash";
    (getDb as any).mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [] }),
        }),
      }),
    });
    expect(await lookupModel("wide_scan")).toBe("gemini-2.5-flash");
  });

  it("throws when DB empty AND ENV missing", async () => {
    (getDb as any).mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [] }),
        }),
      }),
    });
    await expect(lookupModel("wide_scan")).rejects.toThrow(/No model configured/);
  });
});

describe("lookupApiKey", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("returns DB value when aiConfig active row exists", async () => {
    (getDb as any).mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [{ apiKey: "sk-from-db" }] }),
        }),
      }),
    });
    expect(await lookupApiKey("openai")).toBe("sk-from-db");
  });

  it("falls back to ENV when DB row missing", async () => {
    process.env.OPENAI_API_KEY = "sk-from-env";
    (getDb as any).mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [] }),
        }),
      }),
    });
    expect(await lookupApiKey("openai")).toBe("sk-from-env");
  });

  it("throws when no key in DB and no ENV var", async () => {
    (getDb as any).mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [] }),
        }),
      }),
    });
    await expect(lookupApiKey("openai")).rejects.toThrow(/No API key configured/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test server/ai/router.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `router.ts`**

```typescript
import { and, eq } from "drizzle-orm";
import { aiConfigs, modelRouting } from "../../drizzle/schema";
import { getDb } from "../db";
import { getProvider, type ProviderId } from "./providers";

export type Phase = "wide_scan" | "gap_detection" | "deep_dives" | "synthesis" | "polling" | "brainstorm";

const HARDCODED_DEFAULTS: Record<Phase, string> = {
  wide_scan: "gemini-2.5-flash",
  gap_detection: "gemini-2.5-flash",
  deep_dives: "gemini-2.5-flash",
  synthesis: "claude-sonnet-4-6",
  polling: "gpt-4.1-mini",
  brainstorm: "gpt-4.1-mini",
};

export function detectProvider(modelName: string): ProviderId {
  if (modelName.startsWith("gemini-")) return "gemini";
  if (modelName.startsWith("gpt-") || modelName.startsWith("o3-") || modelName.startsWith("o4-")) return "openai";
  if (modelName.startsWith("claude-")) return "anthropic";
  throw new Error(`Unknown provider for model: ${modelName}`);
}

export async function lookupModel(phase: Phase): Promise<string> {
  const db = await getDb();
  if (db) {
    const rows = await db
      .select({ primaryModel: modelRouting.primaryModel })
      .from(modelRouting)
      .where(eq(modelRouting.phase, phase))
      .limit(1);
    if (rows.length > 0 && rows[0].primaryModel) return rows[0].primaryModel;
  }
  const envKey = `DEFAULT_MODEL_${phase.toUpperCase()}`;
  const envValue = process.env[envKey];
  if (envValue) return envValue;
  const fallback = HARDCODED_DEFAULTS[phase];
  if (fallback) return fallback;
  throw new Error(`No model configured for phase: ${phase}`);
}

export async function lookupApiKey(provider: ProviderId): Promise<string> {
  const db = await getDb();
  if (db) {
    const rows = await db
      .select({ apiKey: aiConfigs.apiKey })
      .from(aiConfigs)
      .where(and(eq(aiConfigs.provider, provider), eq(aiConfigs.isActive, true)))
      .limit(1);
    if (rows.length > 0 && rows[0].apiKey) return rows[0].apiKey;
  }
  const envKey = `${provider.toUpperCase()}_API_KEY`;
  const envValue = process.env[envKey];
  if (envValue) return envValue;
  throw new Error(`No API key configured for provider: ${provider}`);
}

/**
 * Resolves (model, provider, apiKey, providerClient) for a given phase.
 * Used by pipeline-phases.ts to obtain a ready-to-call SDK instance.
 */
export async function resolvePhase(phase: Phase): Promise<{
  model: string;
  provider: ProviderId;
  client: ReturnType<typeof getProvider>;
}> {
  const model = await lookupModel(phase);
  const provider = detectProvider(model);
  const apiKey = await lookupApiKey(provider);
  const client = getProvider(provider, apiKey);
  return { model, provider, client };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test server/ai/router.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/ai/router.ts server/ai/router.test.ts
git commit -m "feat(ai): add phase→model→provider→key router with DB-first ENV fallback"
```

---

## Task 6: Model Routing Seed (`server/ai/seed.ts`)

**Files:**
- Create: `server/ai/seed.ts`
- Test: `server/ai/seed.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { seedModelRouting } from "./seed";

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../db";

describe("seedModelRouting", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("inserts defaults when table is empty", async () => {
    const insertMock = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    (getDb as any).mockResolvedValue({
      select: () => ({ from: () => ({ limit: async () => [] }) }),
      insert: insertMock,
    });
    await seedModelRouting();
    expect(insertMock).toHaveBeenCalledOnce();
  });

  it("does nothing when table already has rows (idempotent)", async () => {
    const insertMock = vi.fn();
    (getDb as any).mockResolvedValue({
      select: () => ({ from: () => ({ limit: async () => [{ id: 1 }] }) }),
      insert: insertMock,
    });
    await seedModelRouting();
    expect(insertMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test server/ai/seed.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `seed.ts`**

```typescript
import { modelRouting } from "../../drizzle/schema";
import { getDb } from "../db";

/**
 * Idempotently seeds the modelRouting table with C1 defaults.
 *
 * IMPORTANT: the model names below are FAMILY names as of 2026-04-17.
 * For production, replace with the EXACT versioned API IDs from provider docs:
 *   - Anthropic:  claude-sonnet-4-6-YYYYMMDD     (e.g. claude-sonnet-4-6-20251001)
 *   - OpenAI:     gpt-4.1-mini-YYYY-MM-DD        (e.g. gpt-4.1-mini-2025-04-14)
 *   - Google:     gemini-2.5-flash                (family name usually OK)
 *
 * Update this comment with the date these IDs were confirmed from provider docs.
 * Admin UI "Model Routing" tab overrides these at runtime — seed is only the
 * first-deploy default.
 */
const DEFAULTS = [
  { phase: "wide_scan" as const,     primaryModel: "gemini-2.5-flash" },
  { phase: "gap_detection" as const, primaryModel: "gemini-2.5-flash" },
  { phase: "deep_dives" as const,    primaryModel: "gemini-2.5-flash" },
  { phase: "synthesis" as const,     primaryModel: "claude-sonnet-4-6" },
  { phase: "polling" as const,       primaryModel: "gpt-4.1-mini" },
  { phase: "brainstorm" as const,    primaryModel: "gpt-4.1-mini" },
];

export async function seedModelRouting(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[seed] No DB connection available, skipping.");
    return;
  }

  const existing = await db.select().from(modelRouting).limit(1);
  if (existing.length > 0) {
    console.log("[seed] modelRouting already populated, skipping.");
    return;
  }

  await db.insert(modelRouting).values(DEFAULTS);
  console.log(`[seed] Inserted ${DEFAULTS.length} default modelRouting rows.`);
}

// Allow running standalone: `pnpm db:seed`
if (import.meta.url === `file://${process.argv[1]}`) {
  seedModelRouting().then(
    () => process.exit(0),
    (err) => { console.error(err); process.exit(1); }
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test server/ai/seed.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/ai/seed.ts server/ai/seed.test.ts
git commit -m "feat(ai): add idempotent modelRouting seeder (pnpm db:seed)"
```

---

## Task 7: Retry Helper (`server/ai/retry.ts`)

**Files:**
- Create: `server/ai/retry.ts`
- Test: `server/ai/retry.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { invokeWithRetry } from "./retry";

// Mock the ai package's generateObject
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateObject: vi.fn(),
  };
});

import { generateObject, NoObjectGeneratedError } from "ai";

const TestSchema = z.object({ n: z.number() });

describe("invokeWithRetry", () => {
  it("returns object on first success", async () => {
    (generateObject as any).mockResolvedValueOnce({ object: { n: 42 } });
    const result = await invokeWithRetry({} as any, TestSchema, []);
    expect(result).toEqual({ n: 42 });
    expect(generateObject).toHaveBeenCalledOnce();
  });

  it("retries once on NoObjectGeneratedError, succeeds second time", async () => {
    const err = new NoObjectGeneratedError({ message: "bad", cause: undefined, response: undefined, usage: undefined, finishReason: undefined });
    (generateObject as any)
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ object: { n: 7 } });
    const result = await invokeWithRetry({} as any, TestSchema, []);
    expect(result).toEqual({ n: 7 });
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it("retries once on ZodError, fails again → throws", async () => {
    const zodErr = new z.ZodError([{ code: "custom", message: "bad", path: [] }]);
    (generateObject as any)
      .mockRejectedValueOnce(zodErr)
      .mockRejectedValueOnce(zodErr);
    await expect(invokeWithRetry({} as any, TestSchema, [])).rejects.toThrow();
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it("does not retry on unrelated errors", async () => {
    (generateObject as any).mockRejectedValueOnce(new Error("network down"));
    await expect(invokeWithRetry({} as any, TestSchema, [])).rejects.toThrow("network down");
    expect(generateObject).toHaveBeenCalledOnce();
  });

  it("skips retry when remainingMs is too low", async () => {
    const zodErr = new z.ZodError([{ code: "custom", message: "bad", path: [] }]);
    (generateObject as any).mockRejectedValueOnce(zodErr);
    const deadline = Date.now() + 10_000; // 10s remaining, below 30s threshold
    await expect(invokeWithRetry({} as any, TestSchema, [], { deadline })).rejects.toThrow();
    expect(generateObject).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test server/ai/retry.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `retry.ts`**

```typescript
import {
  generateObject,
  NoObjectGeneratedError,
  type LanguageModelV1,
  type ModelMessage,
} from "ai";
import { z } from "zod";

const RETRY_RESERVED_MS = 30_000; // skip retry if less than this remaining

export interface RetryOptions {
  /** Unix epoch ms after which no retry should start. Defaults to no deadline. */
  deadline?: number;
}

export async function invokeWithRetry<T extends z.ZodSchema>(
  model: LanguageModelV1,
  schema: T,
  messages: ModelMessage[],
  options: RetryOptions = {},
): Promise<z.infer<T>> {
  try {
    const { object } = await generateObject({ model, schema, messages });
    return object as z.infer<T>;
  } catch (err) {
    const shouldRetry = err instanceof NoObjectGeneratedError || err instanceof z.ZodError;
    if (!shouldRetry) throw err;

    if (options.deadline) {
      const remaining = options.deadline - Date.now();
      if (remaining < RETRY_RESERVED_MS) throw err;
    }

    const errorDetails = err instanceof z.ZodError
      ? err.errors.map(e => `${e.path.join(".") || "(root)"}: ${e.message}`).join("; ")
      : (err as Error).message;

    const { object } = await generateObject({
      model,
      schema,
      messages: [
        ...messages,
        {
          role: "user",
          content:
            `Your previous response failed validation with these errors: ${errorDetails}. ` +
            `Return a valid JSON object matching the exact schema. Do not add extra fields.`,
        },
      ],
    });
    return object as z.infer<T>;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test server/ai/retry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/ai/retry.ts server/ai/retry.test.ts
git commit -m "feat(ai): add Zod-aware retry helper with deadline awareness"
```

---

## Task 8: Pipeline Phases — Phases 1–3 (Grounded)

**Files:**
- Create: `server/ai/pipeline-phases.ts`
- Test: `server/ai/pipeline-phases.test.ts`

This task builds the grounded phase invocations. Phase 4 (synthesis) and polling/brainstorm come in Task 9.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi } from "vitest";
import { runPhase1, runPhase2, runPhase3 } from "./pipeline-phases";
import { WideScanSchema, GapDetectionSchema, DeepDivesSchema } from "./schemas";

vi.mock("./router", () => ({
  resolvePhase: vi.fn(),
}));
vi.mock("./retry", () => ({
  invokeWithRetry: vi.fn(),
}));
vi.mock("ai", async (orig) => ({
  ...(await orig<typeof import("ai")>()),
  generateObject: vi.fn(),
}));

import { resolvePhase } from "./router";
import { generateObject } from "ai";

describe("runPhase1 (Wide Scan)", () => {
  it("returns parsed output + extracted sources from grounding metadata", async () => {
    const mockClient = vi.fn().mockReturnValue({ /* stub model */ });
    (resolvePhase as any).mockResolvedValue({
      model: "gemini-2.5-flash",
      provider: "gemini",
      client: mockClient,
    });
    (generateObject as any).mockResolvedValue({
      object: { keywords: ["a", "b", "c"], summary: "x".repeat(60) },
      providerMetadata: {
        google: {
          groundingMetadata: {
            groundingChunks: [{ web: { uri: "https://example.com", title: "Ex" } }],
            groundingSupports: [],
            webSearchQueries: [],
          },
        },
      },
    });

    const result = await runPhase1({ nicheName: "AI tools", strategy: "gaps" });

    expect(result.data.keywords).toHaveLength(3);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].url).toBe("https://example.com");
  });

  it("returns empty sources when no grounding metadata returned", async () => {
    (resolvePhase as any).mockResolvedValue({
      model: "gemini-2.5-flash",
      provider: "gemini",
      client: vi.fn().mockReturnValue({}),
    });
    (generateObject as any).mockResolvedValue({
      object: { keywords: ["a", "b", "c"], summary: "x".repeat(60) },
      providerMetadata: {},
    });

    const result = await runPhase1({ nicheName: "X", strategy: "gaps" });
    expect(result.sources).toEqual([]);
  });
});
```

Similar tests for `runPhase2` and `runPhase3` (use GapDetectionSchema / DeepDivesSchema mock objects).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test server/ai/pipeline-phases.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement phases 1–3 in `pipeline-phases.ts`**

```typescript
import { generateObject } from "ai";
import { resolvePhase } from "./router";
import { extractSources, type ExtractedSource } from "./grounding";
import {
  WideScanSchema, type WideScanOutput,
  GapDetectionSchema, type GapDetectionOutput,
  DeepDivesSchema, type DeepDivesOutput,
} from "./schemas";

export interface PhaseInput {
  nicheName: string;
  strategy: "gaps" | "predator" | "provisioning";
  description?: string;
}

export interface PhaseResult<T> {
  data: T;
  sources: ExtractedSource[];
}

const GEMINI_GROUNDING_PROVIDER_OPTIONS = {
  google: { useSearchGrounding: true },
};

async function invokeGrounded<T extends typeof WideScanSchema | typeof GapDetectionSchema | typeof DeepDivesSchema>(
  phase: Parameters<typeof resolvePhase>[0],
  schema: T,
  messages: Parameters<typeof generateObject>[0]["messages"],
  abortSignal?: AbortSignal,
): Promise<PhaseResult<import("zod").infer<T>>> {
  const { model, client } = await resolvePhase(phase);
  const result = await generateObject({
    model: client(model),
    schema,
    messages,
    providerOptions: GEMINI_GROUNDING_PROVIDER_OPTIONS,
    abortSignal,
  });

  const grounding = (result.providerMetadata as any)?.google?.groundingMetadata;
  const sources = grounding ? extractSources(grounding) : [];

  return { data: result.object as any, sources };
}

export async function runPhase1(input: PhaseInput, abortSignal?: AbortSignal): Promise<PhaseResult<WideScanOutput>> {
  return invokeGrounded("wide_scan", WideScanSchema, [
    { role: "system", content: "You are a market research expert. Use web search to find real, recent sources." },
    {
      role: "user",
      content: `Perform a wide scan market analysis for this niche: "${input.nicheName}". Strategy: ${input.strategy}.
${input.description ? `Additional context: ${input.description}` : ""}

Return JSON with:
- keywords: 3-7 search keywords you used
- summary: 2-3 sentence summary of initial findings`,
    },
  ], abortSignal);
}

export async function runPhase2(
  input: PhaseInput & { phase1Summary: string },
  abortSignal?: AbortSignal,
): Promise<PhaseResult<GapDetectionOutput>> {
  return invokeGrounded("gap_detection", GapDetectionSchema, [
    { role: "system", content: "You are a market research expert. Use web search to identify gaps and competitors." },
    {
      role: "user",
      content: `Based on the wide scan of "${input.nicheName}" (summary: ${input.phase1Summary}), identify market gaps and underserved segments, and competitors with weaknesses.

Return JSON with:
- gaps: 2-5 market gaps (title, description)
- competitors: 2-5 competitors (name, weakness)
- summary: 2-3 sentence summary`,
    },
  ], abortSignal);
}

export async function runPhase3(
  input: PhaseInput & { phase2Summary: string },
  abortSignal?: AbortSignal,
): Promise<PhaseResult<DeepDivesOutput>> {
  return invokeGrounded("deep_dives", DeepDivesSchema, [
    { role: "system", content: "You are a market research expert. Use web search to find current monetization examples and technical details." },
    {
      role: "user",
      content: `Perform deep dives on "${input.nicheName}" (gap analysis: ${input.phase2Summary}) focusing on monetization models, technical feasibility, and market timing.

Return JSON with:
- monetizationModels: 2-5 models (name, description, revenueEstimate optional)
- technicalChallenges: 2-5 challenges (title, severity: low/medium/high)
- summary: 2-3 sentence summary`,
    },
  ], abortSignal);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test server/ai/pipeline-phases.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/ai/pipeline-phases.ts server/ai/pipeline-phases.test.ts
git commit -m "feat(ai): add grounded pipeline phases 1-3 (wide scan, gap detection, deep dives)"
```

---

## Task 9: Pipeline Phases — Phase 4 (Synthesis, streaming) + Polling + Brainstorm

**Files:**
- Modify: `server/ai/pipeline-phases.ts`
- Modify: `server/ai/pipeline-phases.test.ts`

- [ ] **Step 1: Add failing tests for phase 4 + polling + brainstorm**

```typescript
import { runPhase4Stream, runPolling, runBrainstorm } from "./pipeline-phases";
import { SynthesisSchema, PollingSchema, BrainstormSchema } from "./schemas";

vi.mock("ai", async (orig) => ({
  ...(await orig<typeof import("ai")>()),
  generateObject: vi.fn(),
  streamObject: vi.fn(),
}));

import { streamObject } from "ai";

describe("runPhase4Stream (Synthesis)", () => {
  it("yields partial objects and returns final", async () => {
    const partials = [
      { verdict: "GO" },
      { verdict: "GO", synthesisScore: 7.5 },
      { verdict: "GO", synthesisScore: 7.5, scores: { marketSize: 8 } },
    ];
    const finalObj = {
      verdict: "GO", synthesisScore: 7.5,
      scores: { marketSize: 8, competition: 6, feasibility: 7, monetization: 7, timeliness: 8 },
      reportMarkdown: "x".repeat(4500),
      verdictReason: "reason".repeat(20),
    };
    async function* mockPartials() { for (const p of partials) yield p; }
    (streamObject as any).mockReturnValue({
      partialObjectStream: mockPartials(),
      object: Promise.resolve(finalObj),
    });
    (resolvePhase as any).mockResolvedValue({ model: "claude-sonnet-4-6", provider: "anthropic", client: vi.fn().mockReturnValue({}) });

    const collected: any[] = [];
    const final = await runPhase4Stream({ nicheName: "X", context: "ctx" }, (p) => collected.push(p));
    expect(collected).toEqual(partials);
    expect(final.verdict).toBe("GO");
  });
});

describe("runPolling", () => {
  it("generates 3-5 survey questions (no grounding)", async () => {
    const mockQuestions = {
      questions: [
        { id: "q1", type: "single_choice", text: "?", options: ["a", "b"] },
        { id: "q2", type: "likert", text: "?" },
        { id: "q3", type: "short_text", text: "?" },
      ],
    };
    (resolvePhase as any).mockResolvedValue({ model: "gpt-4.1-mini", provider: "openai", client: vi.fn().mockReturnValue({}) });
    (generateObject as any).mockResolvedValue({ object: mockQuestions });
    const result = await runPolling({ nicheName: "X", report: "some report" });
    expect(result.questions).toHaveLength(3);
  });
});

describe("runBrainstorm", () => {
  it("generates exactly 10 ideas", async () => {
    const mockIdeas = {
      ideas: Array(10).fill(null).map((_, i) => ({ id: `i${i}`, title: `T${i}`, description: `d${i}` })),
    };
    (resolvePhase as any).mockResolvedValue({ model: "gpt-4.1-mini", provider: "openai", client: vi.fn().mockReturnValue({}) });
    (generateObject as any).mockResolvedValue({ object: mockIdeas });
    const result = await runBrainstorm({ context: "AI tools for HR" });
    expect(result.ideas).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test server/ai/pipeline-phases.test.ts`
Expected: FAIL (new tests fail — functions not defined)

- [ ] **Step 3: Extend `pipeline-phases.ts`**

Append to `pipeline-phases.ts`:

```typescript
import { streamObject } from "ai";
import {
  SynthesisSchema, type SynthesisOutput,
  PollingSchema, type PollingOutput,
  BrainstormSchema, type BrainstormOutput,
} from "./schemas";

export async function runPhase4Stream(
  input: { nicheName: string; context: string },
  onPartial: (partial: Partial<SynthesisOutput>) => void,
  abortSignal?: AbortSignal,
): Promise<SynthesisOutput> {
  const { model, client } = await resolvePhase("synthesis");

  const { partialObjectStream, object } = streamObject({
    model: client(model),
    schema: SynthesisSchema,
    messages: [
      { role: "system", content: "You are a senior market research analyst. Synthesize all findings into a comprehensive report." },
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
    abortSignal,
  });

  for await (const partial of partialObjectStream) {
    onPartial(partial as Partial<SynthesisOutput>);
  }
  const final = await object;
  return final as SynthesisOutput;
}

export async function runPolling(
  input: { nicheName: string; report: string },
  abortSignal?: AbortSignal,
): Promise<PollingOutput> {
  const { model, client } = await resolvePhase("polling");
  const result = await generateObject({
    model: client(model),
    schema: PollingSchema,
    abortSignal,
    messages: [
      { role: "system", content: "You generate targeted survey questions for market research validation." },
      {
        role: "user",
        content: `Given this research report for "${input.nicheName}":
${input.report.substring(0, 2000)}

Generate 3-5 focused questions to validate the most critical market unknowns (e.g. pricing willingness, feature preferences). Mix question types: single_choice (with options), multiple_choice (with options), likert, short_text.

Return JSON: { questions: [{ id, type, text, options? }] }`,
      },
    ],
  });
  return result.object as PollingOutput;
}

export async function runBrainstorm(
  input: { context: string },
  abortSignal?: AbortSignal,
): Promise<BrainstormOutput> {
  const { model, client } = await resolvePhase("brainstorm");
  const result = await generateObject({
    model: client(model),
    schema: BrainstormSchema,
    abortSignal,
    messages: [
      { role: "system", content: "You are a creative market niche ideator. Generate diverse, specific, non-obvious business ideas." },
      {
        role: "user",
        content: `Context: ${input.context}

Generate EXACTLY 10 niche business ideas. Each with: id (kebab-case unique), title (concise), description (max 300 chars, specific target audience + value prop).`,
      },
    ],
  });
  return result.object as BrainstormOutput;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test server/ai/pipeline-phases.test.ts`
Expected: PASS (all phase tests green)

- [ ] **Step 5: Commit**

```bash
git add server/ai/pipeline-phases.ts server/ai/pipeline-phases.test.ts
git commit -m "feat(ai): add phase 4 streaming synthesis + polling + brainstorm"
```

---

## Task 10: Refactor `research-pipeline.ts` to Use New Router

**Files:**
- Modify: `server/research-pipeline.ts`

The current `research-pipeline.ts` uses `invokeLLM` directly. We replace those calls with the new `pipeline-phases` functions and add the `synthesis_progress` SSE event.

- [ ] **Step 1: Read current file**

Run: `cat server/research-pipeline.ts`

Understand the existing SSE flow, DB writes, credit refund logic.

- [ ] **Step 2: Rewrite `research-pipeline.ts`**

```typescript
/**
 * Research Pipeline — SSE Streaming Endpoint
 * All AI calls happen server-side only. Never exposed to the browser.
 */
import type { Request, Response } from "express";
import { runPhase1, runPhase2, runPhase3, runPhase4Stream } from "./ai/pipeline-phases";
import {
  getResearchById,
  updateResearch,
  logAudit,
  addCredit,
  getDb,
} from "./db";
import { sources as sourcesTable, researchPhases } from "../drizzle/schema";

type SseEvent =
  | { type: "phase_start"; phase: string; label: string }
  | { type: "agent_action"; phase: string; message: string }
  | { type: "source_found"; url: string; title: string; sourceType: string; publishedAt: string | null }
  | { type: "phase_complete"; phase: string; durationMs: number; sourcesFound: number; summary: string }
  | { type: "synthesis_progress"; partial: any }
  | { type: "pipeline_complete"; verdict: string; synthesisScore: number; reportMarkdown: string; scores: Record<string, number> }
  | { type: "pipeline_error"; phase?: string; message: string; retriable: boolean };

function sendEvent(res: Response, event: SseEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

const PHASE_LABELS: Record<string, string> = {
  wide_scan: "Wide Scan",
  gap_detection: "Gap Detection",
  deep_dives: "Deep Dives",
  synthesis: "Synthesis",
};

const PHASE_TIMEOUTS_MS: Record<string, number> = {
  wide_scan: 120_000,
  gap_detection: 120_000,
  deep_dives: 120_000,
  synthesis: 180_000,
};

function makePhaseAbort(phase: string): AbortSignal {
  const ctrl = new AbortController();
  const ms = PHASE_TIMEOUTS_MS[phase] ?? 120_000;
  setTimeout(() => ctrl.abort(new Error(`Phase ${phase} timed out after ${ms}ms`)), ms);
  return ctrl.signal;
}

export async function runResearchPipeline(req: Request, res: Response) {
  const researchId = parseInt(req.params.id ?? "0");
  const userId = (req as any).user?.id;

  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const research = await getResearchById(researchId);
  if (!research) { res.status(404).json({ error: "Not found" }); return; }
  if (research.userId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }
  if (research.status === "running" || research.status === "done") {
    res.status(400).json({ error: "Research already running or completed" });
    return;
  }

  // Setup SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  await updateResearch(researchId, { status: "running" });

  let currentPhase = "wide_scan";
  try {
    const db = await getDb();
    const allSources: Array<{ url: string; title: string; snippet: string; sourceType: string; publishedAt: string | null }> = [];

    // ── Phase 1 ────────────────────────────────────────────────────────────
    currentPhase = "wide_scan";
    const phase1Start = Date.now();
    sendEvent(res, { type: "phase_start", phase: currentPhase, label: PHASE_LABELS[currentPhase] });
    sendEvent(res, { type: "agent_action", phase: currentPhase, message: `Kulcsszavak generálása: "${research.nicheName}"` });

    const p1 = await runPhase1({
      nicheName: research.nicheName,
      strategy: research.strategy,
      description: research.description ?? undefined,
    }, makePhaseAbort(currentPhase));

    for (const src of p1.sources) {
      sendEvent(res, { type: "source_found", url: src.url, title: src.title, sourceType: src.sourceType, publishedAt: src.publishedAt });
      allSources.push({ url: src.url, title: src.title, snippet: src.snippet, sourceType: src.sourceType, publishedAt: src.publishedAt });
    }
    const phase1Duration = Date.now() - phase1Start;
    sendEvent(res, { type: "phase_complete", phase: currentPhase, durationMs: phase1Duration, sourcesFound: p1.sources.length, summary: p1.data.summary });
    if (db) await db.insert(researchPhases).values({ researchId, phase: "wide_scan", status: "done", summary: p1.data.summary, durationMs: phase1Duration, sourcesFound: p1.sources.length });

    // ── Phase 2 ────────────────────────────────────────────────────────────
    currentPhase = "gap_detection";
    const phase2Start = Date.now();
    sendEvent(res, { type: "phase_start", phase: currentPhase, label: PHASE_LABELS[currentPhase] });
    sendEvent(res, { type: "agent_action", phase: currentPhase, message: "Piaci rések és versenytársak elemzése..." });

    const p2 = await runPhase2({
      nicheName: research.nicheName,
      strategy: research.strategy,
      phase1Summary: p1.data.summary,
    }, makePhaseAbort(currentPhase));

    for (const src of p2.sources) {
      sendEvent(res, { type: "source_found", url: src.url, title: src.title, sourceType: src.sourceType, publishedAt: src.publishedAt });
      allSources.push({ url: src.url, title: src.title, snippet: src.snippet, sourceType: src.sourceType, publishedAt: src.publishedAt });
    }
    const phase2Duration = Date.now() - phase2Start;
    sendEvent(res, { type: "phase_complete", phase: currentPhase, durationMs: phase2Duration, sourcesFound: p2.sources.length, summary: p2.data.summary });
    if (db) await db.insert(researchPhases).values({ researchId, phase: "gap_detection", status: "done", summary: p2.data.summary, durationMs: phase2Duration, sourcesFound: p2.sources.length });

    // ── Phase 3 ────────────────────────────────────────────────────────────
    currentPhase = "deep_dives";
    const phase3Start = Date.now();
    sendEvent(res, { type: "phase_start", phase: currentPhase, label: PHASE_LABELS[currentPhase] });
    sendEvent(res, { type: "agent_action", phase: currentPhase, message: "Mélyebb elemzés: monetizáció, megvalósíthatóság..." });

    const p3 = await runPhase3({
      nicheName: research.nicheName,
      strategy: research.strategy,
      phase2Summary: p2.data.summary,
    }, makePhaseAbort(currentPhase));

    for (const src of p3.sources) {
      sendEvent(res, { type: "source_found", url: src.url, title: src.title, sourceType: src.sourceType, publishedAt: src.publishedAt });
      allSources.push({ url: src.url, title: src.title, snippet: src.snippet, sourceType: src.sourceType, publishedAt: src.publishedAt });
    }
    const phase3Duration = Date.now() - phase3Start;
    sendEvent(res, { type: "phase_complete", phase: currentPhase, durationMs: phase3Duration, sourcesFound: p3.sources.length, summary: p3.data.summary });
    if (db) await db.insert(researchPhases).values({ researchId, phase: "deep_dives", status: "done", summary: p3.data.summary, durationMs: phase3Duration, sourcesFound: p3.sources.length });

    // ── Phase 4 (streaming) ────────────────────────────────────────────────
    currentPhase = "synthesis";
    const phase4Start = Date.now();
    sendEvent(res, { type: "phase_start", phase: currentPhase, label: PHASE_LABELS[currentPhase] });
    sendEvent(res, { type: "agent_action", phase: currentPhase, message: "Összefoglalás és verdikt generálása..." });

    const synthesisContext = [
      `Phase 1 (Wide Scan) summary: ${p1.data.summary}`,
      `Phase 2 (Gap Detection) summary: ${p2.data.summary}`,
      `  Gaps: ${p2.data.gaps.map(g => g.title).join(", ")}`,
      `  Competitors: ${p2.data.competitors.map(c => c.name).join(", ")}`,
      `Phase 3 (Deep Dives) summary: ${p3.data.summary}`,
      `  Monetization: ${p3.data.monetizationModels.map(m => m.name).join(", ")}`,
      `  Technical challenges: ${p3.data.technicalChallenges.map(t => `${t.title}[${t.severity}]`).join(", ")}`,
    ].join("\n");

    const synth = await runPhase4Stream(
      { nicheName: research.nicheName, context: synthesisContext },
      (partial) => sendEvent(res, { type: "synthesis_progress", partial }),
      makePhaseAbort(currentPhase),
    );

    const phase4Duration = Date.now() - phase4Start;
    sendEvent(res, { type: "phase_complete", phase: currentPhase, durationMs: phase4Duration, sourcesFound: 0, summary: synth.verdictReason });
    if (db) await db.insert(researchPhases).values({ researchId, phase: "synthesis", status: "done", summary: synth.verdictReason, durationMs: phase4Duration, sourcesFound: 0 });

    // Persist sources
    if (db && allSources.length > 0) {
      for (const src of allSources) {
        try {
          await db.insert(sourcesTable).values({
            researchId,
            url: src.url,
            title: src.title,
            snippet: src.snippet,
            sourceType: (["academic", "industry", "news", "blog", "community"].includes(src.sourceType) ? src.sourceType : "blog") as any,
            publishedAt: src.publishedAt,
            relevanceScore: "0.75",
          });
        } catch { /* duplicate URL or schema mismatch — skip individual row */ }
      }
    }

    await updateResearch(researchId, {
      status: "done",
      verdict: synth.verdict,
      synthesisScore: synth.synthesisScore.toFixed(2) as any,
      scoreMarketSize: synth.scores.marketSize.toFixed(2) as any,
      scoreCompetition: synth.scores.competition.toFixed(2) as any,
      scoreFeasibility: synth.scores.feasibility.toFixed(2) as any,
      scoreMonetization: synth.scores.monetization.toFixed(2) as any,
      scoreTimeliness: synth.scores.timeliness.toFixed(2) as any,
      reportMarkdown: synth.reportMarkdown,
      completedAt: new Date(),
    });

    sendEvent(res, {
      type: "pipeline_complete",
      verdict: synth.verdict,
      synthesisScore: synth.synthesisScore,
      reportMarkdown: synth.reportMarkdown,
      scores: synth.scores,
    });

    await logAudit(userId, "research.complete", { researchId, verdict: synth.verdict, synthesisScore: synth.synthesisScore }, req);

  } catch (error: any) {
    console.error("[Pipeline] Error:", error);
    const message = error?.message ?? "Ismeretlen hiba";
    const retriable = !message.includes("timed out") && !message.includes("No API key");
    sendEvent(res, { type: "pipeline_error", phase: currentPhase, message, retriable });
    await updateResearch(researchId, { status: "failed", errorMessage: message });
    await addCredit(userId, research.creditsUsed, "Automatikus visszatérítés — sikertelen kutatás");
    await logAudit(userId, "research.failed", { researchId, phase: currentPhase, error: message }, req);
  } finally {
    res.end();
  }
}
```

- [ ] **Step 3: Run TypeScript check**

Run: `pnpm check`
Expected: 0 errors

- [ ] **Step 4: Run existing pipeline tests (they may now fail — that's Task 11)**

Run: `pnpm test server/deep-research.test.ts`
Expected: may FAIL (mocks still reference old invokeLLM) — fixing is Task 11

- [ ] **Step 5: Commit**

```bash
git add server/research-pipeline.ts
git commit -m "refactor(pipeline): migrate research-pipeline.ts to new ai/ router + streaming synthesis"
```

---

## Task 11: Update Existing Tests in `server/deep-research.test.ts`

**Files:**
- Modify: `server/deep-research.test.ts`

- [ ] **Step 1: Read current test file**

Run: `cat server/deep-research.test.ts` to understand existing mocks.

- [ ] **Step 2: Update mocks from `invokeLLM` to new API**

Find every `vi.mock("./_core/llm")` or similar and replace with mocks for:
- `./ai/pipeline-phases` (mock all exported `runPhaseN` functions)
- `./ai/router` (mock `resolvePhase` if tests hit it directly)

Example pattern:

```typescript
vi.mock("./ai/pipeline-phases", () => ({
  runPhase1: vi.fn().mockResolvedValue({
    data: { keywords: ["a", "b", "c"], summary: "mock summary" },
    sources: [{ url: "https://mock.test", title: "Mock", snippet: "", sourceType: "blog", publishedAt: null }],
  }),
  runPhase2: vi.fn().mockResolvedValue({
    data: {
      gaps: [{ title: "g1", description: "d1" }, { title: "g2", description: "d2" }],
      competitors: [{ name: "c1", weakness: "w1" }, { name: "c2", weakness: "w2" }],
      summary: "gap summary",
    },
    sources: [],
  }),
  runPhase3: vi.fn().mockResolvedValue({
    data: {
      monetizationModels: [{ name: "m1", description: "d1" }, { name: "m2", description: "d2" }],
      technicalChallenges: [{ title: "t1", severity: "low" }, { title: "t2", severity: "high" }],
      summary: "deep summary",
    },
    sources: [],
  }),
  runPhase4Stream: vi.fn().mockImplementation(async (_input, onPartial) => {
    onPartial({ verdict: "GO" });
    return {
      verdict: "GO", synthesisScore: 7.5,
      scores: { marketSize: 8, competition: 6, feasibility: 7, monetization: 7, timeliness: 8 },
      reportMarkdown: "x".repeat(4500),
      verdictReason: "reasonable".repeat(10),
    };
  }),
  runPolling: vi.fn(),
  runBrainstorm: vi.fn(),
}));
```

Remove any remaining references to `./_core/llm` / `invokeLLM`.

- [ ] **Step 3: Run tests to verify all 17 still pass**

Run: `pnpm test server/deep-research.test.ts`
Expected: PASS (all 17 green)

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: PASS (17 existing + all new tests from tasks 1–9 green)

- [ ] **Step 5: Commit**

```bash
git add server/deep-research.test.ts
git commit -m "test(pipeline): update existing 17 tests to new pipeline-phases mocks"
```

---

## Task 12: Migrate Polling + Brainstorm Procedures in `server/routers.ts`

**Files:**
- Modify: `server/routers.ts`

The current `routers.ts` contains tRPC procedures for brainstorm (generate 10 ideas) and survey question generation that call `invokeLLM`. Replace with `runBrainstorm` / `runPolling`.

- [ ] **Step 1: Read current file**

Run: `cat server/routers.ts | grep -n invokeLLM`

Identify every procedure that calls `invokeLLM`.

- [ ] **Step 2: Replace `invokeLLM` calls with new helpers**

For each identified procedure, replace the LLM call pattern. Example for brainstorm:

```typescript
// BEFORE
const response = await invokeLLM({ messages: [...] });
const content = response.choices?.[0]?.message?.content ?? "{}";
const ideas = JSON.parse(content);

// AFTER
import { runBrainstorm } from "./ai/pipeline-phases";
const result = await runBrainstorm({ context: input.context });
return result.ideas;
```

For survey question generation:

```typescript
// BEFORE: invokeLLM with custom JSON parse
// AFTER:
import { runPolling } from "./ai/pipeline-phases";
const result = await runPolling({
  nicheName: research.nicheName,
  report: research.reportMarkdown ?? "",
});
return result.questions;
```

- [ ] **Step 3: Run TypeScript check**

Run: `pnpm check`
Expected: 0 errors

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: all tests green

- [ ] **Step 5: Commit**

```bash
git add server/routers.ts
git commit -m "refactor(routers): migrate polling + brainstorm procedures to new ai/ helpers"
```

---

## Task 13: Admin tRPC Procedures for AI Config

**Files:**
- Modify: `server/routers.ts`

Add admin procedures to list/set/test AI provider configs and update routing. Follow existing tRPC patterns in the file.

- [ ] **Step 1: Write failing test**

Add to `server/deep-research.test.ts` or a new file:

```typescript
describe("admin AI procedures", () => {
  it("admin.ai.listConfigs returns all providers with masked keys", async () => {
    // seed aiConfigs
    // call procedure
    // expect: { provider, hasKey: boolean, isActive }[] — key itself NOT returned
  });

  it("admin.ai.setProviderKey stores and masks on readback", async () => {
    // call with { provider: "openai", apiKey: "sk-real" }
    // listConfigs → hasKey: true, apiKey NOT in response
  });

  it("admin.ai.updateRouting updates modelRouting row", async () => {
    // call with { phase: "wide_scan", primaryModel: "gemini-2.5-pro" }
    // read back: primaryModel = "gemini-2.5-pro"
  });

  it("admin procedures reject non-admin users", async () => {
    // call with ctx.user.role = "user"
    // expect FORBIDDEN
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test server/deep-research.test.ts`
Expected: new admin tests FAIL

- [ ] **Step 3: Add admin procedures to `server/routers.ts`**

```typescript
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { aiConfigs, modelRouting } from "../drizzle/schema";

// ... add under an `admin` subrouter ...

ai: router({
  listConfigs: adminProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(aiConfigs);
    return rows.map(r => ({
      provider: r.provider,
      hasKey: !!r.apiKey && r.apiKey.length > 0,
      isActive: r.isActive,
      updatedAt: r.updatedAt,
    }));
  }),

  setProviderKey: adminProcedure
    .input(z.object({
      provider: z.enum(["openai", "anthropic", "gemini"]),
      apiKey: z.string().min(10),
      isActive: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("No DB");
      const existing = await db.select().from(aiConfigs).where(eq(aiConfigs.provider, input.provider)).limit(1);
      if (existing.length > 0) {
        await db.update(aiConfigs)
          .set({ apiKey: input.apiKey, isActive: input.isActive })
          .where(eq(aiConfigs.provider, input.provider));
      } else {
        await db.insert(aiConfigs).values({
          provider: input.provider,
          apiKey: input.apiKey,
          isActive: input.isActive,
        });
      }
      await logAudit(ctx.user.id, "admin.ai.setProviderKey", { provider: input.provider, isActive: input.isActive }, ctx.req);
      return { success: true };
    }),

  testProvider: adminProcedure
    .input(z.object({
      provider: z.enum(["openai", "anthropic", "gemini"]),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("No DB");
      const rows = await db.select().from(aiConfigs).where(eq(aiConfigs.provider, input.provider)).limit(1);
      const apiKey = rows[0]?.apiKey;
      if (!apiKey) return { ok: false, error: "No API key set" };

      try {
        const client = input.provider === "openai"    ? createOpenAI({ apiKey })
                     : input.provider === "anthropic" ? createAnthropic({ apiKey })
                     : createGoogleGenerativeAI({ apiKey });
        const model = input.provider === "openai" ? "gpt-4.1-mini"
                    : input.provider === "anthropic" ? "claude-sonnet-4-6"
                    : "gemini-2.5-flash";
        await generateText({
          model: client(model),
          messages: [{ role: "user", content: "Reply with exactly one word: OK" }],
        });
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    }),

  listRouting: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(modelRouting);
  }),

  updateRouting: adminProcedure
    .input(z.object({
      phase: z.enum(["wide_scan", "gap_detection", "deep_dives", "synthesis", "polling", "brainstorm"]),
      primaryModel: z.string().min(3),
      fallbackModel: z.string().optional(),
      systemPrompt: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("No DB");
      const existing = await db.select().from(modelRouting).where(eq(modelRouting.phase, input.phase)).limit(1);
      if (existing.length > 0) {
        await db.update(modelRouting).set({
          primaryModel: input.primaryModel,
          fallbackModel: input.fallbackModel ?? null,
          systemPrompt: input.systemPrompt ?? existing[0].systemPrompt,
        }).where(eq(modelRouting.phase, input.phase));
      } else {
        await db.insert(modelRouting).values({
          phase: input.phase,
          primaryModel: input.primaryModel,
          fallbackModel: input.fallbackModel,
          systemPrompt: input.systemPrompt,
        });
      }
      await logAudit(ctx.user.id, "admin.ai.updateRouting", input, ctx.req);
      return { success: true };
    }),
}),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test server/deep-research.test.ts`
Expected: all admin tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/routers.ts server/deep-research.test.ts
git commit -m "feat(admin): add tRPC procedures for AI provider config and model routing"
```

---

## Task 14: Wire AdminPanel UI to Admin Procedures

**Files:**
- Modify: `client/src/pages/AdminPanel.tsx`

The existing AdminPanel has an AI Config tab with mocked forms. Connect it to the real tRPC procedures from Task 13.

- [ ] **Step 1: Read current AdminPanel AI Config section**

Run: `grep -n "aiConfig\|AI Config\|provider" client/src/pages/AdminPanel.tsx | head -30`

- [ ] **Step 2: Replace mock state with tRPC queries/mutations**

```tsx
const { data: aiConfigs, refetch: refetchConfigs } = trpc.admin.ai.listConfigs.useQuery();
const { data: routing, refetch: refetchRouting } = trpc.admin.ai.listRouting.useQuery();
const setKey = trpc.admin.ai.setProviderKey.useMutation({ onSuccess: () => refetchConfigs() });
const testProvider = trpc.admin.ai.testProvider.useMutation();
const updateRouting = trpc.admin.ai.updateRouting.useMutation({ onSuccess: () => refetchRouting() });
```

- [ ] **Step 3: Replace "Providers" tab UI to use live data**

For each provider (OpenAI, Anthropic, Gemini) in the Providers tab:

```tsx
const config = aiConfigs?.find(c => c.provider === provider);
// Show masked key: config?.hasKey ? "••••••••" : "Not configured"
// Input + Save button: setKey.mutateAsync({ provider, apiKey: input.value })
// Test Connection button: testProvider.mutateAsync({ provider })
// Result toast from testProvider.data
```

- [ ] **Step 4: Replace "Model Routing" tab UI**

```tsx
{routing?.map(r => (
  <tr key={r.phase}>
    <td>{r.phase}</td>
    <td>
      <input defaultValue={r.primaryModel} onBlur={e =>
        updateRouting.mutate({ phase: r.phase, primaryModel: e.target.value })
      } />
    </td>
    <td>
      <input defaultValue={r.fallbackModel ?? ""} onBlur={e =>
        updateRouting.mutate({ phase: r.phase, primaryModel: r.primaryModel, fallbackModel: e.target.value || undefined })
      } />
    </td>
  </tr>
))}
```

- [ ] **Step 5: Run TypeScript check + dev server**

Run:
```bash
pnpm check
pnpm dev
```

Manually: navigate to `/admin`, verify the AI Config tab shows live data and Save/Test buttons work.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/AdminPanel.tsx
git commit -m "feat(admin-ui): wire AI Config tab to live admin tRPC procedures"
```

---

## Task 15: UI — "Dátum ismeretlen" Fallback + i18n Keys

**Files:**
- Modify: `client/src/i18n/hu.ts`
- Modify: `client/src/i18n/en.ts`
- Modify: `client/src/pages/ResearchReport.tsx`

- [ ] **Step 1: Add i18n keys**

In `client/src/i18n/hu.ts`, add under `report.sources`:

```typescript
sources: {
  // ... existing
  unknownDate: "Dátum ismeretlen",
},
```

In `client/src/i18n/en.ts`:

```typescript
sources: {
  // ... existing
  unknownDate: "Unknown date",
},
```

- [ ] **Step 2: Add error state i18n keys**

In both files, add under `progress`:

```typescript
error: {
  title: "A kutatás megszakadt",  // EN: "Research interrupted"
  phase: "Fázis",                  // EN: "Phase"
  refunded: "Kredit automatikusan visszatérítve",  // EN: "Credit automatically refunded"
  retry: "Újrapróbálás",           // EN: "Retry"
},
synthesis: {
  streaming: "A riport valós időben készül...",  // EN: "Report generating live..."
},
```

- [ ] **Step 3: Update ResearchReport source rendering**

Find the source card rendering in `ResearchReport.tsx`. Wrap date display:

```tsx
<span className={source.publishedAt ? "text-sm" : "text-sm text-muted-foreground italic"}>
  {source.publishedAt ?? t("report.sources.unknownDate")}
</span>
```

- [ ] **Step 4: Run TypeScript check and visual test**

```bash
pnpm check
pnpm dev
```

Manually: create a research with null publishedAt source → verify "Dátum ismeretlen" appears in the source library. Toggle language to EN → verify "Unknown date".

- [ ] **Step 5: Commit**

```bash
git add client/src/i18n/hu.ts client/src/i18n/en.ts client/src/pages/ResearchReport.tsx
git commit -m "feat(ui): add 'Dátum ismeretlen' fallback + error/streaming i18n keys"
```

---

## Task 16: UI — Handle `synthesis_progress` SSE Event in ResearchProgress

**Files:**
- Modify: `client/src/pages/ResearchProgress.tsx`

- [ ] **Step 1: Find the existing SSE event handler**

Run: `grep -n "EventSource\|onmessage\|phase_complete" client/src/pages/ResearchProgress.tsx`

- [ ] **Step 2: Add handler for new event types**

Extend the SSE event parser:

```tsx
eventSource.onmessage = (e) => {
  const event = JSON.parse(e.data);
  switch (event.type) {
    case "phase_start":           /* existing */ break;
    case "agent_action":          /* existing */ break;
    case "source_found":          /* existing */ break;
    case "phase_complete":        /* existing */ break;
    case "synthesis_progress":
      setSynthesisPartial(event.partial);
      if (event.partial?.reportMarkdown) {
        setStreamingReport(event.partial.reportMarkdown);
      }
      break;
    case "pipeline_complete":     /* existing */ break;
    case "pipeline_error":
      setError({
        phase: event.phase ?? null,
        message: event.message,
        retriable: event.retriable ?? false,
      });
      break;
  }
};
```

- [ ] **Step 3: Add streaming report UI (optional — user sees live report text)**

When `streamingReport` is set, show a growing markdown block (via `<Streamdown>` or the existing Markdown renderer) under the phase cards. Hide it when `pipeline_complete` fires (ResearchReport page takes over).

- [ ] **Step 4: Add error card UI**

When `error` state is set, show a red alert card with phase name + message + "Credit refunded" note + retry button (if retriable).

- [ ] **Step 5: Run TypeScript check + manual smoke test**

```bash
pnpm check
pnpm dev
```

Start a real research (needs a valid API key in ENV or DB); verify:
- Dog mascot animates during phases 1–3
- Source cards fill in as they stream
- During synthesis: report markdown progressively appears
- On completion: redirect to ResearchReport

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/ResearchProgress.tsx
git commit -m "feat(ui): handle synthesis_progress SSE events with live markdown streaming"
```

---

## Task 17: Delete `server/_core/llm.ts`

**Files:**
- Delete: `server/_core/llm.ts`

- [ ] **Step 1: Verify no remaining references**

```bash
grep -rn "invokeLLM\|_core/llm" server/ client/ --include="*.ts" --include="*.tsx"
```

Expected: zero matches. If any remain, fix them first (go back to the relevant task).

- [ ] **Step 2: Delete the file**

```bash
git rm server/_core/llm.ts
```

- [ ] **Step 3: Run full TypeScript check + all tests**

```bash
pnpm check
pnpm test
```

Expected: 0 TypeScript errors, all tests green.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove server/_core/llm.ts (Manus Forge proxy, superseded by ai/ module)"
```

---

## Task 18: Integration Tests (Opt-in, `.integration.test.ts`)

**Files:**
- Create: `server/ai/pipeline-phases.integration.test.ts`

Real provider calls. Skipped unless `RUN_INTEGRATION_TESTS=1`.

- [ ] **Step 1: Write integration tests**

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { runPhase1, runPhase4Stream, runPolling, runBrainstorm } from "./pipeline-phases";

const skip = !process.env.RUN_INTEGRATION_TESTS;
const d = skip ? describe.skip : describe;

beforeAll(() => {
  if (!skip) {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY required");
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY required");
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY required");
  }
});

d("runPhase1 integration (real Gemini grounding)", () => {
  it("returns valid output + at least 1 grounded source", async () => {
    const result = await runPhase1({
      nicheName: "AI code review tools",
      strategy: "gaps",
    });
    expect(result.data.keywords.length).toBeGreaterThanOrEqual(3);
    expect(result.data.summary.length).toBeGreaterThan(50);
    expect(result.sources.length).toBeGreaterThanOrEqual(1);
    for (const src of result.sources) {
      expect(src.url).toMatch(/^https?:\/\//);
      expect(src.title.length).toBeGreaterThan(0);
    }
  }, 180_000);
});

d("runPhase4Stream integration (real Claude streaming)", () => {
  it("streams partials and returns final", async () => {
    const partials: any[] = [];
    const final = await runPhase4Stream(
      { nicheName: "AI code review tools", context: "brief context" },
      (p) => partials.push(p),
    );
    expect(partials.length).toBeGreaterThan(0);
    expect(final.verdict).toMatch(/^(GO|KILL|CONDITIONAL)$/);
    expect(final.reportMarkdown.length).toBeGreaterThan(4000);
  }, 240_000);
});

d("runPolling integration", () => {
  it("generates 3-5 valid questions", async () => {
    const result = await runPolling({
      nicheName: "AI code review tools",
      report: "Market analysis shows strong demand for developer productivity tools.",
    });
    expect(result.questions.length).toBeGreaterThanOrEqual(3);
    expect(result.questions.length).toBeLessThanOrEqual(5);
  }, 90_000);
});

d("runBrainstorm integration", () => {
  it("generates exactly 10 ideas", async () => {
    const result = await runBrainstorm({ context: "SaaS tools for remote design teams" });
    expect(result.ideas).toHaveLength(10);
  }, 90_000);
});
```

- [ ] **Step 2: Verify tests are skipped by default**

Run: `pnpm test`
Expected: all unit tests PASS; integration tests SKIPPED (marked as such in the output).

- [ ] **Step 3: Run integration tests manually (optional — requires API keys)**

```bash
RUN_INTEGRATION_TESTS=1 GEMINI_API_KEY=... ANTHROPIC_API_KEY=... OPENAI_API_KEY=... pnpm test:integration
```

Expected: all 4 integration tests PASS.

- [ ] **Step 4: Commit**

```bash
git add server/ai/pipeline-phases.integration.test.ts
git commit -m "test: add opt-in integration tests for real provider calls"
```

---

## Task 19: End-to-End Smoke Test (Manual + Seeded DB)

No code changes — verification task.

- [ ] **Step 1: Ensure DB is seeded**

```bash
pnpm db:push   # ensure schema migrated
pnpm db:seed   # seed modelRouting defaults
```

Expected: `[seed] Inserted 6 default modelRouting rows.`

- [ ] **Step 2: Configure API keys**

Option A (ENV): set in `.env.local`:
```
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
```

Option B (Admin UI): after starting the dev server, navigate to `/admin` → AI Config → enter keys for each provider → Test Connection for each.

- [ ] **Step 3: Run dev server**

```bash
pnpm dev
```

- [ ] **Step 4: Execute full user flow**

In browser:
1. Register / log in
2. Go to `/research/new`, enter a test niche ("AI-powered tools for dental practices")
3. Select strategy "Find Unmet Market Gaps"
4. Start research
5. Verify on `/research/:id/progress`:
   - Dog mascot animates
   - Phases 1–3 show "source_found" events with real URLs (not Manus mocks)
   - Phase 4 shows progressive markdown streaming
6. On completion, verify `/research/:id` report:
   - Verdict badge shows GO/KILL/CONDITIONAL
   - Radar chart has 5 axes
   - Source library shows real Gemini URLs
   - At least one source shows "Dátum ismeretlen" (or all, since C1 null publishedAt)
7. Check DB:
   ```bash
   # Verify sources were inserted from grounding, not LLM output
   SELECT COUNT(*) FROM sources WHERE researchId = <id>;  -- should be > 0
   SELECT DISTINCT publishedAt FROM sources WHERE researchId = <id>;  -- should be NULL
   ```

- [ ] **Step 5: Smoke test admin override**

In `/admin`:
1. Change modelRouting for `synthesis` from `claude-sonnet-4-6` to `gpt-4.1` (assume OpenAI key is set)
2. Start a new research
3. Verify it completes (uses GPT-4.1 for synthesis instead)
4. Revert modelRouting

- [ ] **Step 6: DoD checklist verification**

Verify from spec §15:
- [ ] Research triggers real Gemini (grounded) + Claude Sonnet, NOT Manus Forge
- [ ] Admin UI changes take effect on next research
- [ ] Gemini Search real URLs appear in source library (not LLM hallucinations)
- [ ] Synthesis markdown streams progressively (not 180s blank wait)
- [ ] Zod validation errors recover via 1x retry (test by temporarily tightening a schema)
- [ ] All tests green (`pnpm test`)
- [ ] PRD / UI spec / Handoff already updated to v3.2 (done during brainstorming)

- [ ] **Step 7: Final commit + PR open**

```bash
git log --oneline  # review the sprint's commits
git push -u origin feat/c1-ai-pipeline-migration
gh pr create --title "C1: AI pipeline migration to Vercel AI SDK + Gemini grounding" --body "$(cat <<'EOF'
## Summary
- Migrates AI pipeline from Manus Forge proxy (`_core/llm.ts`) to direct provider SDKs via Vercel AI SDK v5
- Adds Gemini Search Grounding to phases 1-3 (Wide Scan, Gap Detection, Deep Dives)
- Activates admin-configurable model routing + API key management (DB-first / ENV fallback)
- Synthesis (phase 4) now uses `streamObject` for progressive SSE streaming

## Scope (explicit NON-goals, all deferred)
- C2: fallback model logic, AES-256-GCM key encryption, prompt injection sanitization
- Manus OAuth replacement (separate sub-project)
- Stripe + Számlázz.hu integration (separate sub-project)

## Test plan
- [x] All 17 existing vitest tests green (refactored mocks)
- [x] New unit tests green (schemas, classify, grounding, router, seed, retry, pipeline-phases)
- [x] Integration tests pass with real provider keys (manual run)
- [x] Full E2E smoke: real research with live Gemini grounded URLs, progressive synthesis
- [x] Admin UI: set key, test connection, update routing — verified live
- [x] `pnpm db:seed` idempotent (run twice, no duplicates)
- [x] `server/_core/llm.ts` deleted, no remaining `invokeLLM` references

Spec: docs/superpowers/specs/2026-04-17-ai-pipeline-c1-design.md
Plan: docs/superpowers/plans/2026-04-17-ai-pipeline-c1.md
EOF
)"
```

---

## Sprint Complete

All 19 tasks finished, the C1 sprint is done. Hand off to C2 next (fallback logic + encryption + prompt sanitization).

**Session handoff notes:**
- Worktree: `repo-c1-ai-pipeline` branch `feat/c1-ai-pipeline-migration`
- After PR merges: remove worktree with `git worktree remove ../repo-c1-ai-pipeline`
