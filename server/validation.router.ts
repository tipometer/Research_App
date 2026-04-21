/**
 * Validation Workspace tRPC router (sprint V2 — scope §5.4).
 *
 * Three read-only endpoints over the new `evidence` and `decision_snapshots`
 * tables. All authenticated, all IDOR-protected via an ownership check against
 * the parent `researches` row (matches the pattern from `research.router.ts`).
 *
 *   - validation.getSnapshot({ researchId, version? })
 *       → DecisionSnapshot for the given research (latest if version omitted)
 *
 *   - validation.listEvidence({ researchId, dimension?, stance?, type? })
 *       → Evidence[] matching the filters (dimension is contained-in check)
 *
 *   - validation.getEvidenceByDimension({ researchId })
 *       → Record<Dimension, Evidence[]> — the same evidence bucketed per
 *         dimension (one evidence may appear in multiple buckets).
 *
 * The router is wired into `appRouter` in `routers.ts` as `validation`.
 */
import { and, eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb, getResearchById } from "./db";
import { evidence, decisionSnapshots } from "../drizzle/schema";
import type { Evidence, DecisionSnapshot } from "../drizzle/schema";

// ─── Input schemas ──────────────────────────────────────────────────────────

const DimensionInput = z.enum([
  "market_size",
  "competition",
  "feasibility",
  "monetization",
  "timeliness",
]);
type DimensionInputType = z.infer<typeof DimensionInput>;

const StanceInput = z.enum(["supports", "weakens", "neutral"]);
const TypeInput = z.enum(["web_source", "synthesis_claim"]);

const DIMENSIONS: readonly DimensionInputType[] = [
  "market_size",
  "competition",
  "feasibility",
  "monetization",
  "timeliness",
] as const;

// ─── IDOR helper ────────────────────────────────────────────────────────────
//
// Fetch the research row and enforce ownership (or admin role). Every
// validation endpoint begins with this check — consistent with the pattern
// in research.router.ts so the security review surface is uniform.

async function requireResearchAccess(researchId: number, userId: number, userRole: string) {
  const research = await getResearchById(researchId);
  if (!research) throw new TRPCError({ code: "NOT_FOUND", message: "Research not found" });
  if (research.userId !== userId && userRole !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not your research" });
  }
  return research;
}

// ─── In-memory dimension filter ─────────────────────────────────────────────
//
// Drizzle MySQL does not have a first-class JSON array-contains helper in the
// version this project pins; `dimensions` is stored as JSON. Rather than
// shipping a raw-SQL JSON_CONTAINS fragment (scope §10 forbids raw SQL), we
// narrow the result set in JS — evidence counts per research are small
// (target: 5-15 web_source + 3-8 synthesis_claim per CP3 sanity check).

function matchesDimension(row: Evidence, want: DimensionInputType): boolean {
  const dims = row.dimensions;
  if (!Array.isArray(dims)) return false;
  return dims.includes(want);
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const validationRouter = router({
  /**
   * Fetch one decision snapshot. If `version` is omitted, returns the latest
   * (highest evidenceVersion, tie-broken by createdAt DESC). For v1 of the
   * sprint evidenceVersion is always 1; future recompute sprints will bump it.
   */
  getSnapshot: protectedProcedure
    .input(z.object({ researchId: z.number().int().positive(), version: z.number().int().positive().optional() }))
    .query(async ({ ctx, input }): Promise<DecisionSnapshot> => {
      await requireResearchAccess(input.researchId, ctx.user.id, ctx.user.role);

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const where = input.version !== undefined
        ? and(eq(decisionSnapshots.researchId, input.researchId), eq(decisionSnapshots.evidenceVersion, input.version))
        : eq(decisionSnapshots.researchId, input.researchId);

      const rows = await db
        .select()
        .from(decisionSnapshots)
        .where(where)
        .orderBy(desc(decisionSnapshots.evidenceVersion), desc(decisionSnapshots.createdAt))
        .limit(1);

      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No decision snapshot for this research yet" });
      }
      return rows[0];
    }),

  /**
   * List evidence rows for a research, optionally narrowed by dimension,
   * stance, or type. Dimension matching is contains-check over the JSON array.
   */
  listEvidence: protectedProcedure
    .input(z.object({
      researchId: z.number().int().positive(),
      dimension: DimensionInput.optional(),
      stance: StanceInput.optional(),
      type: TypeInput.optional(),
    }))
    .query(async ({ ctx, input }): Promise<Evidence[]> => {
      await requireResearchAccess(input.researchId, ctx.user.id, ctx.user.role);

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const conditions = [eq(evidence.researchId, input.researchId)];
      if (input.stance) conditions.push(eq(evidence.stance, input.stance));
      if (input.type) conditions.push(eq(evidence.type, input.type));

      const rows = await db
        .select()
        .from(evidence)
        .where(and(...conditions))
        .orderBy(desc(evidence.createdAt));

      if (input.dimension) {
        return rows.filter((r) => matchesDimension(r, input.dimension as DimensionInputType));
      }
      return rows;
    }),

  /**
   * Return evidence bucketed by dimension. One evidence can appear in multiple
   * buckets. Evidence with empty `dimensions` (typically web_source rows that
   * the mapper couldn't tag) are NOT included in any bucket — they're still
   * reachable via listEvidence with no dimension filter.
   */
  getEvidenceByDimension: protectedProcedure
    .input(z.object({ researchId: z.number().int().positive() }))
    .query(async ({ ctx, input }): Promise<Record<DimensionInputType, Evidence[]>> => {
      await requireResearchAccess(input.researchId, ctx.user.id, ctx.user.role);

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const rows = await db
        .select()
        .from(evidence)
        .where(eq(evidence.researchId, input.researchId))
        .orderBy(desc(evidence.createdAt));

      const buckets: Record<DimensionInputType, Evidence[]> = {
        market_size: [],
        competition: [],
        feasibility: [],
        monetization: [],
        timeliness: [],
      };
      for (const row of rows) {
        for (const dim of DIMENSIONS) {
          if (matchesDimension(row, dim)) buckets[dim].push(row);
        }
      }
      return buckets;
    }),
});
