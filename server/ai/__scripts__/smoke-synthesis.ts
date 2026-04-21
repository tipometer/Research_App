/**
 * CP2 smoke-synthesis script — Validation Workspace sprint Day 4.
 *
 * Runs the 4-phase research pipeline against 2 niches end-to-end and captures
 * the final SynthesisOutput (including the new Validation-Workspace fields:
 * positiveDrivers, negativeDrivers, missingEvidence, nextActions, synthesisClaims)
 * as JSON fixtures under `server/ai/__fixtures__/synthesis-output-*.json`.
 *
 * Prints a compact human-readable review to stdout so the business reviewer
 * can judge quality without scrolling through 4000 chars of reportMarkdown.
 *
 * USAGE:
 *   npx tsx server/ai/__scripts__/smoke-synthesis.ts
 *
 * REQUIREMENTS:
 *   - ANTHROPIC_API_KEY, GEMINI_API_KEY in .env.local
 *   - No DB required — router.ts falls through to ENV/hardcoded model defaults
 *     when getDb() returns null.
 *
 * COST: ~$0.50–$1.00 per run (2 niches × 3 grounded Gemini + 1 Claude synthesis).
 */
import dotenv from "dotenv";
import { resolve } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), ".env.local"), override: true });

// Local shell profiles sometimes export ANTHROPIC_BASE_URL pointing at a proxy
// or a non-/v1 endpoint — the @ai-sdk/anthropic package reads that env var and
// skips its default `https://api.anthropic.com/v1`, which surfaces as 404s on
// streamText. Scrub the variable unless .env.local explicitly sets it so this
// smoke runs against the SDK default regardless of shell config.
if (process.env.ANTHROPIC_BASE_URL && !/\/v1\/?$/.test(process.env.ANTHROPIC_BASE_URL)) {
  console.warn(
    `[smoke] Dropping inherited ANTHROPIC_BASE_URL (missing /v1 suffix) — ` +
      `falling back to @ai-sdk/anthropic default https://api.anthropic.com/v1`,
  );
  delete process.env.ANTHROPIC_BASE_URL;
}

// Import AFTER dotenv + env scrub so any module-level env reads are clean.
import { runPhase1, runPhase2, runPhase3, runPhase4Stream } from "../pipeline-phases";
import type { SynthesisOutput } from "../schemas";

interface NicheInput {
  slug: string;
  nicheName: string;
  description: string;
  strategy: "gaps" | "predator" | "provisioning";
}

const NICHES: NicheInput[] = [
  {
    slug: "beer-dumbbell-coach",
    nicheName: "Beer and Dumbbell Coach",
    description:
      "Kalóriaszámláló és edzés-coach hedonistáknak. Célcsoport: 30-50 éves apukák, akik figyelnek arra mit esznek, de hétvégén szeretnek a haverokkal egy-két korsó sört meginni. Nem fitness-nácik, de tudatosak — egyensúlyra és boldogságra törekvő emberek. Az app nem tilt semmit, hanem heti kalória-keretet ad (beleszámolva a sört is), és ahhoz szab edzéstervet, hogy a cél (pl. 2-3 kg fogyás negyedév alatt) reális legyen az adott életmód mellett.",
    strategy: "gaps",
  },
  {
    slug: "b2b-contract-reviewer-hu",
    nicheName: "AI Contract Reviewer for Hungarian Solo Law Practitioners",
    description:
      "Hungarian-language AI contract review assistant tailored for solo lawyers (egyéni ügyvédek) handling SMB clients. Uploads .docx / .pdf, flags unusual clauses, checks against Magyar Polgári Törvénykönyv conventions, and produces a 1-page risk summary in Hungarian. Priced €30-50/month, positioned NOT as replacing legal judgment but as a speed-up for the 70% boilerplate review work.",
    strategy: "gaps",
  },
];

const FIXTURES_DIR = resolve(process.cwd(), "server/ai/__fixtures__");

