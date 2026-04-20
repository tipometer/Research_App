import { afterEach, describe, it, expect, vi } from "vitest";
import express from "express";
import { registerDevLoginIfEnabled } from "../auth/dev-login";

describe("dev-login triple-gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("registers /dev/login when NODE_ENV=staging + ENABLE_DEV_LOGIN=true", () => {
    vi.stubEnv("NODE_ENV", "staging");
    vi.stubEnv("ENABLE_DEV_LOGIN", "true");
    vi.stubEnv("DEV_LOGIN_KEY", "test-key-at-least-44-chars-long-xxxxxxxxxxxx");
    vi.stubEnv("JWT_SECRET", "test-secret");
    const app = express();
    const result = registerDevLoginIfEnabled(app);
    expect(result).toBe(true);
    const hasDev = (app._router?.stack ?? []).some(
      (l: any) => l.regexp?.source?.includes("dev"),
    );
    expect(hasDev).toBe(true);
  });

  it("does NOT register when NODE_ENV=production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_DEV_LOGIN", "true");
    const app = express();
    const result = registerDevLoginIfEnabled(app);
    expect(result).toBe(false);
    const hasDev = (app._router?.stack ?? []).some(
      (l: any) => l.regexp?.source?.includes("dev"),
    );
    expect(hasDev).toBe(false);
  });

  it("does NOT register when ENABLE_DEV_LOGIN is unset", () => {
    vi.stubEnv("NODE_ENV", "staging");
    // ENABLE_DEV_LOGIN deliberately NOT stubbed — this is the critical edge case
    const app = express();
    const result = registerDevLoginIfEnabled(app);
    expect(result).toBe(false);
    const hasDev = (app._router?.stack ?? []).some(
      (l: any) => l.regexp?.source?.includes("dev"),
    );
    expect(hasDev).toBe(false);
  });

  it("throws if ENABLE_DEV_LOGIN=true but DEV_LOGIN_KEY missing", () => {
    vi.stubEnv("NODE_ENV", "staging");
    vi.stubEnv("ENABLE_DEV_LOGIN", "true");
    // DEV_LOGIN_KEY deliberately NOT stubbed
    vi.stubEnv("JWT_SECRET", "test-secret");
    const app = express();
    expect(() => registerDevLoginIfEnabled(app)).toThrow(/DEV_LOGIN_KEY/);
  });

  it("throws if ENABLE_DEV_LOGIN=true but JWT_SECRET missing", () => {
    vi.stubEnv("NODE_ENV", "staging");
    vi.stubEnv("ENABLE_DEV_LOGIN", "true");
    vi.stubEnv("DEV_LOGIN_KEY", "test-key");
    // JWT_SECRET deliberately NOT stubbed
    const app = express();
    expect(() => registerDevLoginIfEnabled(app)).toThrow(/JWT_SECRET/);
  });
});
