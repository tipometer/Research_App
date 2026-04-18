# C2b Sprint — API Key AES-256-GCM Envelope Encryption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec reference:** [docs/superpowers/specs/2026-04-18-c2b-encryption-design.md](../specs/2026-04-18-c2b-encryption-design.md)

**Goal:** Add envelope encryption to the `aiConfigs.apiKey` DB column using AES-256-GCM, with lazy migration of plaintext rows, env-only master key management, and admin UI visibility into encryption status — without breaking the C1 DB-first / ENV fallback contract or the C2a fallback layer.

**Architecture:**
- New `server/ai/crypto.ts` module: AES-256-GCM `encrypt` / `decrypt`, master key singleton from `MASTER_ENCRYPTION_KEY`, `DecryptionError` class. Ciphertext string format: `ENC1:<iv_b64>:<ct_b64>:<tag_b64>`. AAD = `aiConfig:<provider.toLowerCase()>`.
- Single-point-of-truth format detection: `decryptIfNeeded(stored, masterKey, aad)` helper in `server/ai/router.ts` — `ENC1:` prefix → decrypt, otherwise passthrough + dev/staging WARN log.
- Write path: `admin.ai.setProviderKey` mutation in `server/routers.ts` always encrypts before DB write.
- Read path: `lookupApiKey` + `testProvider` call `decryptIfNeeded` after DB read.
- Fallback integration: `DecryptionError` classified as **non-eligible** (permanent config error, like 401).
- Admin UI: `listConfigs` response shape gains `isEncrypted: boolean` (prefix-check, no decrypt). AdminPanel.tsx renders 🔒 Encrypted / ⚠ Plaintext (legacy) badge.
- Startup validation: `server/_core/index.ts` calls `getMasterKey()` at boot → fast-fail on missing / malformed env.

**Tech Stack:**
- Node `crypto` module (built-in, no new npm dependency)
- Vercel AI SDK v6 (unchanged)
- Vitest for unit + integration tests (~22 new tests added)
- tRPC v11 (shape change to `admin.ai.listConfigs` response — additive field only)
- Drizzle ORM (no schema change — `aiConfigs.apiKey` remains `text`; ciphertext fits)
- React (AdminPanel Badge component already imported)

**C2b Scope (in):** crypto module + router decryptIfNeeded + admin encrypt-at-write + fallback DecryptionError branch + AdminPanel isEncrypted badge + startup validation + env docs

**C2b NOT in scope:** KMS integration (C3), key rotation dual-key support (C3), automated batch re-encryption script (C3), audit log encrypt/decrypt events (C3), admin "Re-encrypt all" action button (C3 — lazy migration suffices)

---

## Pre-work: Worktree already set up

The worktree is at `/Users/balintkovacs/Work/ClaudeCode/Research_App/repo-c1-ai-pipeline` on branch `feat/c2b-encryption` (local only — not pushed until Task 0 completes). `.env.local` has all 3 provider API keys. `node_modules` installed. **pnpm is not globally installed — use `corepack pnpm`, NOT `pnpm` or `npm`.**

Working directory for all commands: `/Users/balintkovacs/Work/ClaudeCode/Research_App/repo-c1-ai-pipeline`. If your shell resets to a different directory, prefix commands with `cd /Users/balintkovacs/Work/ClaudeCode/Research_App/repo-c1-ai-pipeline && `.

## ⚠️ Preflight safety notes — READ BEFORE ANY IMPLEMENTATION

These items are critical subagent reminders. If a task seems to conflict with these, THESE WIN:

1. **Use `corepack pnpm`, never `pnpm` or `npm`.** Global pnpm is not installed. Global npm would create inconsistent lockfile state.

2. **Ciphertext format guard is defense-in-depth, not the only layer.** In `decrypt`, the 4-segment guard catches plaintext inputs with `:` chars. If base64 in a segment is malformed (e.g., `ENC1:!!!:ct:tag`), Node's `Buffer.from(x, "base64")` does NOT throw — it returns garbage bytes. The actual `DecryptionError` surfaces later at `decipher.final()` (auth tag mismatch) and is wrapped by the `catch` block. The unit test (Task 1, Step 3 test case #9) verifies the net behavior; the comment MUST say "invalid base64 → auth failure → DecryptionError (via catch wrapper, not format guard)".

3. **`getMasterKey()` throws on misconfig — this is intentional at startup.** Task 2 adds the call to `server/_core/index.ts` BEFORE `server.listen(...)`. If the env is missing, the process crashes with a clear error message. Do NOT wrap in try/catch to "soften" the error — we want a hard fail.

4. **WARN log content discipline — router vs fallback.** Two different log sites, two different policies:
   - **Router `decryptIfNeeded` WARN** (§5.1 of spec): includes AAD (`aiConfig:openai`) — dev/staging only (`NODE_ENV !== "production"`). Purpose: diagnostic during migration. Add inline comment: `// NOTE: AAD included intentionally for dev diagnostics — NOT a log hygiene bug`.
   - **Fallback `DecryptionError` WARN** (§6.2 of spec): generic message only, NO AAD, NO provider name, NO error.cause detail. Purpose: avoid sensitive-context leak in production logs.
   A future code reviewer seeing the router WARN may want to "fix" it — the comment prevents that.

5. **AAD normalization: `provider.toLowerCase()` on BOTH encrypt AND decrypt paths.** Any deviation (camelCase / TitleCase / PascalCase admin input) breaks decryption. Use a single helper `buildAad(provider)` or inline `.toLowerCase()` consistently. Tests must cover case-mismatch explicitly.

6. **Write-side encryption covers ALL DB writes to `aiConfigs.apiKey`.** Currently one write site: `admin.ai.setProviderKey` in `server/routers.ts:284-304`. If any future task/subagent adds another write site, it MUST also encrypt. Add a brief comment near the DB schema import or column reference noting this invariant.

7. **`testProvider` also reads the API key from DB (`server/routers.ts:330-332`).** Task 5 MUST add `decryptIfNeeded` there too — NOT just in `lookupApiKey`. A subagent that only touches `lookupApiKey` will break the admin "Test Connection" button for encrypted keys.

8. **`isEncrypted` field scope: `adminProcedure` ONLY.** Current `listConfigs` is already `adminProcedure` — the change is additive. If a future endpoint exposes anything API-key-related on `publicProcedure`, `isEncrypted` must NOT appear there. Spec §7.1 is authoritative.

