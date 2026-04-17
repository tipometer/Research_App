/**
 * Research Pipeline — SSE Streaming Endpoint
 * All AI calls happen server-side only. Never exposed to the browser.
 */
import type { Request, Response } from "express";
import { invokeLLM } from "./_core/llm";
import {
  getResearchById,
  updateResearch,
  logAudit,
  addCredit,
  getDb,
} from "./db";
import { sources, researchPhases } from "../drizzle/schema";

type SseEvent =
  | { type: "phase_start"; phase: string; label: string }
  | { type: "agent_action"; phase: string; message: string }
  | { type: "source_found"; url: string; title: string; sourceType: string; publishedAt: string }
  | { type: "phase_complete"; phase: string; durationMs: number; sourcesFound: number; summary: string }
  | { type: "pipeline_complete"; verdict: string; synthesisScore: number; reportMarkdown: string; scores: Record<string, number> }
  | { type: "pipeline_error"; message: string };

function sendEvent(res: Response, event: SseEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

const PHASE_LABELS: Record<string, string> = {
  wide_scan: "Wide Scan",
  gap_detection: "Gap Detection",
  deep_dives: "Deep Dives",
  synthesis: "Synthesis",
};

export async function runResearchPipeline(req: Request, res: Response) {
  const researchId = parseInt(req.params.id ?? "0");
  const userId = (req as any).user?.id;

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

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

  try {
    const db = await getDb();
    const allSources: Array<{ url: string; title: string; snippet: string; sourceType: string; publishedAt: string }> = [];

    // ── Phase 1: Wide Scan ────────────────────────────────────────────────────
    const phase1Start = Date.now();
    sendEvent(res, { type: "phase_start", phase: "wide_scan", label: PHASE_LABELS.wide_scan });
    sendEvent(res, { type: "agent_action", phase: "wide_scan", message: `Kulcsszavak generálása: "${research.nicheName}"` });

    const wideScanResponse = await invokeLLM({
      messages: [
        { role: "system", content: "You are a market research expert. Return valid JSON only." },
        {
          role: "user",
          content: `Perform a wide scan market analysis for this niche: "${research.nicheName}". Strategy: ${research.strategy}.
          
Return JSON with:
- keywords: array of 5 search keywords used
- sources: array of 5 sources (url, title, snippet, sourceType: "academic"|"industry"|"news"|"blog"|"community", publishedAt: "YYYY-MM" or "YYYY")
- summary: 2-3 sentence summary of findings`,
        },
      ],
    });

    const wideScanContent = wideScanResponse.choices?.[0]?.message?.content ?? "{}";
    let wideScanData: any = {};
    try { wideScanData = JSON.parse(typeof wideScanContent === "string" ? wideScanContent : "{}"); } catch {}

    const wideSources = wideScanData.sources ?? [];
    for (const src of wideSources) {
      sendEvent(res, { type: "agent_action", phase: "wide_scan", message: `Forrás megtalálva: ${src.title ?? src.url}` });
      sendEvent(res, { type: "source_found", url: src.url ?? "#", title: src.title ?? "Ismeretlen forrás", sourceType: src.sourceType ?? "blog", publishedAt: src.publishedAt ?? "" });
      allSources.push(src);
    }

    const phase1Duration = Date.now() - phase1Start;
    sendEvent(res, { type: "phase_complete", phase: "wide_scan", durationMs: phase1Duration, sourcesFound: wideSources.length, summary: wideScanData.summary ?? "" });

    if (db) {
      await db.insert(researchPhases).values({ researchId, phase: "wide_scan", status: "done", summary: wideScanData.summary, durationMs: phase1Duration, sourcesFound: wideSources.length });
    }

    // ── Phase 2: Gap Detection ────────────────────────────────────────────────
    const phase2Start = Date.now();
    sendEvent(res, { type: "phase_start", phase: "gap_detection", label: PHASE_LABELS.gap_detection });
    sendEvent(res, { type: "agent_action", phase: "gap_detection", message: "Piaci rések és versenytársak elemzése..." });

    const gapResponse = await invokeLLM({
      messages: [
        { role: "system", content: "You are a market research expert. Return valid JSON only." },
        {
          role: "user",
          content: `Based on the wide scan of "${research.nicheName}", identify market gaps and underserved segments.
          
Return JSON with:
- gaps: array of 3 market gaps (title, description)
- competitors: array of 3 competitors (name, weakness)
- sources: array of 3 additional sources (url, title, snippet, sourceType, publishedAt)
- summary: 2-3 sentence summary`,
        },
      ],
    });

    const gapContent = gapResponse.choices?.[0]?.message?.content ?? "{}";
    let gapData: any = {};
    try { gapData = JSON.parse(typeof gapContent === "string" ? gapContent : "{}"); } catch {}

    const gapSources = gapData.sources ?? [];
    for (const src of gapSources) {
      sendEvent(res, { type: "agent_action", phase: "gap_detection", message: `Versenytárs azonosítva: ${src.title ?? src.url}` });
      sendEvent(res, { type: "source_found", url: src.url ?? "#", title: src.title ?? "Ismeretlen forrás", sourceType: src.sourceType ?? "industry", publishedAt: src.publishedAt ?? "" });
      allSources.push(src);
    }

    const phase2Duration = Date.now() - phase2Start;
    sendEvent(res, { type: "phase_complete", phase: "gap_detection", durationMs: phase2Duration, sourcesFound: gapSources.length, summary: gapData.summary ?? "" });

    if (db) {
      await db.insert(researchPhases).values({ researchId, phase: "gap_detection", status: "done", summary: gapData.summary, durationMs: phase2Duration, sourcesFound: gapSources.length });
    }

    // ── Phase 3: Deep Dives ───────────────────────────────────────────────────
    const phase3Start = Date.now();
    sendEvent(res, { type: "phase_start", phase: "deep_dives", label: PHASE_LABELS.deep_dives });
    sendEvent(res, { type: "agent_action", phase: "deep_dives", message: "Mélyebb elemzés: monetizáció, megvalósíthatóság..." });

    const deepResponse = await invokeLLM({
      messages: [
        { role: "system", content: "You are a market research expert. Return valid JSON only." },
        {
          role: "user",
          content: `Perform deep dives on "${research.nicheName}" focusing on monetization models, technical feasibility, and market timing.
          
Return JSON with:
- monetizationModels: array of 3 models (name, description, revenueEstimate)
- technicalChallenges: array of 3 challenges (title, severity: "low"|"medium"|"high")
- sources: array of 4 sources (url, title, snippet, sourceType, publishedAt)
- summary: 2-3 sentence summary`,
        },
      ],
    });

    const deepContent = deepResponse.choices?.[0]?.message?.content ?? "{}";
    let deepData: any = {};
    try { deepData = JSON.parse(typeof deepContent === "string" ? deepContent : "{}"); } catch {}

    const deepSources = deepData.sources ?? [];
    for (const src of deepSources) {
      sendEvent(res, { type: "agent_action", phase: "deep_dives", message: `Elemzés: ${src.title ?? src.url}` });
      sendEvent(res, { type: "source_found", url: src.url ?? "#", title: src.title ?? "Ismeretlen forrás", sourceType: src.sourceType ?? "academic", publishedAt: src.publishedAt ?? "" });
      allSources.push(src);
    }

    const phase3Duration = Date.now() - phase3Start;
    sendEvent(res, { type: "phase_complete", phase: "deep_dives", durationMs: phase3Duration, sourcesFound: deepSources.length, summary: deepData.summary ?? "" });

    if (db) {
      await db.insert(researchPhases).values({ researchId, phase: "deep_dives", status: "done", summary: deepData.summary, durationMs: phase3Duration, sourcesFound: deepSources.length });
    }

    // ── Phase 4: Synthesis ────────────────────────────────────────────────────
    const phase4Start = Date.now();
    sendEvent(res, { type: "phase_start", phase: "synthesis", label: PHASE_LABELS.synthesis });
    sendEvent(res, { type: "agent_action", phase: "synthesis", message: "Összefoglalás és verdikt generálása..." });

    const synthesisResponse = await invokeLLM({
      messages: [
        { role: "system", content: "You are a senior market research analyst. Return valid JSON only." },
        {
          role: "user",
          content: `Synthesize all research findings for "${research.nicheName}" and produce a final verdict.

Return JSON with:
- verdict: "GO" | "KILL" | "CONDITIONAL"
- synthesisScore: number 0-10 (one decimal)
- scores: { marketSize: 0-10, competition: 0-10, feasibility: 0-10, monetization: 0-10, timeliness: 0-10 }
- reportMarkdown: full markdown report (min 800 words) with sections: ## Összefoglalás, ## Piaci Lehetőség, ## Versenyhelyzet, ## Megvalósíthatóság, ## Monetizáció, ## Időszerűség, ## Következő Lépések, ## Validációs Kérdések
- verdictReason: 2-3 sentence explanation of the verdict`,
        },
      ],
    });

    const synthContent = synthesisResponse.choices?.[0]?.message?.content ?? "{}";
    let synthData: any = {};
    try { synthData = JSON.parse(typeof synthContent === "string" ? synthContent : "{}"); } catch {}

    const scores = synthData.scores ?? { marketSize: 5, competition: 5, feasibility: 5, monetization: 5, timeliness: 5 };
    const verdict = (["GO", "KILL", "CONDITIONAL"].includes(synthData.verdict) ? synthData.verdict : "CONDITIONAL") as "GO" | "KILL" | "CONDITIONAL";
    const synthesisScore = Math.min(10, Math.max(0, parseFloat(synthData.synthesisScore ?? "5")));

    const phase4Duration = Date.now() - phase4Start;
    sendEvent(res, { type: "phase_complete", phase: "synthesis", durationMs: phase4Duration, sourcesFound: 0, summary: synthData.verdictReason ?? "" });

    if (db) {
      await db.insert(researchPhases).values({ researchId, phase: "synthesis", status: "done", summary: synthData.verdictReason, durationMs: phase4Duration, sourcesFound: 0 });
    }

    // Save all sources to DB
    if (db && allSources.length > 0) {
      for (const src of allSources) {
        try {
          await db.insert(sources).values({
            researchId,
            url: src.url ?? "#",
            title: src.title ?? null,
            snippet: src.snippet ?? null,
            sourceType: (["academic", "industry", "news", "blog", "community"].includes(src.sourceType) ? src.sourceType : "blog") as any,
            publishedAt: src.publishedAt ?? null,
            relevanceScore: "0.75",
          });
        } catch {}
      }
    }

    // Update research record
    await updateResearch(researchId, {
      status: "done",
      verdict,
      synthesisScore: synthesisScore.toFixed(2) as any,
      scoreMarketSize: scores.marketSize?.toFixed(2) as any,
      scoreCompetition: scores.competition?.toFixed(2) as any,
      scoreFeasibility: scores.feasibility?.toFixed(2) as any,
      scoreMonetization: scores.monetization?.toFixed(2) as any,
      scoreTimeliness: scores.timeliness?.toFixed(2) as any,
      reportMarkdown: synthData.reportMarkdown ?? "",
      completedAt: new Date(),
    });

    sendEvent(res, {
      type: "pipeline_complete",
      verdict,
      synthesisScore,
      reportMarkdown: synthData.reportMarkdown ?? "",
      scores,
    });

    await logAudit(userId, "research.complete", { researchId, verdict, synthesisScore }, req);

  } catch (error: any) {
    console.error("[Pipeline] Error:", error);
    sendEvent(res, { type: "pipeline_error", message: error?.message ?? "Ismeretlen hiba" });

    // Refund credit on failure
    await updateResearch(researchId, { status: "failed", errorMessage: error?.message ?? "Unknown error" });
    await addCredit(userId, research.creditsUsed, "Automatikus visszatérítés — sikertelen kutatás");
    await logAudit(userId, "research.failed", { researchId, error: error?.message }, req);
  } finally {
    res.end();
  }
}
