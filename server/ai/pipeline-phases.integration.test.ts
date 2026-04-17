import { describe, it, expect, beforeAll } from "vitest";
import { runPhase1, runPhase4Stream, runPolling, runBrainstorm } from "./pipeline-phases";

const RUN = process.env.RUN_INTEGRATION_TESTS === "1";
const d = RUN ? describe : describe.skip;

beforeAll(() => {
  if (!RUN) return;
  const missing: string[] = [];
  if (!process.env.GEMINI_API_KEY) missing.push("GEMINI_API_KEY");
  if (!process.env.ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (missing.length > 0) {
    throw new Error(`Integration tests require these env vars: ${missing.join(", ")}`);
  }
});

d("runPhase1 integration (real Gemini grounded call)", () => {
  it("returns valid output + at least 1 grounded source with real URL", async () => {
    const result = await runPhase1({
      nicheName: "AI code review tools for startups",
      strategy: "gaps",
    });
    expect(result.data.keywords.length).toBeGreaterThanOrEqual(3);
    expect(result.data.summary.length).toBeGreaterThan(50);
    expect(result.sources.length).toBeGreaterThanOrEqual(1);
    for (const src of result.sources) {
      expect(src.url).toMatch(/^https?:\/\//);
      expect(src.title.length).toBeGreaterThan(0);
      expect(src.publishedAt).toBeNull(); // C1 always null
    }
  }, 180_000);
});

d("runPhase4Stream integration (real Claude streaming synthesis)", () => {
  it("streams partials and returns a full validated final object", async () => {
    const partials: any[] = [];
    const final = await runPhase4Stream(
      {
        nicheName: "AI code review tools for startups",
        context:
          "Phase 1 summary: market growing 30% YoY. " +
          "Phase 2 summary: gaps in IDE integration. " +
          "Phase 3 summary: SaaS + freemium most common. Scaling is the main technical challenge.",
      },
      (p) => partials.push(p),
    );
    expect(partials.length).toBeGreaterThan(0);
    expect(final.verdict).toMatch(/^(GO|KILL|CONDITIONAL)$/);
    expect(final.reportMarkdown.length).toBeGreaterThan(4000);
    expect(final.synthesisScore).toBeGreaterThanOrEqual(0);
    expect(final.synthesisScore).toBeLessThanOrEqual(10);
  }, 240_000);
});

d("runPolling integration (real GPT-4.1-mini)", () => {
  it("generates 3-5 validated survey questions", async () => {
    const result = await runPolling({
      nicheName: "AI code review tools",
      report: "Market analysis shows strong demand for developer productivity tools. Key gaps: IDE integration, offline mode, team collaboration.",
    });
    expect(result.questions.length).toBeGreaterThanOrEqual(3);
    expect(result.questions.length).toBeLessThanOrEqual(5);
    for (const q of result.questions) {
      expect(q.id).toBeTruthy();
      expect(q.text).toBeTruthy();
      expect(["single_choice", "multiple_choice", "likert", "short_text"]).toContain(q.type);
    }
  }, 90_000);
});

d("runBrainstorm integration (real GPT-4.1-mini)", () => {
  it("generates exactly 10 ideas", async () => {
    const result = await runBrainstorm({ context: "SaaS tools for remote design teams in 2026" });
    expect(result.ideas).toHaveLength(10);
    const ids = new Set(result.ideas.map((i) => i.id));
    expect(ids.size).toBe(10); // all unique
  }, 90_000);
});
