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
  | { type: "synthesis_progress"; partial: unknown }
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
    const allSources: Array<{
      url: string; title: string; snippet: string; sourceType: string; publishedAt: string | null;
    }> = [];

    // ── Phase 1: Wide Scan ────────────────────────────────────────────────
    currentPhase = "wide_scan";
    const phase1Start = Date.now();
    sendEvent(res, { type: "phase_start", phase: currentPhase, label: PHASE_LABELS[currentPhase] });
    sendEvent(res, { type: "agent_action", phase: currentPhase, message: `Kulcsszavak generálása: "${research.nicheName}"` });

    const p1 = await runPhase1({
      nicheName: research.nicheName,
      strategy: research.strategy as "gaps" | "predator" | "provisioning",
      description: research.description ?? undefined,
    }, { abortSignal: makePhaseAbort(currentPhase) });

    for (const src of p1.sources) {
      sendEvent(res, { type: "source_found", url: src.url, title: src.title, sourceType: src.sourceType, publishedAt: src.publishedAt });
      allSources.push({ url: src.url, title: src.title, snippet: src.snippet, sourceType: src.sourceType, publishedAt: src.publishedAt });
    }
    const phase1Duration = Date.now() - phase1Start;
    sendEvent(res, { type: "phase_complete", phase: currentPhase, durationMs: phase1Duration, sourcesFound: p1.sources.length, summary: p1.data.summary });
    if (db) await db.insert(researchPhases).values({ researchId, phase: "wide_scan", status: "done", summary: p1.data.summary, durationMs: phase1Duration, sourcesFound: p1.sources.length });

    // ── Phase 2: Gap Detection ────────────────────────────────────────────
    currentPhase = "gap_detection";
    const phase2Start = Date.now();
    sendEvent(res, { type: "phase_start", phase: currentPhase, label: PHASE_LABELS[currentPhase] });
    sendEvent(res, { type: "agent_action", phase: currentPhase, message: "Piaci rések és versenytársak elemzése..." });

    const p2 = await runPhase2({
      nicheName: research.nicheName,
      strategy: research.strategy as "gaps" | "predator" | "provisioning",
      phase1Summary: p1.data.summary,
    }, { abortSignal: makePhaseAbort(currentPhase) });

    for (const src of p2.sources) {
      sendEvent(res, { type: "source_found", url: src.url, title: src.title, sourceType: src.sourceType, publishedAt: src.publishedAt });
      allSources.push({ url: src.url, title: src.title, snippet: src.snippet, sourceType: src.sourceType, publishedAt: src.publishedAt });
    }
    const phase2Duration = Date.now() - phase2Start;
    sendEvent(res, { type: "phase_complete", phase: currentPhase, durationMs: phase2Duration, sourcesFound: p2.sources.length, summary: p2.data.summary });
    if (db) await db.insert(researchPhases).values({ researchId, phase: "gap_detection", status: "done", summary: p2.data.summary, durationMs: phase2Duration, sourcesFound: p2.sources.length });

    // ── Phase 3: Deep Dives ───────────────────────────────────────────────
    currentPhase = "deep_dives";
    const phase3Start = Date.now();
    sendEvent(res, { type: "phase_start", phase: currentPhase, label: PHASE_LABELS[currentPhase] });
    sendEvent(res, { type: "agent_action", phase: currentPhase, message: "Mélyebb elemzés: monetizáció, megvalósíthatóság..." });

    const p3 = await runPhase3({
      nicheName: research.nicheName,
      strategy: research.strategy as "gaps" | "predator" | "provisioning",
      phase2Summary: p2.data.summary,
    }, { abortSignal: makePhaseAbort(currentPhase) });

    for (const src of p3.sources) {
      sendEvent(res, { type: "source_found", url: src.url, title: src.title, sourceType: src.sourceType, publishedAt: src.publishedAt });
      allSources.push({ url: src.url, title: src.title, snippet: src.snippet, sourceType: src.sourceType, publishedAt: src.publishedAt });
    }
    const phase3Duration = Date.now() - phase3Start;
    sendEvent(res, { type: "phase_complete", phase: currentPhase, durationMs: phase3Duration, sourcesFound: p3.sources.length, summary: p3.data.summary });
    if (db) await db.insert(researchPhases).values({ researchId, phase: "deep_dives", status: "done", summary: p3.data.summary, durationMs: phase3Duration, sourcesFound: p3.sources.length });

    // ── Phase 4: Synthesis (streaming) ────────────────────────────────────
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
      { abortSignal: makePhaseAbort(currentPhase) },
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
        } catch {
          // duplicate URL or schema mismatch — skip individual row
        }
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
