import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import {
  getDb,
  getResearches,
  getResearchById,
  createResearch,
  updateResearch,
  getResearchSources,
  getUserCredits,
  deductCredit,
  addCredit,
  getCreditTransactions,
  getBrainstormSessions,
  createBrainstormSession,
  getUsers,
  getAuditLogs,
  logAudit,
  getSurveyByToken,
  createSurveyResponse,
  getSurveyByResearchId,
  createSurvey,
} from "./db";
import { runBrainstorm, runPolling } from "./ai/pipeline-phases";
import { getProvider, type ProviderId } from "./ai/providers";
import { eq } from "drizzle-orm";
import { aiConfigs, modelRouting } from "../drizzle/schema";
import { generateText } from "ai";
import { nanoid } from "nanoid";

// In-memory rate limit for admin.ai.testProvider — 10s cooldown per (userId, provider)
const testProviderCooldown = new Map<string, number>();
const TEST_PROVIDER_COOLDOWN_MS = 10_000;

// ─── Admin procedure ──────────────────────────────────────────────────────────
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

export const appRouter = router({
  system: systemRouter,

  // ─── Auth ──────────────────────────────────────────────────────────────────
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── User ──────────────────────────────────────────────────────────────────
  user: router({
    credits: protectedProcedure.query(async ({ ctx }) => {
      return await getUserCredits(ctx.user.id);
    }),
    transactions: protectedProcedure.query(async ({ ctx }) => {
      return await getCreditTransactions(ctx.user.id);
    }),
  }),

  // ─── Research ──────────────────────────────────────────────────────────────
  research: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return await getResearches(ctx.user.id);
    }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const research = await getResearchById(input.id);
        if (!research) throw new TRPCError({ code: "NOT_FOUND" });
        if (research.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const sources = await getResearchSources(input.id);
        return { ...research, sources };
      }),

    getByShareToken: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const { getResearchByShareToken } = await import("./db");
        const research = await getResearchByShareToken(input.token);
        if (!research) throw new TRPCError({ code: "NOT_FOUND" });
        const sources = await getResearchSources(research.id);
        return { ...research, sources };
      }),

    create: protectedProcedure
      .input(z.object({
        nicheName: z.string().min(3).max(256),
        description: z.string().max(2000).optional(),
        strategy: z.enum(["gaps", "predator", "provisioning"]),
        batchMode: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Credit check
        const credits = await getUserCredits(ctx.user.id);
        const cost = input.batchMode ? 3 : 1;
        if (credits < cost) {
          throw new TRPCError({ code: "PAYMENT_REQUIRED", message: "Insufficient credits" });
        }

        // Deduct credit
        await deductCredit(ctx.user.id, cost, "Kutatás indítása");

        // Create research record
        const shareToken = nanoid(32);
        const id = await createResearch({
          userId: ctx.user.id,
          nicheName: input.nicheName,
          description: input.description ?? null,
          strategy: input.strategy,
          shareToken,
          creditsUsed: cost,
        });

        await logAudit(ctx.user.id, "research.create", { researchId: id, nicheName: input.nicheName }, ctx.req);

        return { id, shareToken };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const research = await getResearchById(input.id);
        if (!research) throw new TRPCError({ code: "NOT_FOUND" });
        if (research.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const { deleteResearch } = await import("./db");
        await deleteResearch(input.id);
        return { success: true };
      }),
  }),

  // ─── Brainstorm ────────────────────────────────────────────────────────────
  brainstorm: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return await getBrainstormSessions(ctx.user.id);
    }),

    generate: protectedProcedure
      .input(z.object({
        context: z.string().min(10).max(1000),
        refinement: z.string().max(500).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Cost: 0.25 credits — deduct 1 per 4 sessions (simplified: deduct 1 per call for now)
        const credits = await getUserCredits(ctx.user.id);
        if (credits < 1) throw new TRPCError({ code: "PAYMENT_REQUIRED", message: "Insufficient credits" });

        const context = input.context + (input.refinement ? `\nRefinement: ${input.refinement}` : "");

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(new Error("Brainstorm timeout")), 60_000);
        let ideas: Awaited<ReturnType<typeof runBrainstorm>>["ideas"];
        try {
          const result = await runBrainstorm(
            { context },
            { abortSignal: controller.signal },
          );
          ideas = result.ideas;
        } finally {
          clearTimeout(timeout);
        }

        // Save session
        await createBrainstormSession(ctx.user.id, input.context, ideas);
        await deductCredit(ctx.user.id, 1, "Brainstorm generálás");

        return { ideas };
      }),
  }),

  // ─── Survey ────────────────────────────────────────────────────────────────
  survey: router({
    getByToken: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const survey = await getSurveyByToken(input.token);
        if (!survey) throw new TRPCError({ code: "NOT_FOUND" });
        return survey;
      }),

    getByResearch: protectedProcedure
      .input(z.object({ researchId: z.number() }))
      .query(async ({ ctx, input }) => {
        const research = await getResearchById(input.researchId);
        if (!research || research.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
        return await getSurveyByResearchId(input.researchId);
      }),

    create: protectedProcedure
      .input(z.object({ researchId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const research = await getResearchById(input.researchId);
        if (!research || research.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
        if (research.status !== "done") throw new TRPCError({ code: "BAD_REQUEST", message: "Research must be completed first" });

        // Generate survey questions via AI
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(new Error("Polling timeout")), 60_000);
        let questions: Awaited<ReturnType<typeof runPolling>>["questions"];
        try {
          const result = await runPolling(
            {
              nicheName: research.nicheName,
              report: research.reportMarkdown ?? "",
            },
            { abortSignal: controller.signal },
          );
          questions = result.questions;
        } finally {
          clearTimeout(timeout);
        }

        const token = nanoid(32);
        const id = await createSurvey(input.researchId, token, questions);
        return { id, token };
      }),

    respond: publicProcedure
      .input(z.object({
        token: z.string(),
        answers: z.record(z.string(), z.string()),
      }))
      .mutation(async ({ input }) => {
        const survey = await getSurveyByToken(input.token);
        if (!survey || !survey.isActive) throw new TRPCError({ code: "NOT_FOUND" });
        await createSurveyResponse(survey.id, input.answers);
        return { success: true };
      }),
  }),

  // ─── Admin ─────────────────────────────────────────────────────────────────
  admin: router({
    users: adminProcedure.query(async () => {
      return await getUsers();
    }),

    auditLogs: adminProcedure
      .input(z.object({ limit: z.number().default(50) }))
      .query(async ({ input }) => {
        return await getAuditLogs(input.limit);
      }),

    adjustCredits: adminProcedure
      .input(z.object({ userId: z.number(), amount: z.number(), reason: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (input.amount > 0) {
          await addCredit(input.userId, input.amount, input.reason);
        } else {
          await deductCredit(input.userId, Math.abs(input.amount), input.reason);
        }
        await logAudit(ctx.user.id, "admin.adjust_credits", { targetUserId: input.userId, amount: input.amount }, ctx.req);
        return { success: true };
      }),

    // ─── AI Config ───────────────────────────────────────────────────────────
    ai: router({
      listConfigs: adminProcedure.query(async () => {
        const db = await getDb();
        if (!db) return [];
        const rows = await db.select().from(aiConfigs);
        // NEVER return apiKey — only masked presence flag
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
          if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No DB" });
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
          await logAudit(
            ctx.user.id,
            "admin.ai.setProviderKey",
            { provider: input.provider, isActive: input.isActive },
            ctx.req,
          );
          return { success: true };
        }),

      testProvider: adminProcedure
        .input(z.object({
          provider: z.enum(["openai", "anthropic", "gemini"]),
        }))
        .mutation(async ({ input, ctx }) => {
          const cooldownKey = `${ctx.user.id}:${input.provider}`;
          const lastCall = testProviderCooldown.get(cooldownKey);
          const now = Date.now();
          if (lastCall && now - lastCall < TEST_PROVIDER_COOLDOWN_MS) {
            const remainingSec = Math.ceil((TEST_PROVIDER_COOLDOWN_MS - (now - lastCall)) / 1000);
            return { ok: false, error: `Rate limited — please wait ${remainingSec}s before testing ${input.provider} again.` };
          }
          testProviderCooldown.set(cooldownKey, now);

          const db = await getDb();
          if (!db) return { ok: false, error: "No DB connection" };
          const rows = await db.select().from(aiConfigs).where(eq(aiConfigs.provider, input.provider)).limit(1);
          const apiKey = rows[0]?.apiKey;
          if (!apiKey) return { ok: false, error: "No API key set" };

          try {
            const client = getProvider(input.provider as ProviderId, apiKey);
            const defaultModel =
              input.provider === "openai"    ? "gpt-4.1-mini" :
              input.provider === "anthropic" ? "claude-sonnet-4-6" :
                                               "gemini-2.5-flash";
            await generateText({
              model: client(defaultModel),
              messages: [{ role: "user", content: "Reply with exactly one word: OK" }],
            });
            return { ok: true };
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return { ok: false, error: message };
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
          if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No DB" });
          const existing = await db.select().from(modelRouting).where(eq(modelRouting.phase, input.phase)).limit(1);
          if (existing.length > 0) {
            await db.update(modelRouting).set({
              primaryModel: input.primaryModel,
              fallbackModel: input.fallbackModel ?? null,
              systemPrompt: input.systemPrompt ?? existing[0]!.systemPrompt,
            }).where(eq(modelRouting.phase, input.phase));
          } else {
            await db.insert(modelRouting).values({
              phase: input.phase,
              primaryModel: input.primaryModel,
              fallbackModel: input.fallbackModel,
              systemPrompt: input.systemPrompt,
            });
          }
          await logAudit(
            ctx.user.id,
            "admin.ai.updateRouting",
            { phase: input.phase, primaryModel: input.primaryModel },
            ctx.req,
          );
          return { success: true };
        }),
    }),
  }),
});

export type AppRouter = typeof appRouter;