9. **`__resetMasterKeyForTesting` is a test-only escape hatch.** In test files, call it in `beforeEach` / `afterEach` to reset singleton between tests that set different env values. In production code paths (including `server/routers.ts` and `server/_core/index.ts`), NEVER call it.

10. **Commit hygiene: one logical change per commit.** Each task's final "Commit" step produces ONE commit with all files from that task. Do NOT split by file within a single task (creates "WIP" noise). Do NOT combine tasks into one commit (breaks review granularity).

---

## File Structure

| File | Responsibility |
|------|----------------|
| **Create** `server/ai/crypto.ts` | AES-256-GCM primitives (`encrypt`/`decrypt`), master key singleton (`getMasterKey`), test helper (`__resetMasterKeyForTesting`), `DecryptionError` class |
| **Create** `server/ai/crypto.test.ts` | Unit tests: round-trip, tamper detection (IV/ct/tag), AAD mismatch, format guard (wrong segment count), version guard, invalid base64 handling, missing/malformed master key, singleton behavior, test-helper production guard |
| **Modify** `server/ai/router.ts` | Add private `decryptIfNeeded` helper; call it from `lookupApiKey` after DB read. Helper imports from `./crypto`. |
| **Modify** `server/ai/router.test.ts` | Add integration tests: encrypted row lookup, plaintext row passthrough + WARN (dev), plaintext row silence (prod), null row fall-through to ENV, malformed `ENC1:` row propagates DecryptionError |
| **Modify** `server/ai/fallback.ts` | Add `DecryptionError` instance check in `isFallbackEligible` returning `false`. WARN log sanitized (no AAD). |
| **Modify** `server/ai/fallback.test.ts` | Add distinguishing tests: `DecryptionError` → not eligible; verify log content does NOT contain AAD/provider |
| **Modify** `server/routers.ts` | (1) `listConfigs` returns `isEncrypted: boolean` (prefix check, no decrypt). (2) `setProviderKey` encrypts before DB write. (3) `testProvider` calls `decryptIfNeeded` after DB read. |
| **Modify** `server/_core/index.ts` | Call `getMasterKey()` once at startup before `server.listen` — fast-fail on misconfig |
| **Modify** `client/src/pages/AdminPanel.tsx` | Extend `ProviderRowProps` with `isEncrypted`; render second badge (🔒 Encrypted / ⚠ Plaintext legacy) below status badge |
| **Modify** `client/src/i18n/hu.ts` | Add `admin.ai.encrypted` + `admin.ai.plaintextLegacy` keys |
| **Modify** `client/src/i18n/en.ts` | Add same two keys (English strings) |
| **Modify** `.env.local.example` | Add `MASTER_ENCRYPTION_KEY=` section with generation instruction |
| **Modify** `server/deep-research.test.ts` (if needed) | Only if existing tests reference `aiConfigs.apiKey` directly and break with encrypted format — verify before editing |

**Key design boundaries:**
- `crypto.ts` has zero knowledge of provider names, DB schema, or business logic. It takes plaintext/ciphertext + masterKey + AAD strings. Callers handle `.toLowerCase()` normalization.
- `decryptIfNeeded` lives in `router.ts` (not `crypto.ts`) because the lazy-migration policy is a router-level concern. If the policy changes (e.g., "plaintext rejected after date X"), only `router.ts` changes.
- `admin.ai.listConfigs` does the `isEncrypted` prefix check inline (one line, no helper needed). It MUST NOT call `decrypt` — that's both a perf waste and a security smell.

---

## Task 0: Master key generation + env setup

**Files:**
- Modify: `.env.local` (gitignored — manual edit)
- Modify: `.env.local.example`

This task is **manual** — no TDD cycle. It sets up the runtime prerequisites so all subsequent tasks can run tests against a real `MASTER_ENCRYPTION_KEY`.

- [ ] **Step 1: Generate master key**

Run: `openssl rand -base64 32`

Expected: a 44-char base64 string, e.g., `XyZ9aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ0=`

Save the output — it's the master key for this development environment.

- [ ] **Step 2: Add to `.env.local`**

Append to `.env.local` (NOT `.env.local.example`):

```bash
# AES-256-GCM master key for aiConfigs.apiKey encryption
MASTER_ENCRYPTION_KEY=<paste the base64 string from Step 1>
```

- [ ] **Step 3: Update `.env.local.example`**

Add after the existing env var sections:

```bash
# ── API Key Encryption (C2b) ──────────────────────────────────────────────────
# Master key for AES-256-GCM envelope encryption of aiConfigs.apiKey rows.
# Required in ALL environments (dev / staging / prod). Generate with:
#   openssl rand -base64 32
# MUST be a base64-encoded 32-byte value. The server crashes at startup if
# the var is missing or malformed.
#
# Rotation is NOT supported in C2b — changing this value renders all existing
# encrypted rows undecryptable. If rotation is needed, admin must re-save every
# provider key after the rotation. Automated rotation is C3 scope.
MASTER_ENCRYPTION_KEY=
```

- [ ] **Step 4: Verify env is loaded**

Run: `node -e 'require("dotenv").config({ path: ".env.local" }); const k = process.env.MASTER_ENCRYPTION_KEY; console.log(k ? \`OK len=\${Buffer.from(k, "base64").length}\` : "MISSING")'`

Expected: `OK len=32`

- [ ] **Step 5: Commit env.example change only**

```bash
git add .env.local.example
git commit -m "chore(env): add MASTER_ENCRYPTION_KEY placeholder for C2b encryption"
```

`.env.local` is gitignored and MUST NOT be committed.

---

## Task 1: `crypto.ts` module — encrypt/decrypt primitives + master key singleton

**Files:**
- Create: `server/ai/crypto.ts`
- Create: `server/ai/crypto.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `server/ai/crypto.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  encrypt,
  decrypt,
  getMasterKey,
  __resetMasterKeyForTesting,
  DecryptionError,
} from "./crypto";

const TEST_KEY_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // 32 zero bytes base64
const AAD = "aiConfig:openai";

