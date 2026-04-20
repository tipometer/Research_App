import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import * as db from "../db";
import {
  registerDevLoginIfEnabled,
  __resetSeedCacheForTesting,
} from "../auth/dev-login";

// Mock db.upsertUser — we don't need a real DB for handler tests
vi.mock("../db", () => ({
  upsertUser: vi.fn().mockResolvedValue(undefined),
}));

describe("/dev/login handler", () => {
  let app: Express;

  beforeEach(() => {
    __resetSeedCacheForTesting();
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "staging");
    vi.stubEnv("ENABLE_DEV_LOGIN", "true");
    vi.stubEnv("DEV_LOGIN_KEY", "correct-key-44-chars-long-xxxxxxxxxxxxxxxxx");
    vi.stubEnv("JWT_SECRET", "test-jwt-secret-at-least-32-chars-long-xxxxxx");
    app = express();
    registerDevLoginIfEnabled(app);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 401 when key param missing", async () => {
    const res = await request(app).get("/dev/login");
    expect(res.status).toBe(401);
    expect(res.text).toBe("Unauthorized");
  });

  it("returns 401 when key param wrong", async () => {
    const res = await request(app).get("/dev/login?key=wrong-key");
    expect(res.status).toBe(401);
  });

  it("returns 302 + sets app_session_id cookie when key is correct", async () => {
    const res = await request(app).get(
      "/dev/login?key=correct-key-44-chars-long-xxxxxxxxxxxxxxxxx"
    );
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
    const setCookie = res.headers["set-cookie"][0];
    expect(setCookie).toMatch(/app_session_id=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });

  it("calls db.upsertUser once on first login (seed)", async () => {
    await request(app).get(
      "/dev/login?key=correct-key-44-chars-long-xxxxxxxxxxxxxxxxx"
    );
    expect(db.upsertUser).toHaveBeenCalledTimes(1);
    expect(db.upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({
        openId: "dev-admin-staging",
        role: "admin",
      })
    );
  });

  it("does NOT call db.upsertUser again on second login (cached)", async () => {
    const url = "/dev/login?key=correct-key-44-chars-long-xxxxxxxxxxxxxxxxx";
    await request(app).get(url);
    await request(app).get(url);
    expect(db.upsertUser).toHaveBeenCalledTimes(1);
  });

  it("returns 429 on 6th attempt within a minute", async () => {
    const url = "/dev/login?key=wrong";
    // 5 failed attempts
    for (let i = 0; i < 5; i++) {
      await request(app).get(url);
    }
    // 6th triggers rate limit
    const res = await request(app).get(url);
    expect(res.status).toBe(429);
  });
});
