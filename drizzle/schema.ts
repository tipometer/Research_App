import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  boolean,
  decimal,
  json,
  date,
  index,
} from "drizzle-orm/mysql-core";

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  credits: int("credits").default(0).notNull(),
  language: mysqlEnum("language", ["hu", "en"]).default("hu").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Researches ───────────────────────────────────────────────────────────────
export const researches = mysqlTable("researches", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  nicheName: varchar("nicheName", { length: 512 }).notNull(),
  description: text("description"),
  strategy: mysqlEnum("strategy", ["gaps", "predator", "provisioning"]).default("gaps").notNull(),
  status: mysqlEnum("status", ["pending", "running", "done", "failed"]).default("pending").notNull(),
  verdict: mysqlEnum("verdict", ["GO", "KILL", "CONDITIONAL"]),
  // 5-axis radar scores (0-10)
  scoreMarketSize: decimal("scoreMarketSize", { precision: 4, scale: 2 }),
  scoreCompetition: decimal("scoreCompetition", { precision: 4, scale: 2 }),
  scoreFeasibility: decimal("scoreFeasibility", { precision: 4, scale: 2 }),
  scoreMonetization: decimal("scoreMonetization", { precision: 4, scale: 2 }),
  scoreTimeliness: decimal("scoreTimeliness", { precision: 4, scale: 2 }),
  synthesisScore: decimal("synthesisScore", { precision: 4, scale: 2 }),
  reportMarkdown: text("reportMarkdown"),
  shareToken: varchar("shareToken", { length: 64 }).unique(),
  creditsUsed: int("creditsUsed").default(1).notNull(),
  errorMessage: text("errorMessage"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Research = typeof researches.$inferSelect;
export type InsertResearch = typeof researches.$inferInsert;

// ─── Research Phases ──────────────────────────────────────────────────────────
export const researchPhases = mysqlTable("research_phases", {
  id: int("id").autoincrement().primaryKey(),
  researchId: int("researchId").notNull(),
  phase: mysqlEnum("phase", ["wide_scan", "gap_detection", "deep_dives", "synthesis"]).notNull(),
  status: mysqlEnum("status", ["pending", "running", "done", "failed"]).default("pending").notNull(),
  summary: text("summary"),
  durationMs: int("durationMs"),
  sourcesFound: int("sourcesFound").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ResearchPhase = typeof researchPhases.$inferSelect;

// ─── Sources ──────────────────────────────────────────────────────────────────
export const sources = mysqlTable("sources", {
  id: int("id").autoincrement().primaryKey(),
  researchId: int("researchId").notNull(),
  phaseId: int("phaseId"),
  url: text("url").notNull(),
  title: text("title"),
  snippet: text("snippet"),
  sourceType: mysqlEnum("sourceType", ["academic", "industry", "news", "blog", "community"]).default("blog").notNull(),
  publishedAt: varchar("publishedAt", { length: 32 }),
  relevanceScore: decimal("relevanceScore", { precision: 3, scale: 2 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Source = typeof sources.$inferSelect;

// ─── Surveys ──────────────────────────────────────────────────────────────────
export const surveys = mysqlTable("surveys", {
  id: int("id").autoincrement().primaryKey(),
  researchId: int("researchId").notNull(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  questions: json("questions").notNull(), // Array of { id, type, text, options? }
  responseCount: int("responseCount").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  synthesisUpdatedAt: timestamp("synthesisUpdatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Survey = typeof surveys.$inferSelect;

// ─── Survey Responses ─────────────────────────────────────────────────────────
export const surveyResponses = mysqlTable("survey_responses", {
  id: int("id").autoincrement().primaryKey(),
  surveyId: int("surveyId").notNull(),
  answers: json("answers").notNull(), // { questionId: answer }
  submittedAt: timestamp("submittedAt").defaultNow().notNull(),
});

export type SurveyResponse = typeof surveyResponses.$inferSelect;

// ─── Credit Transactions ──────────────────────────────────────────────────────
export const creditTransactions = mysqlTable("credit_transactions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  amount: int("amount").notNull(), // positive = add, negative = deduct
  type: mysqlEnum("type", ["purchase", "usage", "refund", "admin_adjustment"]).notNull(),
  description: text("description"),
  stripePaymentId: varchar("stripePaymentId", { length: 128 }),
  researchId: int("researchId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CreditTransaction = typeof creditTransactions.$inferSelect;

// ─── AI Provider Configs ──────────────────────────────────────────────────────
export const aiConfigs = mysqlTable("ai_configs", {
  id: int("id").autoincrement().primaryKey(),
  provider: mysqlEnum("provider", ["openai", "anthropic", "gemini"]).notNull().unique(),
  apiKey: text("apiKey"), // encrypted in production
  isActive: boolean("isActive").default(false).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AiConfig = typeof aiConfigs.$inferSelect;

// ─── Model Routing ────────────────────────────────────────────────────────────
export const modelRouting = mysqlTable("model_routing", {
  id: int("id").autoincrement().primaryKey(),
  phase: mysqlEnum("phase", ["wide_scan", "gap_detection", "deep_dives", "synthesis", "polling", "brainstorm"]).notNull().unique(),
  primaryModel: varchar("primaryModel", { length: 128 }).notNull(),
  fallbackModel: varchar("fallbackModel", { length: 128 }),
  systemPrompt: text("systemPrompt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ModelRouting = typeof modelRouting.$inferSelect;

// ─── Audit Logs ───────────────────────────────────────────────────────────────
export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  action: varchar("action", { length: 128 }).notNull(),
  details: json("details"),
  ipAddress: varchar("ipAddress", { length: 64 }),
  userAgent: text("userAgent"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuditLog = typeof auditLogs.$inferSelect;

// ─── Brainstorm Sessions ──────────────────────────────────────────────────────
export const brainstormSessions = mysqlTable("brainstorm_sessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  context: text("context").notNull(),
  ideas: json("ideas").notNull(), // Array of { id, title, description, saved }
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type BrainstormSession = typeof brainstormSessions.$inferSelect;

// ─── Evidence ─────────────────────────────────────────────────────────────────
export const evidence = mysqlTable(
  "evidence",
  {
    id: int("id").autoincrement().primaryKey(),
    researchId: int("researchId").notNull(),
    type: varchar("type", { length: 32 }).notNull(), // 'web_source' | 'synthesis_claim' (future: 'survey_result' | 'manual_claim' | 'csv_import')
    claim: text("claim").notNull(),
    sourceUrl: text("sourceUrl"),
    sourceTitle: varchar("sourceTitle", { length: 512 }),
    sourceDate: date("sourceDate"),
    sourceQuality: varchar("sourceQuality", { length: 16 }), // 'low' | 'medium' | 'high' | null
    confidence: decimal("confidence", { precision: 3, scale: 2 }), // 0.00 - 1.00
    dimensions: json("dimensions").notNull(), // Array<'market_size'|'competition'|'feasibility'|'monetization'|'timeliness'>
    stance: varchar("stance", { length: 16 }).notNull(), // 'supports' | 'weakens' | 'neutral'
    rawPayload: json("rawPayload"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    researchIdIdx: index("idx_evidence_research_id").on(t.researchId),
  }),
);

export type Evidence = typeof evidence.$inferSelect;
export type InsertEvidence = typeof evidence.$inferInsert;

// ─── Decision Snapshots ───────────────────────────────────────────────────────
export const decisionSnapshots = mysqlTable(
  "decision_snapshots",
  {
    id: int("id").autoincrement().primaryKey(),
    researchId: int("researchId").notNull(),
    scores: json("scores").notNull(), // { market_size, competition, feasibility, monetization, timeliness }
    verdict: mysqlEnum("verdict", ["GO", "KILL", "CONDITIONAL"]).notNull(),
    rationale: json("rationale").notNull(), // string[]
    positiveDrivers: json("positiveDrivers"), // string[]
    negativeDrivers: json("negativeDrivers"), // string[]
    missingEvidence: json("missingEvidence"), // string[]
    nextActions: json("nextActions"), // string[]
    evidenceVersion: int("evidenceVersion").default(1).notNull(),
    evidenceCount: int("evidenceCount").default(0).notNull(),
    sourceSynthesisId: int("sourceSynthesisId"), // nullable reference to research_phases.id
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    researchIdIdx: index("idx_decision_snapshots_research_id").on(t.researchId),
    researchVersionIdx: index("idx_decision_snapshots_research_version").on(
      t.researchId,
      t.evidenceVersion,
    ),
  }),
);

export type DecisionSnapshot = typeof decisionSnapshots.$inferSelect;
export type InsertDecisionSnapshot = typeof decisionSnapshots.$inferInsert;