describe("crypto — master key singleton", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.MASTER_ENCRYPTION_KEY;
    __resetMasterKeyForTesting();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.MASTER_ENCRYPTION_KEY;
    else process.env.MASTER_ENCRYPTION_KEY = originalEnv;
    __resetMasterKeyForTesting();
  });

  it("returns 32-byte buffer when env is set", () => {
    process.env.MASTER_ENCRYPTION_KEY = TEST_KEY_B64;
    const key = getMasterKey();
    expect(key.length).toBe(32);
  });

  it("returns same Buffer reference on repeat calls (singleton)", () => {
    process.env.MASTER_ENCRYPTION_KEY = TEST_KEY_B64;
    const k1 = getMasterKey();
    const k2 = getMasterKey();
    expect(k1).toBe(k2);
  });

  it("throws when env var is missing", () => {
    delete process.env.MASTER_ENCRYPTION_KEY;
    expect(() => getMasterKey()).toThrow(/MASTER_ENCRYPTION_KEY/);
  });

  it("throws when env var decodes to wrong length", () => {
    process.env.MASTER_ENCRYPTION_KEY = Buffer.from("short").toString("base64"); // 5 bytes
    expect(() => getMasterKey()).toThrow(/32 bytes/);
  });

  it("__resetMasterKeyForTesting throws in production", () => {
    const origNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => __resetMasterKeyForTesting()).toThrow(/production/);
    } finally {
      process.env.NODE_ENV = origNodeEnv;
    }
  });
});

describe("crypto — encrypt/decrypt round-trip", () => {
  const key = Buffer.alloc(32, 0); // 32 zero bytes

  it("round-trips plaintext", () => {
    const pt = "sk-ant-api03-abc123xyz";
    const ct = encrypt(pt, key, AAD);
    expect(decrypt(ct, key, AAD)).toBe(pt);
  });

  it("produces non-deterministic ciphertext (random IV)", () => {
    const pt = "same plaintext";
    const ct1 = encrypt(pt, key, AAD);
    const ct2 = encrypt(pt, key, AAD);
    expect(ct1).not.toBe(ct2);
  });

  it("ciphertext starts with ENC1: version prefix", () => {
    const ct = encrypt("x", key, AAD);
    expect(ct.startsWith("ENC1:")).toBe(true);
  });

  it("ciphertext has 4 colon-separated segments", () => {
    const ct = encrypt("x", key, AAD);
    expect(ct.split(":").length).toBe(4);
  });
});

describe("crypto — tamper detection", () => {
  const key = Buffer.alloc(32, 0);

  it("DecryptionError when ciphertext bytes are modified", () => {
    const ct = encrypt("hello", key, AAD);
    const parts = ct.split(":");
    const ctBuf = Buffer.from(parts[2], "base64");
    ctBuf[0] = ctBuf[0] ^ 0xff; // flip first byte
    parts[2] = ctBuf.toString("base64");
    const tampered = parts.join(":");
    expect(() => decrypt(tampered, key, AAD)).toThrow(DecryptionError);
  });

  it("DecryptionError when tag is modified", () => {
    const ct = encrypt("hello", key, AAD);
    const parts = ct.split(":");
    const tagBuf = Buffer.from(parts[3], "base64");
    tagBuf[0] = tagBuf[0] ^ 0xff;
    parts[3] = tagBuf.toString("base64");
    const tampered = parts.join(":");
    expect(() => decrypt(tampered, key, AAD)).toThrow(DecryptionError);
  });

  it("DecryptionError when IV is modified", () => {
    const ct = encrypt("hello", key, AAD);
    const parts = ct.split(":");
    const ivBuf = Buffer.from(parts[1], "base64");
    ivBuf[0] = ivBuf[0] ^ 0xff;
    parts[1] = ivBuf.toString("base64");
    const tampered = parts.join(":");
    expect(() => decrypt(tampered, key, AAD)).toThrow(DecryptionError);
  });

  it("DecryptionError when AAD differs from encrypt-time AAD", () => {
    const ct = encrypt("hello", key, "aiConfig:openai");
    expect(() => decrypt(ct, key, "aiConfig:anthropic")).toThrow(DecryptionError);
  });
});

describe("crypto — format + version guards", () => {
  const key = Buffer.alloc(32, 0);

  it("DecryptionError when segment count != 4 (plaintext with colons)", () => {
    // Plaintext that happens to contain a colon — simulates an API key leaking into decrypt path
    expect(() => decrypt("sk-ant-api03-xyz:abc", key, AAD)).toThrow(DecryptionError);
  });

  it("DecryptionError when only two segments", () => {
    expect(() => decrypt("ENC1:onlytwo", key, AAD)).toThrow(DecryptionError);
  });

  it("DecryptionError when version prefix is not ENC1", () => {
    const ct = encrypt("hello", key, AAD);
    const parts = ct.split(":");
    parts[0] = "ENC2";
    expect(() => decrypt(parts.join(":"), key, AAD)).toThrow(DecryptionError);
  });

  it("DecryptionError when base64 segment is invalid", () => {
    // NOTE: Node's Buffer.from("!!!", "base64") does NOT throw — returns garbage buffer.
    // The actual DecryptionError surfaces at decipher.final() auth-tag check and is
    // wrapped by the catch block. This test verifies the net behavior, not the
    // specific guard path.
    expect(() => decrypt("ENC1:!!!:ct:tag", key, AAD)).toThrow(DecryptionError);
  });
});
```

- [ ] **Step 2: Run test — expect failure (module not defined)**

Run: `corepack pnpm test -- server/ai/crypto.test.ts`

Expected: FAIL with `Cannot find module './crypto'` (or similar — module doesn't exist yet)

- [ ] **Step 3: Implement `crypto.ts`**

Create `server/ai/crypto.ts`:

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "ENC1";
const IV_LENGTH = 12;    // 96 bits — NIST SP 800-38D recommended GCM IV
const TAG_LENGTH = 16;   // 128 bits — GCM standard
const KEY_LENGTH = 32;   // 256 bits — AES-256

// ─── Master key singleton ────────────────────────────────────────────────────

let cachedMasterKey: Buffer | null = null;

export function getMasterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;

  const encoded = process.env.MASTER_ENCRYPTION_KEY;
  if (!encoded) {
    throw new Error(
      "MASTER_ENCRYPTION_KEY env var not set. " +
      "Generate one with: openssl rand -base64 32"
    );
  }

  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length !== KEY_LENGTH) {
    throw new Error(
      `MASTER_ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (got ${decoded.length})`
    );
  }

  cachedMasterKey = decoded;
  return cachedMasterKey;
}

/**
 * Test-only: resets the singleton so different tests can set different env values.
 * Throws in production to prevent accidental use.
 */
export function __resetMasterKeyForTesting(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("__resetMasterKeyForTesting must not be called in production");
  }
  cachedMasterKey = null;
}

// ─── DecryptionError ─────────────────────────────────────────────────────────

export class DecryptionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "DecryptionError";
  }
}

// ─── Encrypt / decrypt ────────────────────────────────────────────────────────

export function encrypt(plaintext: string, masterKey: Buffer, aad: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  cipher.setAAD(Buffer.from(aad, "utf-8"));

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${VERSION}:${iv.toString("base64")}:${ciphertext.toString("base64")}:${tag.toString("base64")}`;
}

