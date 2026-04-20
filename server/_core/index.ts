// Load env in priority order: .env first (baseline defaults), then .env.local
// (local overrides, e.g., dev API keys and MASTER_ENCRYPTION_KEY). .env.local is
// gitignored; its values override .env. This mirrors the Next.js / Vite convention.
import dotenv from "dotenv";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./static";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { runResearchPipeline } from "../research-pipeline";
import { sdk } from "./sdk";
import { getMasterKey } from "../ai/crypto";
import { registerDevLoginIfEnabled } from "../auth/dev-login";
import { logger } from "./logger";
import { sql } from "drizzle-orm";
import { getDb } from "../db";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  // Fast-fail: validate MASTER_ENCRYPTION_KEY is set + well-formed before any work.
  // Throws with a clear error message if the env is missing or has wrong length.
  getMasterKey();

  const app = express();
  const server = createServer(app);

  // ── Security: Helmet + CSP ────────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        // Explicitly block direct AI API calls from the browser
        // This enforces server-side-only AI execution
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // ── Rate Limiting ─────────────────────────────────────────────────────────
  const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
  const researchLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });
  app.use("/api/", generalLimiter);
  app.use("/api/oauth/", authLimiter);
  app.use("/api/research/", researchLimiter);

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // ── Dev auth stub (staging only — triple-gated) ───────────────────────────
  const devAuthEnabled = registerDevLoginIfEnabled(app);
  // registerOAuthRoutes(app) remains untouched below (Auth sprint scope)

  // ── SSE Research Pipeline ─────────────────────────────────────────────────
  app.get("/api/research/:id/stream", async (req, res, next) => {
    try {
      // Authenticate via session cookie (server-side only — never exposes AI keys to browser)
      let user;
      try { user = await sdk.authenticateRequest(req); } catch { user = null; }
      if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
      (req as any).user = user;
      await runResearchPipeline(req, res);
    } catch (err) {
      next(err);
    }
  });

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, async () => {
    // DB smoke-query with retry-with-backoff (TiDB Serverless auto-pause wake can take ~200ms)
    const drz = await getDb();
    if (!drz) {
      logger.error({
        event: "startup_db_check_failed",
        reason: "getDb() returned null (DATABASE_URL unset or connection failed)",
      });
      process.exit(1);
    }

    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await drz.execute(sql`SELECT 1`);
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < 3) {
          logger.warn({ event: "startup_db_check_retry", attempt, error: String(err) });
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
    if (lastErr) {
      logger.error({ event: "startup_db_check_failed", error: String(lastErr) });
      process.exit(1);
    }

    // Startup success marker
    logger.info({
      event: "startup_complete",
      port,
      nodeEnv: process.env.NODE_ENV,
      devAuthEnabled,
    });

    // Existing plain log — keep alongside for local dev readability
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
