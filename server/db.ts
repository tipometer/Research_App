import { eq, desc, and } from "drizzle-orm";
import { drizzle, MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  users, InsertUser,
  researches, InsertResearch,
  researchPhases,
  sources,
  surveys,
  surveyResponses,
  creditTransactions,
  brainstormSessions,
  auditLogs,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: MySql2Database | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      // TLS mandatory for non-local hosts (TiDB Serverless requires TLS).
      // Local MySQL (not currently used) can go plain.
      const isLocal = /@(localhost|127\.0\.0\.1)(:|\/|$)/.test(process.env.DATABASE_URL);
      const pool = mysql.createPool({
        uri: process.env.DATABASE_URL,
        ssl: isLocal ? undefined : { minVersion: "TLSv1.2", rejectUnauthorized: true },
        connectionLimit: 10,
        waitForConnections: true,
      });
      _db = drizzle(pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).orderBy(desc(users.createdAt));
}

export async function getUserCredits(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ credits: users.credits }).from(users).where(eq(users.id, userId)).limit(1);
  return result[0]?.credits ?? 0;
}

// ─── Credits ──────────────────────────────────────────────────────────────────

export async function deductCredit(userId: number, amount: number, description: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ credits: (users.credits as any) - amount }).where(eq(users.id, userId));
  await db.insert(creditTransactions).values({ userId, amount: -amount, type: "usage", description });
}

export async function addCredit(userId: number, amount: number, description: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ credits: (users.credits as any) + amount }).where(eq(users.id, userId));
  await db.insert(creditTransactions).values({ userId, amount, type: "purchase", description });
}

export async function getCreditTransactions(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(creditTransactions).where(eq(creditTransactions.userId, userId)).orderBy(desc(creditTransactions.createdAt)).limit(50);
}

// ─── Researches ───────────────────────────────────────────────────────────────

export async function getResearches(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(researches).where(eq(researches.userId, userId)).orderBy(desc(researches.createdAt));
}

export async function getResearchById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(researches).where(eq(researches.id, id)).limit(1);
  return result[0] ?? undefined;
}

export async function getResearchByShareToken(token: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(researches).where(eq(researches.shareToken, token)).limit(1);
  return result[0] ?? undefined;
}

export async function createResearch(data: Omit<InsertResearch, "id" | "status" | "createdAt" | "updatedAt">): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(researches).values({ ...data, status: "pending" });
  return (result as any)[0]?.insertId ?? 0;
}

export async function updateResearch(id: number, data: Partial<InsertResearch>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(researches).set(data).where(eq(researches.id, id));
}

export async function deleteResearch(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(researches).where(eq(researches.id, id));
}

// ─── Sources ──────────────────────────────────────────────────────────────────

export async function getResearchSources(researchId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(sources).where(eq(sources.researchId, researchId)).orderBy(desc(sources.relevanceScore));
}

// ─── Surveys ──────────────────────────────────────────────────────────────────

export async function getSurveyByToken(token: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(surveys).where(eq(surveys.token, token)).limit(1);
  return result[0] ?? undefined;
}

export async function getSurveyByResearchId(researchId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(surveys).where(eq(surveys.researchId, researchId)).limit(1);
  return result[0] ?? undefined;
}

export async function createSurvey(researchId: number, token: string, questions: unknown[]): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(surveys).values({ researchId, token, questions });
  return (result as any)[0]?.insertId ?? 0;
}

export async function createSurveyResponse(surveyId: number, answers: Record<string, string>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(surveyResponses).values({ surveyId, answers });
  await db.update(surveys).set({ responseCount: (surveys.responseCount as any) + 1 }).where(eq(surveys.id, surveyId));
}

// ─── Brainstorm ───────────────────────────────────────────────────────────────

export async function getBrainstormSessions(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(brainstormSessions).where(eq(brainstormSessions.userId, userId)).orderBy(desc(brainstormSessions.createdAt)).limit(20);
}

export async function createBrainstormSession(userId: number, context: string, ideas: unknown[]): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(brainstormSessions).values({ userId, context, ideas });
  return (result as any)[0]?.insertId ?? 0;
}

// ─── Audit Logs ───────────────────────────────────────────────────────────────

export async function logAudit(
  userId: number | null,
  action: string,
  details: Record<string, unknown>,
  req?: { headers?: Record<string, string | string[] | undefined>; ip?: string }
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const ipAddress = req?.ip ?? (req?.headers?.["x-forwarded-for"] as string) ?? null;
  const userAgent = (req?.headers?.["user-agent"] as string) ?? null;
  await db.insert(auditLogs).values({ userId, action, details, ipAddress, userAgent });
}

export async function getAuditLogs(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
}