export function decrypt(stored: string, masterKey: Buffer, aad: string): string {
  const parts = stored.split(":");

  // Format guard: 4 segments required.
  // Defense-in-depth — also catches plaintext inputs that contain ':' chars
  // (e.g., accidental API-key-shaped inputs). See Task 1 preflight note #2.
  if (parts.length !== 4) {
    throw new DecryptionError(
      `Invalid ciphertext format: expected 4 segments, got ${parts.length}`
    );
  }

  const [version, ivB64, ctB64, tagB64] = parts;

  if (version !== VERSION) {
    throw new DecryptionError(`Unsupported ciphertext version: ${version}`);
  }

  try {
    const iv = Buffer.from(ivB64, "base64");
    const ciphertext = Buffer.from(ctB64, "base64");
    const tag = Buffer.from(tagB64, "base64");

    if (iv.length !== IV_LENGTH) {
      throw new DecryptionError(`Invalid IV length: ${iv.length}`);
    }
    if (tag.length !== TAG_LENGTH) {
      throw new DecryptionError(`Invalid tag length: ${tag.length}`);
    }

    const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
    decipher.setAAD(Buffer.from(aad, "utf-8"));
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return plaintext.toString("utf-8");
  } catch (err) {
    if (err instanceof DecryptionError) throw err;
    // Node's crypto throws a generic Error for auth failure or malformed input.
    // Wrap it so callers (e.g., fallback classifier) can use `instanceof DecryptionError`.
    throw new DecryptionError(
      "Decryption failed (auth tag mismatch or corrupted ciphertext)",
      err,
    );
  }
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `corepack pnpm test -- server/ai/crypto.test.ts`

Expected: ALL tests pass (approximately 16 tests). If any fail, fix the implementation — do NOT relax the test.

- [ ] **Step 5: Commit**

```bash
git add server/ai/crypto.ts server/ai/crypto.test.ts
git commit -m "feat(crypto): add AES-256-GCM encrypt/decrypt + master key singleton

- server/ai/crypto.ts: ENC1:iv:ct:tag format, AAD context binding, 12-byte IV
- DecryptionError class for instanceof distinguishing in fallback layer
- Master key singleton from MASTER_ENCRYPTION_KEY env var (base64-encoded 32 bytes)
- __resetMasterKeyForTesting helper (production guard)
- 16 unit tests: round-trip, tamper detection (ct/tag/IV), AAD mismatch,
  format + version guards, master key singleton + prod guard"
```

---

## Task 2: Startup validation in `server/_core/index.ts`

**Files:**
- Modify: `server/_core/index.ts`

- [ ] **Step 1: Locate the startup function**

Read `server/_core/index.ts` around line 34 — `startServer` function. The validation call goes at the TOP of `startServer`, before any middleware or routes.

- [ ] **Step 2: Add import + startup call**

Edit `server/_core/index.ts`:

Add to the imports (after the existing `import { sdk } from "./sdk";`):

```typescript
import { getMasterKey } from "../ai/crypto";
```

Modify `startServer` — add this as the very first line inside the function body:

```typescript
async function startServer() {
  // Fast-fail: validate MASTER_ENCRYPTION_KEY is set + well-formed before any work.
  // Throws with a clear error message if the env is missing or has wrong length.
  getMasterKey();

  const app = express();
  // ... rest unchanged
```

- [ ] **Step 3: Verify by running dev server with missing env**

Run: `MASTER_ENCRYPTION_KEY="" corepack pnpm dev`

Expected: server crashes immediately with error `MASTER_ENCRYPTION_KEY env var not set...`

Then run: `corepack pnpm dev` (without override — uses `.env.local`)

Expected: server starts normally on port 3000+

Kill the dev server (Ctrl+C) after verifying.

- [ ] **Step 4: Commit**

```bash
git add server/_core/index.ts
git commit -m "feat(core): fast-fail startup validation for MASTER_ENCRYPTION_KEY

Calls getMasterKey() at top of startServer() so missing/malformed env crashes
immediately with clear error, rather than failing lazily on first admin save
or pipeline execution."
```

---

## Task 3: `router.ts` — `decryptIfNeeded` helper + `lookupApiKey` integration

**Files:**
- Modify: `server/ai/router.ts`
- Modify: `server/ai/router.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/ai/router.test.ts` (preserve existing tests — add a new `describe` block at the end):

```typescript
import { encrypt, __resetMasterKeyForTesting } from "./crypto";

describe("router — lookupApiKey with encryption", () => {
  const TEST_KEY_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const KEY_BUF = Buffer.alloc(32, 0);

  let warnSpy: ReturnType<typeof vi.spyOn>;
  let origNodeEnv: string | undefined;
  let origMasterKey: string | undefined;
  let origOpenaiKey: string | undefined;

  beforeEach(() => {
    origNodeEnv = process.env.NODE_ENV;
    origMasterKey = process.env.MASTER_ENCRYPTION_KEY;
    origOpenaiKey = process.env.OPENAI_API_KEY;
    process.env.MASTER_ENCRYPTION_KEY = TEST_KEY_B64;
    __resetMasterKeyForTesting();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    if (origNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = origNodeEnv;
    if (origMasterKey === undefined) delete process.env.MASTER_ENCRYPTION_KEY;
    else process.env.MASTER_ENCRYPTION_KEY = origMasterKey;
    if (origOpenaiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = origOpenaiKey;
    __resetMasterKeyForTesting();
    warnSpy.mockRestore();
  });

  it("decrypts an ENC1: row from DB", async () => {
    const pt = "sk-openai-plaintext-key-xxx";
    const ct = encrypt(pt, KEY_BUF, "aiConfig:openai");
    mockDbReturnsApiKey(ct); // helper: stubs getDb() → aiConfigs row with apiKey=ct
    const result = await lookupApiKey("openai");
    expect(result).toBe(pt);
  });

  it("returns plaintext row unchanged (lazy migration) + WARN in dev", async () => {
    process.env.NODE_ENV = "development";
    const pt = "sk-plaintext-legacy-key";
    mockDbReturnsApiKey(pt);
    const result = await lookupApiKey("openai");
    expect(result).toBe(pt);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Plaintext API key detected")
    );
  });

  it("returns plaintext silently in production (no WARN)", async () => {
    process.env.NODE_ENV = "production";
    mockDbReturnsApiKey("sk-plaintext-legacy-key");
    await lookupApiKey("openai");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("falls through to ENV when DB row is missing", async () => {
    mockDbReturnsNoRow();
    process.env.OPENAI_API_KEY = "env-fallback-key";
    const result = await lookupApiKey("openai");
    expect(result).toBe("env-fallback-key");
  });

  it("throws DecryptionError when ENC1: row is corrupted", async () => {
    const ct = encrypt("good", KEY_BUF, "aiConfig:openai");
    const tamperedCt = ct.slice(0, -4) + "XXXX"; // wreck the tag segment
    mockDbReturnsApiKey(tamperedCt);
    await expect(lookupApiKey("openai")).rejects.toThrow(/Decryption failed|DecryptionError/);
  });
});
```

**Note:** `mockDbReturnsApiKey` / `mockDbReturnsNoRow` — check existing `router.test.ts` for the current DB mocking pattern. If the file uses `vi.mock('../db', ...)` with a module factory, extend that pattern. If the existing tests mock differently, reuse the same mechanism — do NOT introduce a new pattern.

- [ ] **Step 2: Run test — expect failure**

Run: `corepack pnpm test -- server/ai/router.test.ts`

Expected: new tests fail (decryptIfNeeded not implemented yet — `lookupApiKey` returns the raw `ENC1:...` string, not decrypted plaintext).

- [ ] **Step 3: Implement `decryptIfNeeded` + update `lookupApiKey`**

Edit `server/ai/router.ts`:

Add imports at the top (after existing imports):

```typescript
import { decrypt, getMasterKey } from "./crypto";
```

Add this helper ABOVE `lookupApiKey` (around line 42):

```typescript
/**
 * Single point-of-truth format detection + decrypt-or-passthrough for stored API keys.
 *
 * - `ENC1:...` prefix → decrypt via AES-256-GCM (throws DecryptionError on failure).
 * - Anything else → lazy-migration passthrough: returns the string verbatim and
 *   logs a WARN in dev/staging (silenced in production to avoid noise during
 *   the migration period).
 *
 * The `aad` parameter binds ciphertext to its provider context — see spec §4.4.
 */
function decryptIfNeeded(stored: string, aad: string): string {
  if (!stored.startsWith("ENC1:")) {
    if (process.env.NODE_ENV !== "production") {
      // NOTE: AAD included intentionally for dev diagnostics — NOT a log hygiene bug.
      // The fallback-layer DecryptionError WARN (server/ai/fallback.ts) is different:
      // it MUST NOT include AAD. See Task 4.
      console.warn(
        `[crypto] Plaintext API key detected for ${aad} — ` +
        `will encrypt on next admin save (lazy migration)`
      );
    }
    return stored;
  }
  return decrypt(stored, getMasterKey(), aad);
}
```

Modify `lookupApiKey` — change the DB-hit branch:

```typescript
export async function lookupApiKey(provider: ProviderId): Promise<string> {
  const db = await getDb();
  if (db) {
    const rows = await db
      .select({ apiKey: aiConfigs.apiKey })
      .from(aiConfigs)
      .where(and(eq(aiConfigs.provider, provider), eq(aiConfigs.isActive, true)))
      .limit(1);
    if (rows.length > 0 && rows[0].apiKey) {
      const aad = `aiConfig:${provider.toLowerCase()}`;
      return decryptIfNeeded(rows[0].apiKey, aad);
    }
  }
  const envKey = `${provider.toUpperCase()}_API_KEY`;
  const envValue = process.env[envKey];
  if (envValue) return envValue;
  throw new Error(`No API key configured for provider: ${provider}`);
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `corepack pnpm test -- server/ai/router.test.ts`

Expected: ALL tests pass (existing + 5 new).

- [ ] **Step 5: Run full unit test suite to catch regressions**

Run: `corepack pnpm test`

Expected: ALL tests pass. If existing tests fail because they expected plaintext DB reads that now route through `decryptIfNeeded`, check whether the test sets `MASTER_ENCRYPTION_KEY` in `beforeAll` / `beforeEach`. If not, set it in the test setup (do NOT modify `decryptIfNeeded` to skip validation in tests).

- [ ] **Step 6: Commit**

```bash
git add server/ai/router.ts server/ai/router.test.ts
git commit -m "feat(router): lazy-migration decrypt helper for lookupApiKey

- server/ai/router.ts: new private decryptIfNeeded(stored, aad) — ENC1: prefix
  detection, delegates to crypto.decrypt; plaintext passthrough with dev/staging
  WARN log (silenced in prod)
- lookupApiKey calls decryptIfNeeded after DB read, AAD = aiConfig:<provider.toLowerCase()>
- AAD normalization via toLowerCase() prevents case-mismatch attack vector
- 5 new integration tests: encrypted lookup, plaintext passthrough + WARN,
  production silence, ENV fallthrough, malformed ciphertext propagates"
```

---

## Task 4: `fallback.ts` — `DecryptionError` non-eligible branch

**Files:**
- Modify: `server/ai/fallback.ts`
- Modify: `server/ai/fallback.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/ai/fallback.test.ts` (preserve existing tests):

```typescript
import { DecryptionError } from "./crypto";

describe("fallback — DecryptionError classification", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("DecryptionError is NOT eligible for fallback (permanent config error)", () => {
    const err = new DecryptionError("auth tag mismatch");
    expect(isFallbackEligible(err)).toBe(false);
  });

  it("WARN log for DecryptionError does NOT contain AAD or provider name", () => {
    const err = new DecryptionError("Decryption failed for aiConfig:openai with cause <X>");
    isFallbackEligible(err);
    const logged = warnSpy.mock.calls.flat().join(" ");
    // Must NOT contain the leaky substrings, even though they're in err.message
    expect(logged).not.toMatch(/aiConfig:/);
    expect(logged).not.toMatch(/openai|anthropic|gemini/);
    // Should contain generic descriptor
    expect(logged).toMatch(/decryption|config/i);
  });

  it("generic 500 APICallError is still eligible (regression check)", () => {
    const err = new APICallError({
      url: "x",
      requestBodyValues: {},
      statusCode: 500,
      message: "upstream error",
    });
    expect(isFallbackEligible(err)).toBe(true);
  });

  it("401 APICallError is still NOT eligible (regression check)", () => {
    const err = new APICallError({
      url: "x",
      requestBodyValues: {},
      statusCode: 401,
      message: "unauthorized",
    });
    expect(isFallbackEligible(err)).toBe(false);
  });
});
```

Also add `import { APICallError } from "ai";` if not already imported at the top.

- [ ] **Step 2: Run test — expect failure**

Run: `corepack pnpm test -- server/ai/fallback.test.ts`

Expected: the DecryptionError tests fail (currently classified as "eligible / transient").

- [ ] **Step 3: Implement the new branch**

Edit `server/ai/fallback.ts`:

Add import at the top:

```typescript
import { DecryptionError } from "./crypto";
```

Modify `isFallbackEligible` — add the new branch ABOVE the `ZodError` check (so permanent errors are short-circuited first):

```typescript
export function isFallbackEligible(err: unknown): boolean {
  if (err instanceof DecryptionError) {
    // Permanent config error (like 401) — fallback to same-config model can't
    // fix decryption. Admin intervention required.
    //
    // NOTE: log message MUST NOT contain AAD, provider name, or err.cause detail.
    // Router has its own diagnostic WARN at migration-detect time (see router.ts
    // decryptIfNeeded) which DOES include AAD — that's dev-only. This one runs
    // in prod and must stay generic.
    console.warn(`[fallback] Decryption error — config issue, not a transient fault`);
    return false;
  }

  if (err instanceof z.ZodError) return true;
  if (err instanceof APICallError) {
    const code = err.statusCode;
    if (code !== undefined && code < 500 && code !== 429) return false;
    return true;
  }
  // Programming errors are code bugs — fallback can't fix them, would just double-latency.
  if (err instanceof TypeError || err instanceof ReferenceError || err instanceof RangeError) {
    console.warn(`[fallback] Code bug suspected (${err.name}: ${err.message}). Not attempting fallback.`);
    return false;
  }
  // Generic Error / AbortError / network / timeout / unknown throw → eligible (transient assumption)
  return true;
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `corepack pnpm test -- server/ai/fallback.test.ts`

Expected: ALL tests pass.

- [ ] **Step 5: Run full suite**

Run: `corepack pnpm test`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/ai/fallback.ts server/ai/fallback.test.ts
git commit -m "feat(fallback): classify DecryptionError as non-eligible

- isFallbackEligible returns false for DecryptionError (analogous to 401
  permanent errors) — fallback model with same decryption context can't
  recover from config issue
- WARN log uses generic message (no AAD / provider / cause detail) to avoid
  sensitive-context leak in production logs
- 4 new tests: DecryptionError non-eligible, log hygiene, 500/401 regressions"
```

---

## Task 5: `server/routers.ts` — encrypt at write + decrypt at test + `isEncrypted` in list

**Files:**
- Modify: `server/routers.ts`

No separate test file — `routers.ts` is covered by integration tests in `server/deep-research.test.ts`. After this task, verify those still pass.

- [ ] **Step 1: Locate the three write/read sites**

The admin AI router is at `server/routers.ts:270-350` approximately. Three sites:
1. `listConfigs` (line ~271) — add `isEncrypted` to response
2. `setProviderKey` (line ~284) — encrypt before write
3. `testProvider` (line ~314) — decrypt after read

- [ ] **Step 2: Add imports at the top of `server/routers.ts`**

Find the existing imports block. Add:

```typescript
import { encrypt, getMasterKey } from "./ai/crypto";
```

(If `decryptIfNeeded` is needed and it's private to router.ts — it is — we'll call `lookupApiKey` or export a narrow helper. For `testProvider`, the cleanest approach is to reuse `decryptIfNeeded` logic. Since `decryptIfNeeded` is currently file-private in `server/ai/router.ts`, export it with a narrower name:

Modify `server/ai/router.ts`: change `function decryptIfNeeded` to `export function decryptIfNeeded`. Keep the name — it's descriptive.

Then in `server/routers.ts`:

```typescript
import { decryptIfNeeded } from "./ai/router";
```

- [ ] **Step 3: Modify `listConfigs` — add `isEncrypted` field**

Change:

```typescript
listConfigs: adminProcedure.query(async () => {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(aiConfigs);
  // NEVER return apiKey — only masked presence flag + encryption status
  return rows.map(r => ({
    provider: r.provider,
    hasKey: !!r.apiKey && r.apiKey.length > 0,
    isEncrypted: !!r.apiKey && r.apiKey.startsWith("ENC1:"),
    isActive: r.isActive,
    updatedAt: r.updatedAt,
  }));
}),
```

- [ ] **Step 4: Modify `setProviderKey` — encrypt at write**

Change the mutation body:

```typescript
setProviderKey: adminProcedure
  .input(z.object({
    provider: z.enum(["openai", "anthropic", "gemini"]),
    apiKey: z.string().min(10),
    isActive: z.boolean().default(true),
  }))
  .mutation(async ({ input, ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No DB" });

    // Encrypt BEFORE DB write — no plaintext hits aiConfigs.apiKey column.
    const aad = `aiConfig:${input.provider.toLowerCase()}`;
    const encryptedKey = encrypt(input.apiKey, getMasterKey(), aad);

    const existing = await db.select().from(aiConfigs).where(eq(aiConfigs.provider, input.provider)).limit(1);
    if (existing.length > 0) {
      await db.update(aiConfigs)
        .set({ apiKey: encryptedKey, isActive: input.isActive })
        .where(eq(aiConfigs.provider, input.provider));
    } else {
      await db.insert(aiConfigs).values({
        provider: input.provider,
        apiKey: encryptedKey,
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
```

- [ ] **Step 5: Modify `testProvider` — decrypt after read**

Change the read section (around line 330):

```typescript
const db = await getDb();
if (!db) return { ok: false, error: "No DB connection" };
const rows = await db.select().from(aiConfigs).where(eq(aiConfigs.provider, input.provider)).limit(1);
const storedKey = rows[0]?.apiKey;
if (!storedKey) return { ok: false, error: "No API key set" };

// Handle both encrypted (ENC1:) and legacy plaintext rows (lazy migration).
let apiKey: string;
try {
  const aad = `aiConfig:${input.provider.toLowerCase()}`;
  apiKey = decryptIfNeeded(storedKey, aad);
} catch (err) {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}
```

- [ ] **Step 6: Run integration tests — catch regressions**

Run: `corepack pnpm test -- server/deep-research.test.ts`

Expected: existing tests pass. If tests that seed `aiConfigs` directly with plaintext values now fail because `testProvider` is called, check whether the seed should use `encrypt(...)` or rely on lazy migration. Either is valid — prefer whichever matches the existing test's intent.

If `deep-research.test.ts` doesn't set `MASTER_ENCRYPTION_KEY` in its setup, add it to the top-level `beforeAll` or equivalent. Use the same `TEST_KEY_B64` value as `crypto.test.ts` for consistency.

- [ ] **Step 7: Run full suite**

Run: `corepack pnpm test`

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add server/routers.ts server/ai/router.ts
git commit -m "feat(admin): encrypt API keys at write, decrypt at test, expose isEncrypted

- server/routers.ts admin.ai.setProviderKey: encrypt(apiKey, masterKey, aad)
  before DB write — no plaintext in aiConfigs.apiKey column for new saves
- admin.ai.testProvider: decryptIfNeeded(storedKey, aad) before provider
  test call — handles both encrypted rows and legacy plaintext rows
- admin.ai.listConfigs: isEncrypted boolean added (prefix check, no decrypt)
  for admin UI migration status visibility
- server/ai/router.ts: export decryptIfNeeded for reuse by testProvider"
```

---

## Task 6: AdminPanel.tsx — `isEncrypted` badge + i18n

**Files:**
- Modify: `client/src/pages/AdminPanel.tsx`
- Modify: `client/src/i18n/hu.ts`
- Modify: `client/src/i18n/en.ts`

- [ ] **Step 1: Add i18n keys — Hungarian**

Edit `client/src/i18n/hu.ts`. In the `admin.ai` block (around line 170-190), add after `notSet`:

```typescript
        configured: "Beállítva",
        notSet: "Nincs megadva",
        encrypted: "🔒 Titkosítva",
        plaintextLegacy: "⚠ Régi (titkosítatlan)",
        keySaved: "API kulcs elmentve",
```

- [ ] **Step 2: Add i18n keys — English**

Edit `client/src/i18n/en.ts`. Find the equivalent block and add:

```typescript
        encrypted: "🔒 Encrypted",
        plaintextLegacy: "⚠ Plaintext (legacy)",
```

Match the existing key order/layout in that file.

- [ ] **Step 3: Extend `ProviderRowProps` + render second badge**

Edit `client/src/pages/AdminPanel.tsx`. Change the `ProviderRowProps` interface (around line 47):

```typescript
interface ProviderRowProps {
  provider: ProviderId;
  hasKey: boolean;
  isEncrypted: boolean;    // NEW
  isActive: boolean;
  onSave: (apiKey: string, isActive: boolean) => void;
  onTest: () => Promise<void>;
  isSaving: boolean;
  isTesting: boolean;
  registerClear?: (fn: () => void) => void;
}
```

Update the function signature (line 58):

```typescript
function ProviderRow({ provider, hasKey, isEncrypted, isActive, onSave, onTest, isSaving, isTesting, registerClear }: ProviderRowProps) {
```

Replace the single Badge render block (around lines 68-73) with:

```typescript
      <div className="flex items-center justify-between">
        <Label className="font-medium">{PROVIDER_LABELS[provider]}</Label>
        <div className="flex items-center gap-2">
          <Badge variant={hasKey ? "default" : "secondary"} className="text-xs">
            {hasKey ? t("admin.ai.configured") : t("admin.ai.notSet")}
          </Badge>
          {hasKey && (
            <Badge
              variant={isEncrypted ? "default" : "destructive"}
              className="text-xs"
            >
              {isEncrypted ? t("admin.ai.encrypted") : t("admin.ai.plaintextLegacy")}
            </Badge>
          )}
        </div>
      </div>
```

Pass the new prop in the caller (around line 315):

```typescript
                        <ProviderRow
                          key={provider}
                          provider={provider}
                          hasKey={config?.hasKey ?? false}
                          isEncrypted={config?.isEncrypted ?? false}
                          isActive={config?.isActive ?? false}
                          // ... rest unchanged
                        />
```

- [ ] **Step 4: Verify TypeScript**

Run: `corepack pnpm tsc --noEmit`

Expected: no TS errors. If `config?.isEncrypted` is typed as possibly undefined but the fallback `?? false` doesn't satisfy — check the trpc response shape inference.

- [ ] **Step 5: Start dev server + smoke test UI**

Run: `corepack pnpm dev`

Manually verify in browser (`http://localhost:3000/admin` → AI Config tab):
- All 3 providers show their "Beállítva"/"Nincs megadva" badge (unchanged behavior)
- Providers with existing plaintext DB rows show ⚠ Plaintext (legacy) badge
- Providers with no key show only the "Nincs megadva" badge (no second badge)

Then in the UI: save a key for one provider (paste any test string → Save).

Refresh the page — that provider now shows 🔒 Titkosítva badge.

Kill dev server (Ctrl+C).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/AdminPanel.tsx client/src/i18n/hu.ts client/src/i18n/en.ts
git commit -m "feat(admin-ui): encryption status badge in provider list

- AdminPanel.tsx ProviderRow: second Badge shows 🔒 Encrypted / ⚠ Plaintext
  (legacy) when hasKey, read-only (no action button — lazy migration suffices)
- i18n keys admin.ai.encrypted + admin.ai.plaintextLegacy (hu + en)
- isEncrypted prop plumbed from listConfigs response through ProviderRowProps"
```

---

## Task 7: Documentation updates

**Files:**
- Modify: `.env.local.example` (if not already updated in Task 0)
- Create or modify: `docs/deployment.md` (if exists; else inline into a README section or skip)

- [ ] **Step 1: Verify `.env.local.example` has the MASTER_ENCRYPTION_KEY section**

Already added in Task 0. Re-read to confirm:

Run: `grep -A5 MASTER_ENCRYPTION .env.local.example`

Expected: the section from Task 0 Step 3 is present. If not, re-add it now.

- [ ] **Step 2: Check for deployment docs**

Run: `ls docs/ 2>&1`

If `docs/deployment.md` exists — modify it. If not, check for `README.md` deployment section. If neither exists, skip this step — the `.env.local.example` comment is sufficient docs for C2b.

- [ ] **Step 3: If deployment docs exist, add a section**

Append to `docs/deployment.md` (or wherever deployment docs live):

```markdown
## API Key Encryption (C2b)

As of C2b (2026-04-18), API keys in `aiConfigs.apiKey` are encrypted at rest using AES-256-GCM envelope encryption. The master key is supplied via the `MASTER_ENCRYPTION_KEY` environment variable.

### Generating a master key

```bash
openssl rand -base64 32
```

Output is a base64-encoded 32-byte string. Store it in your platform's secret manager (Google Secret Manager, Vercel Env, AWS Secrets Manager, etc.) and inject it into the runtime environment as `MASTER_ENCRYPTION_KEY`.

### Deployment checklist

- [ ] `MASTER_ENCRYPTION_KEY` is set in every environment (dev, staging, prod)
- [ ] The value is a base64-encoded 32-byte string (44 chars)
- [ ] The key is NOT committed to git (should only live in secret manager + local `.env.local`)
- [ ] Each environment has a DIFFERENT master key — do NOT share between dev and prod

### Known limitations

**Key rotation:** C2b does NOT support master key rotation. If you need to change the master key, existing `ENC1:` ciphertext rows become undecryptable. Workaround: an admin must re-save every provider key via the admin UI after the rotation. Automated dual-key support and batch re-encryption is C3 scope.

**Migration:** Existing plaintext rows remain plaintext until an admin re-saves them. The admin UI shows a ⚠ Plaintext (legacy) badge on unmigrated rows.
```

- [ ] **Step 4: Commit if any docs changed**

If `docs/deployment.md` was modified:

```bash
git add docs/deployment.md
git commit -m "docs: add C2b master key generation + deployment checklist"
```

If no docs existed and you skipped — skip this commit.

---

## Task 8: End-to-end manual verification

This task is manual smoke testing — no TDD cycle, no commit. Run after all previous tasks are complete and all tests green.

- [ ] **Step 1: Clean DB state**

Start fresh: either clear the `aiConfigs` table or work with a clean local DB.

Run: `corepack pnpm db:studio` → manually clear `aiConfigs` rows (or use `db:push` + a fresh DB file).

- [ ] **Step 2: Start server**

Run: `corepack pnpm dev`

Expected: starts cleanly on port 3000+.

- [ ] **Step 3: Save a plaintext row manually (simulate legacy data)**

Using db:studio or a direct SQL tool:

```sql
INSERT INTO ai_configs (provider, api_key, is_active, updated_at)
VALUES ('openai', 'sk-plaintext-legacy-test-key', 1, datetime('now'));
```

- [ ] **Step 4: Check admin UI shows Plaintext badge**

Browser: `http://localhost:3000/admin` → AI Config tab.

Expected: OpenAI row shows two badges: "Beállítva" + "⚠ Régi (titkosítatlan)".

- [ ] **Step 5: Re-save through UI → verify encryption**

In the UI: paste any test key (e.g., `sk-fresh-test-key-123`) → Save.

Check DB:

```sql
SELECT provider, substr(api_key, 1, 10) AS prefix FROM ai_configs;
```

Expected: `openai | ENC1:AbCd...` (the stored value starts with `ENC1:` — encrypted).

Refresh browser → OpenAI row now shows "🔒 Titkosítva" badge.

- [ ] **Step 6: Test Connection button works on encrypted row**

Click "Kapcsolat Tesztelése" on OpenAI row.

Expected: either success ("Kapcsolat sikeres") if the test key is valid, or a provider error from the actual OpenAI API — but NOT a decryption error. A DecryptionError in this flow would indicate the Task 5 `decryptIfNeeded` integration is broken.

- [ ] **Step 7: Pipeline end-to-end with encrypted key**

Save a real OpenAI key through the admin UI (any valid one). Then navigate to the main app → start a research pipeline.

Expected: pipeline completes phases that use OpenAI (polling, brainstorm) without DecryptionError. If it fails with `DecryptionError`, check `lookupApiKey` integration in Task 3.

- [ ] **Step 8: Kill server + note verification results**

Ctrl+C the dev server.

If all 7 smoke steps passed, the C2b implementation is verified end-to-end.

---

## Post-implementation: Push branch

After all tasks complete, the subagent-driven-development skill will dispatch a final code reviewer and offer execution choice via `superpowers:finishing-a-development-branch`. That skill presents the push/PR options.

If choosing option 2 (create PR): the `feat/c2b-encryption` branch gets pushed to origin for the first time at that point, then `gh pr create` opens PR #5 for review.

---

## Skills referenced

- `@superpowers:subagent-driven-development` — task-by-task execution with two-stage review
- `@superpowers:executing-plans` — inline alternative
- `@superpowers:test-driven-development` — TDD cycle for each task
- `@superpowers:finishing-a-development-branch` — push / PR / merge workflow

## Test count projection

- `server/ai/crypto.test.ts`: ~16 new
- `server/ai/router.test.ts`: ~5 new
- `server/ai/fallback.test.ts`: ~4 new

**Total new tests: ~25.** Full suite target: ~172 + 25 = ~197 tests passing after C2b merge.

---

## Task summary checklist

- [ ] Task 0: Master key generation + env setup
- [ ] Task 1: `server/ai/crypto.ts` + `crypto.test.ts` (primitives + singleton + DecryptionError)
- [ ] Task 2: `server/_core/index.ts` startup validation
- [ ] Task 3: `server/ai/router.ts` `decryptIfNeeded` + `lookupApiKey` integration
- [ ] Task 4: `server/ai/fallback.ts` `DecryptionError` non-eligible branch
- [ ] Task 5: `server/routers.ts` encrypt-at-write + decrypt-at-test + `isEncrypted` in list
- [ ] Task 6: `AdminPanel.tsx` isEncrypted badge + i18n (hu + en)
- [ ] Task 7: Documentation updates
- [ ] Task 8: End-to-end manual verification
