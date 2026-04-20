import type { Express, Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import { SignJWT } from "jose";
import rateLimit from "express-rate-limit";
import { COOKIE_NAME } from "@shared/const";
import * as db from "../db";
import { logger } from "../_core/logger";

// Dev admin identity (fix, not config — staging only)
const DEV_OPENID = "dev-admin-staging";
const DEV_NAME = "Dev Admin (staging)";
const DEV_EMAIL = "dev-admin@staging.local";
const DEV_APPID = "staging-dev"; // dummy non-empty for verifySession's isNonEmptyString check
const DEV_LOGIN_METHOD = "dev-stub";
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

let seeded = false;

export function __resetSeedCacheForTesting(): void {
  seeded = false;
}

export function registerDevLoginIfEnabled(app: Express): boolean {
  const enabled =
    process.env.NODE_ENV !== "production" &&
    process.env.ENABLE_DEV_LOGIN === "true";
  if (!enabled) return false;

  // Fast-fail validation — analog to C2b getMasterKey()
  if (!process.env.DEV_LOGIN_KEY) {
    throw new Error("ENABLE_DEV_LOGIN=true but DEV_LOGIN_KEY is missing");
  }
  if (!process.env.JWT_SECRET) {
    throw new Error("ENABLE_DEV_LOGIN=true but JWT_SECRET is missing");
  }

  app.get("/dev/login", devLoginHandler);
  // NO middleware mount — existing sdk.authenticateRequest handles auth
  return true;
}

// Rate limiter: 5 attempts per IP per minute
const devLoginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn({ event: "dev_login_rate_limit", ip: req.ip });
    res.status(429).json({ error: "Too many attempts" });
  },
});

async function ensureDevUserExists(): Promise<void> {
  if (seeded) return;
  // db.upsertUser supports explicit role field (db.ts:53-54), so a single call
  // handles seed + admin role restoration via ON DUPLICATE KEY UPDATE.
  await db.upsertUser({
    openId: DEV_OPENID,
    name: DEV_NAME,
    email: DEV_EMAIL,
    loginMethod: DEV_LOGIN_METHOD,
    role: "admin",
    lastSignedIn: new Date(),
  });
  seeded = true;
  logger.info({ event: "dev_user_ensured", openId: DEV_OPENID });
}

async function devLoginHandler(req: Request, res: Response): Promise<void> {
  // Apply rate limiter first
  await new Promise<void>((resolve) => devLoginLimiter(req, res, () => resolve()));
  if (res.headersSent) return;

  await ensureDevUserExists();

  const keyParam = req.query.key;
  const expectedKey = process.env.DEV_LOGIN_KEY!;
  const ip = req.ip;

  // Timing-safe compare. Length leak (44 chars, base64 32-byte) is public info, not secret.
  let valid = false;
  if (typeof keyParam === "string") {
    const keyBuf = Buffer.from(expectedKey);
    const inputBuf = Buffer.from(keyParam);
    valid = keyBuf.length === inputBuf.length && timingSafeEqual(keyBuf, inputBuf);
  }

  if (!valid) {
    logger.warn({
      event: "dev_login_failure",
      ip,
      reason: typeof keyParam !== "string" ? "missing_key" : "wrong_key",
    });
    res.status(401).send("Unauthorized");
    return;
  }

  // SDK-compatible session JWT: same HS256 + JWT_SECRET that sdk.verifySession reads.
  // Payload must have all three {openId, appId, name} non-empty (verifySession check).
  const secretKey = new TextEncoder().encode(process.env.JWT_SECRET!);
  const expirationSeconds = Math.floor((Date.now() + SESSION_MAX_AGE_MS) / 1000);

  const sessionToken = await new SignJWT({
    openId: DEV_OPENID,
    appId: DEV_APPID,
    name: DEV_NAME,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expirationSeconds)
    .sign(secretKey);

  // COOKIE_NAME = "app_session_id" — same cookie sdk.authenticateRequest reads
  res.cookie(COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_MS,
    path: "/",
  });

  logger.info({ event: "dev_login_success", ip, openId: DEV_OPENID });
  res.redirect("/");
}