async function runOne(niche: NicheInput): Promise<SynthesisOutput> {
  const t0 = Date.now();
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`▶ Running pipeline for: ${niche.nicheName} (${niche.slug})`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  console.log(`  [1/4] Wide Scan (Gemini grounded)...`);
  const p1 = await runPhase1({
    nicheName: niche.nicheName,
    strategy: niche.strategy,
    description: niche.description,
  });
  console.log(`        ✓ keywords=${p1.data.keywords.length}, sources=${p1.sources.length}`);

  console.log(`  [2/4] Gap Detection (Gemini grounded)...`);
  const p2 = await runPhase2({
    nicheName: niche.nicheName,
    strategy: niche.strategy,
    description: niche.description,
    phase1Summary: p1.data.summary,
  });
  console.log(`        ✓ gaps=${p2.data.gaps.length}, competitors=${p2.data.competitors.length}, sources=${p2.sources.length}`);

  console.log(`  [3/4] Deep Dives (Gemini grounded)...`);
  const p3 = await runPhase3({
    nicheName: niche.nicheName,
    strategy: niche.strategy,
    description: niche.description,
    phase2Summary: p2.data.summary,
  });
  console.log(`        ✓ monetization=${p3.data.monetizationModels.length}, challenges=${p3.data.technicalChallenges.length}, sources=${p3.sources.length}`);

  const synthesisContext = [
    `Phase 1 (Wide Scan) summary: ${p1.data.summary}`,
    `Phase 2 (Gap Detection) summary: ${p2.data.summary}`,
    `  Gaps: ${p2.data.gaps.map((g) => g.title).join(", ")}`,
    `  Competitors: ${p2.data.competitors.map((c) => c.name).join(", ")}`,
    `Phase 3 (Deep Dives) summary: ${p3.data.summary}`,
    `  Monetization: ${p3.data.monetizationModels.map((m) => m.name).join(", ")}`,
    `  Technical challenges: ${p3.data.technicalChallenges.map((t) => `${t.title}[${t.severity}]`).join(", ")}`,
  ].join("\n");

  console.log(`  [4/4] Synthesis (Claude Sonnet streaming)...`);
  let partialCount = 0;
  const synth = await runPhase4Stream(
    { nicheName: niche.nicheName, context: synthesisContext },
    () => {
      partialCount++;
    },
  );
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`        ✓ ${partialCount} partial emissions, verdict=${synth.verdict}, synthesisScore=${synth.synthesisScore.toFixed(2)}`);
  console.log(`  ⏱  Total pipeline: ${elapsed}s`);

  return synth;
}

function printReview(niche: NicheInput, synth: SynthesisOutput): void {
  console.log(`\n┌─────────────────────────────────────────────────────────────`);
  console.log(`│ CP2 REVIEW: ${niche.nicheName}`);
  console.log(`├─────────────────────────────────────────────────────────────`);
  console.log(`│ VERDICT: ${synth.verdict}  (synthesisScore: ${synth.synthesisScore.toFixed(2)}/10)`);
  console.log(`│ Scores: marketSize=${synth.scores.marketSize.toFixed(1)} competition=${synth.scores.competition.toFixed(1)} feasibility=${synth.scores.feasibility.toFixed(1)} monetization=${synth.scores.monetization.toFixed(1)} timeliness=${synth.scores.timeliness.toFixed(1)}`);
  console.log(`├─ POSITIVE DRIVERS (${synth.positiveDrivers.length}) ─────────────────`);
  synth.positiveDrivers.forEach((d, i) => console.log(`│  ${i + 1}. ${d}`));
  console.log(`├─ NEGATIVE DRIVERS (${synth.negativeDrivers.length}) ─────────────────`);
  synth.negativeDrivers.forEach((d, i) => console.log(`│  ${i + 1}. ${d}`));
  console.log(`├─ MISSING EVIDENCE (${synth.missingEvidence.length}) ───────────────`);
  if (synth.missingEvidence.length === 0) console.log(`│  (empty — AI claims no material gaps)`);
  synth.missingEvidence.forEach((d, i) => console.log(`│  ${i + 1}. ${d}`));
  console.log(`├─ NEXT ACTIONS (${synth.nextActions.length}) ──────────────────────`);
  synth.nextActions.forEach((d, i) => console.log(`│  ${i + 1}. ${d}`));
  console.log(`├─ SYNTHESIS CLAIMS (${synth.synthesisClaims.length}) ──────────────`);
  synth.synthesisClaims.forEach((c, i) => {
    console.log(`│  ${i + 1}. [${c.stance}, conf=${c.confidence.toFixed(2)}, dim=${c.dimensions.join("/")}]`);
    console.log(`│     ${c.claim}`);
  });
  console.log(`└─────────────────────────────────────────────────────────────`);
}

async function main() {
  await mkdir(FIXTURES_DIR, { recursive: true });

  const results: Array<{ niche: NicheInput; synth: SynthesisOutput | null; error?: string }> = [];

  for (const niche of NICHES) {
    try {
      const synth = await runOne(niche);
      const fixturePath = resolve(FIXTURES_DIR, `synthesis-output-${niche.slug}.json`);
      await writeFile(
        fixturePath,
        JSON.stringify({ niche, capturedAt: new Date().toISOString(), synthesis: synth }, null, 2),
        "utf-8",
      );
      console.log(`  💾 Fixture saved: ${fixturePath}`);
      results.push({ niche, synth });
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error(`  ✗ FAILED: ${msg}`);
      results.push({ niche, synth: null, error: msg });
    }
  }

  console.log(`\n\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║                   CP2 HUMAN REVIEW BELOW                     ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝`);

  for (const r of results) {
    if (r.synth) printReview(r.niche, r.synth);
    else console.log(`\n✗ ${r.niche.nicheName} FAILED: ${r.error}`);
  }

  const failed = results.filter((r) => !r.synth).length;
  console.log(`\n\nSummary: ${results.length - failed}/${results.length} pipelines succeeded.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
