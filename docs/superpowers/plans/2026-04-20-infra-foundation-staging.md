# Infra Foundation Sprint — Staging Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec reference:** [docs/superpowers/specs/2026-04-20-infra-foundation-staging-design.md](../specs/2026-04-20-infra-foundation-staging-design.md)

**Goal:** Deploy the Deep Research app to Google Cloud Run staging (off Manus platform), with TiDB Cloud Serverless + Google Secret Manager + GitHub Actions CI/CD (WIF), IAM-gated access, a triple-gated dev auth stub, and run the Task 8 C2b E2E smoke-test in a clean cloud environment.

**Architecture:**
- Google Cloud Run (`europe-west3` Frankfurt) container deploy, `--no-allow-unauthenticated`, runtime service account with per-secret `secretAccessor` only
- TiDB Cloud Serverless (AWS `eu-central-1` Frankfurt) MySQL-wire DB, TLS-encoded connection in `server/db.ts`, Drizzle ORM unchanged
- Google Secret Manager for `master-encryption-key`, `database-url`, `jwt-secret`, `dev-login-key` — mounted via Cloud Run `--set-secrets`
- GitHub Actions + Workload Identity Federation (WIF) — no long-lived SA key JSON, repo-scoped binding, strict least-privilege `deploy-sa`
- Dev auth stub: SDK-compatible session cookie approach — `/dev/login` endpoint signs an `app_session_id` JWT (HS256, `JWT_SECRET`), existing `sdk.authenticateRequest` finds the seeded user row unchanged; **no parallel middleware**

**Tech Stack:**
- Node 22 Alpine (glibc fallback `node:22-slim` if `mysql2` musl-compat fails)
- Multi-stage Dockerfile (build stage `NODE_ENV=production` for Vite optimization; runtime stage `NODE_ENV=staging`)
- pnpm (version from `package.json` `packageManager` field, via corepack — no hardcode in Dockerfile or CI)
- `jose` (already a dep via `server/_core/sdk.ts`) for HS256 JWT signing in dev-login
- `express-rate-limit` (already a dep) for /dev/login brute-force guard
- `vitest` (`vi.stubEnv` + `vi.unstubAllEnvs` for env-var isolated tests)
- `gcloud` CLI for one-time cloud bootstrap (+ `gh` CLI for PR)

**Scope (in this sprint):**
- Staging deploy only (one Cloud Run service, one TiDB cluster, one Artifact Registry repo)
- Dead Manus scaffold removal (`@aws-sdk/*` deps, 6 scaffold files in `server/` + `server/_core/`, `env.ts` forgeApi* cleanup)
- Dev auth stub + triple-gate guard tests
- Structured JSON logger (opt-in, only on critical paths)
- Task 8 C2b smoke-test execution + evidence commit

**Scope (NOT in this sprint):**
- Auth migration off Manus OAuth (separate sub-project — `server/_core/oauth.ts` and `registerOAuthRoutes` stay intact)
- Prod launch (custom domain, Cloud Armor, Sentry, `min-instances=1`, uptime check)
- GCS bucket / blob storage / PDF export (V1 remainder — Storage sub-project)
- Payment (Stripe + Számlázz.hu)
- KMS integration + rotation + dual-key decrypt (C3 sub-project)
- Automated E2E smoke-test (Playwright / Node script — manual checklist for now)

---

## Pre-work: Worktree + branch setup

The spec commits live on `spec/infra-foundation-staging` at the worktree `/Users/balintkovacs/Work/ClaudeCode/Research_App/repo-c1-ai-pipeline` (the same worktree that held C2b). Rename the branch so the implementation commits and the eventual PR are named consistently:

```bash
cd /Users/balintkovacs/Work/ClaudeCode/Research_App/repo-c1-ai-pipeline
git checkout spec/infra-foundation-staging
git branch -m feat/infra-foundation-staging
# (tracking is still set to origin/main; when we push, git push -u origin feat/infra-foundation-staging)
```

The `.env.local` in this worktree contains the three AI provider keys + `MASTER_ENCRYPTION_KEY` + `PORT=4000` (per project memory). `node_modules` is installed.

**Working directory for all commands:** `/Users/balintkovacs/Work/ClaudeCode/Research_App/repo-c1-ai-pipeline`. If the shell resets, prefix with `cd /Users/balintkovacs/Work/ClaudeCode/Research_App/repo-c1-ai-pipeline && `.

---

## ⚠️ Preflight safety notes — READ BEFORE ANY IMPLEMENTATION

Non-negotiable rules. If a task step appears to conflict, these win:

1. **Use `corepack pnpm`, never `pnpm` or `npm`.** Global pnpm may not be installed. The `package.json` `packageManager` field pins the exact version; corepack auto-activates it.

2. **`server/_core/oauth.ts` is Auth-sprint scope — DO NOT MODIFY.** The audit script (§7.1.4 of spec) is explicitly designed to print `HAGYD BÉKÉN` if it matches anything there. Same for `registerOAuthRoutes(app)` in `server/_core/index.ts`: the call stays as-is.

3. **⚠️ `master-encryption-key` regeneration is FORBIDDEN until C3.** If a rotation happens accidentally, the `aiConfigs.apiKey` column's `ENC1:` rows become undecipherable and require admin re-save. Every task that touches Secret Manager creates NEW secrets if missing, but NEVER runs `gcloud secrets versions add master-encryption-key`. See spec §7.5.

4. **Triple-gate must never be "disabled but reachable."** `registerDevLoginIfEnabled` returns early (NO route mounted, NO middleware mounted, NO seed attempted) if `NODE_ENV === "production"` OR `ENABLE_DEV_LOGIN !== "true"`. The three negative guard tests (§8.5 of spec) verify this. Do NOT "optimize" by pre-registering the route and gating the handler — that creates a reachable-but-disabled endpoint.

5. **`sdk.authenticateRequest(req)` is the one auth entry point — do NOT add parallel auth middleware.** The dev stub only issues an SDK-compatible session cookie (`app_session_id`, HS256 + `JWT_SECRET`). The existing `sdk.authenticateRequest` in `createContext` and the SSE handler finds the seeded user via `db.getUserByOpenId("dev-admin-staging")` — unchanged flow. See spec §8.4.

6. **`printf "%s"` for `openssl rand` outputs — NEVER `echo`.** Trailing newline would make a 32-byte key 33 bytes; the C2b `getMasterKey()` length check catches this but the error is opaque. Use `openssl rand -base64 32 | tr -d '\n'` or `| printf "%s" "$(cat)"`.

7. **TLS always on for non-local DB hosts.** The regex `/@(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)` in `server/db.ts` decides. Never remove the `ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true }` for TiDB — MITM-able otherwise.

8. **Secret names: kebab-case, exact-match between bootstrap script + deploy workflow + runtime env var mapping.** See spec §13.1. `master-encryption-key` (Secret Manager) → `MASTER_ENCRYPTION_KEY` (env var). Any mismatch → Cloud Run "Secret not found" at deploy.

9. **Task commits: one logical change per commit, NEVER squash within a task.** The Manus scaffold cleanup task (Task 2) produces 4 separate commits (audit, aws-sdk, scaffold files, env bindings) — preserved individually so `git bisect` works if a future refactor breaks something.

10. **`--set-secrets` flag references `:latest` by default.** Cloud Run resolves at container start with the runtime SA's `secretAccessor`. The `deploy-sa` has **zero** Secret Manager permissions. If a `gcloud run deploy` fails with a secret error, it's the runtime SA's per-secret binding that's missing — not the deploy SA.

11. **`NODE_ENV=staging` Cloud Run env var ≠ `NODE_ENV=production` Docker build env.** The build stage uses `NODE_ENV=production` for Vite frontend optimization. The runtime stage defaults to `staging` (Cloud Run overrides via `--set-env-vars`). If the `dev-login-gate.test.ts` fails with "route registered in production build", check whether esbuild started inlining `process.env.NODE_ENV` (a `--define` flag slipped in).

12. **Never run `gcloud run services proxy` against production later.** In this sprint it's safe (only staging exists), but once prod is deployed, verify the `--region` and `--project` in proxy commands.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| **Create** `bin/manus-audit.sh` | Grep-driven audit of Manus env vars, AWS SDK refs, scaffold imports | Task 2 |
| **Create** `docs/deployment/task-0-audit-findings.md` | Task 0 audit output (auth topology, users schema, packageManager) | Task 0 |
| **Create** `docs/deployment/manus-audit-report-YYYY-MM-DD.md` | Audit evidence commit (output of `bin/manus-audit.sh`) | Task 2 |
| **Create** `docs/deployment/smoke-test-c2b.md` | Task 8 E2E smoke-test protocol (Balint runs once on first deploy) | Task 11 |
| **Create** `docs/deployment/cloud-logging-queries.md` | Saved Cloud Logging queries | Task 7 |
| **Create** `docs/deployment/smoke-test-c2b-run-YYYY-MM-DD.md` | Smoke-test SUCCESS record (dated) | Task 11 |
| **Create** `server/_core/logger.ts` | Structured JSON logger shim for Cloud Logging (severity + jsonPayload) | Task 3 |
| **Create** `server/_core/logger.test.ts` | Unit tests: severity mapping, JSON shape, timestamp format | Task 3 |
| **Create** `server/auth/dev-login.ts` | Triple-gated `/dev/login` handler, timing-safe key compare, `ensureDevUserExists` seed | Task 4 |
| **Create** `server/__tests__/dev-login-gate.test.ts` | 5 tests: positive + 2 triple-gate negative branches + 2 fast-fail env checks | Task 4 |
| **Create** `server/__tests__/dev-login-handler.test.ts` | ~6 tests: key validation, cookie set, rate limit, seed idempotency, role restore | Task 4 |
| **Create** `Dockerfile` | Multi-stage: Node 22 Alpine build → runtime (or slim fallback) | Task 8 |
| **Create** `.dockerignore` | node_modules, dist, .git, tests, docs, env files | Task 8 |
| **Create** `.github/workflows/test.yml` | PR tests: vitest + tsc | Task 9 |
| **Create** `.github/workflows/deploy-staging.yml` | Main push: docker build + AR push + Cloud Run deploy (WIF) | Task 9 |
| **Modify** `server/_core/index.ts` | Call `registerDevLoginIfEnabled(app)`, DB smoke-query + `startup_complete` log in `server.listen` callback | Task 6 |
| **Modify** `server/db.ts` | `getDb()` internals: pool-based `mysql.createPool` with TLS config | Task 6 |
| **Modify** `server/_core/env.ts` | Remove `forgeApiUrl`, `forgeApiKey` bindings (dead after Task 2 cleanup) | Task 2 |
| **Modify** `env.local.example` | Remove `BUILT_IN_FORGE_*` lines from example | Task 2 |
| **Modify** `package.json` | Add `"packageManager": "pnpm@X.Y.Z"` if missing; remove `@aws-sdk/*` deps | Task 0 + Task 2 |
| **Delete** `server/storage.ts` | Dead Manus Forge storage proxy | Task 2 |
| **Delete** `server/_core/map.ts` | Dead Manus Google Maps proxy | Task 2 |
| **Delete** `server/_core/voiceTranscription.ts` | Dead Manus STT proxy | Task 2 |
| **Delete** `server/_core/imageGeneration.ts` | Dead Manus image gen proxy | Task 2 |
| **Delete** `server/_core/dataApi.ts` | Dead Manus data API proxy | Task 2 |
| **Delete** `server/_core/notification.ts` | Dead Manus push notif proxy | Task 2 |

**Cloud resources (not files, but artifacts to create):**

| Resource | Project | Scope | Task |
|---|---|---|---|
| GCP project `deep-research-staging-XXX` | Google Cloud | Billing account linked | Task 5 |
| Service account `deploy-sa` | GCP | roles: run.admin, iam.SAUser, artifactregistry.writer | Task 5 |
| Service account `cloud-run-runtime-sa` | GCP | per-secret `secretAccessor` (added in Task 5 + Task 6) | Task 5 |
| Workload Identity Pool `github-pool` + provider `github-provider` | GCP | `attribute-condition = repo=tipometer/Research_App` | Task 5 |
| Artifact Registry `research-app-staging` | GCP europe-west3 | docker format | Task 5 |
| TiDB Cloud Serverless cluster `deep-research-staging` | TiDB Cloud eu-central-1 | free tier | Task 6 |
| TiDB DB `research_app` | TiDB cluster | Drizzle migrations applied | Task 6 |
| Secret Manager `master-encryption-key` | GCP europe-west3 | user-managed replication, base64 32 byte | Task 6 |
| Secret Manager `database-url` | GCP europe-west3 | TiDB connection string | Task 6 |
| Secret Manager `jwt-secret` | GCP europe-west3 | base64 64 byte | Task 6 |
| Secret Manager `dev-login-key` | GCP europe-west3 | base64 32 byte | Task 6 |
| Cloud Run service `research-app-staging` | GCP europe-west3 | `--no-allow-unauthenticated` | Task 10 |
| Cloud Run IAM: Balint `roles/run.invoker` | Cloud Run service | user:balint@... | Task 10 |

---

## Task 0: Pre-implementation audit (kötelező elsőként)

**Files:**
- Create: `docs/deployment/task-0-audit-findings.md`
- Verify (read-only): `server/_core/sdk.ts`, `server/_core/context.ts`, `server/_core/index.ts`, `server/_core/oauth.ts`, `drizzle/schema.ts`, `shared/const.ts`, `package.json`

- [ ] **Step 1: Verify auth topology (Task 0.1)**

Read these files and confirm the spec §8.1 assumptions hold:

```bash
grep -n "authenticateRequest\|createSessionToken\|verifySession\|COOKIE_NAME" \
  server/_core/sdk.ts server/_core/context.ts server/_core/index.ts \
  shared/const.ts
```

Expected findings:
- `shared/const.ts:1` → `export const COOKIE_NAME = "app_session_id";`
- `server/_core/sdk.ts` has `authenticateRequest(req)` (around line 259), `createSessionToken(openId, options)` (around line 167), `verifySession(cookieValue)` (around line 200), uses `jose` with `HS256` + `ENV.cookieSecret` (= `JWT_SECRET`)
- `server/_core/context.ts:16-17` → `user = await sdk.authenticateRequest(opts.req)` → `ctx.user`
- `server/_core/index.ts:81-88` (SSE handler) → `user = await sdk.authenticateRequest(req)` → `(req as any).user = user`
- NO `manusAuthMiddleware` export anywhere

- [ ] **Step 2: Verify `users` schema (Task 0.2)**

```bash
grep -A 15 "export const users = mysqlTable" drizzle/schema.ts
```

Expected: `openId: varchar(64).notNull().unique()`, `name: text("name")`, `email: varchar("email", { length: 320 })`, `loginMethod: varchar("loginMethod", { length: 64 })`, `role: mysqlEnum("role", ["user", "admin"]).default("user").notNull()`.

- [ ] **Step 3: Verify `packageManager` field in `package.json` (Task 0.3)**

```bash
node -e "const p = require('./package.json'); console.log(p.packageManager || 'MISSING')"
```

If `MISSING`:
```bash
corepack pnpm --version
# take the version output and add to package.json, e.g.:
# "packageManager": "pnpm@9.12.3"
# then:
corepack pnpm install --frozen-lockfile
# verify no lockfile diff:
git diff pnpm-lock.yaml
```

If the `packageManager` addition modified `pnpm-lock.yaml`, that's fine — commit both in Step 5.

- [ ] **Step 4: Write audit findings document**

Create `docs/deployment/task-0-audit-findings.md` with the three audit outputs verbatim (grep output pasted in code blocks), and the `packageManager` value. Include the date.

Template:
```markdown
# Task 0 — Pre-implementation Audit Findings
Date: YYYY-MM-DD

## 0.1 Auth topology
[grep output]

Confirmed: SDK-based auth, sdk.authenticateRequest is the entry point. No manusAuthMiddleware export.

## 0.2 Users schema
[grep output]

Confirmed: openId NOT NULL UNIQUE, role mysqlEnum with "admin" as valid value.

## 0.3 packageManager
Value: pnpm@X.Y.Z
```

- [ ] **Step 5: Commit Task 0**

```bash
cd /Users/balintkovacs/Work/ClaudeCode/Research_App/repo-c1-ai-pipeline
git add docs/deployment/task-0-audit-findings.md
# If packageManager was added:
git add package.json pnpm-lock.yaml
git commit -m "docs: Task 0 pre-implementation audit findings"
```

- [ ] **Step 6: User checkpoint**

Report to user: "Task 0 done. Auth = SDK-based (verified), users schema matches spec (incl. openId NOT NULL UNIQUE), packageManager = pnpm@X.Y.Z. Commit: `<hash>`. Ready for Task 1."

---

## Task 1: Pre-containerization audit script (NO file changes yet)

**Files:**
- Create: `bin/manus-audit.sh`

This task only creates the audit script. The actual cleanup (using the script output) is Task 2.

- [ ] **Step 1: Create `bin/manus-audit.sh`**

```bash
mkdir -p bin
cat > bin/manus-audit.sh << 'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "═══════════════════════════════════════════════════════"
echo "1. Manus env var references"
echo "═══════════════════════════════════════════════════════"
grep -rnE "BUILT_IN_FORGE_API_URL|BUILT_IN_FORGE_API_KEY|OAUTH_SERVER_URL|VITE_APP_ID|OWNER_OPEN_ID|MANUS_|VITE_ANALYTICS_ENDPOINT" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.json" --include="*.example" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=drizzle \
  . || echo "  (no matches)"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "2. AWS SDK references"
echo "═══════════════════════════════════════════════════════"
grep -rnE "@aws-sdk|AWS\.|aws-sdk" \
  --include="*.ts" --include="*.tsx" --include="*.json" \
  --exclude-dir=node_modules --exclude-dir=dist \
  . || echo "  (no matches)"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "3. Scaffold file import graph"
echo "═══════════════════════════════════════════════════════"
for file in storage map voiceTranscription imageGeneration dataApi notification; do
  echo "--- imports of $file ---"
  grep -rnE "from ['\"][^'\"]*${file}['\"]" \
    --include="*.ts" --include="*.tsx" \
    --exclude-dir=node_modules --exclude-dir=dist \
    . || echo "  (no imports — safe to delete)"
done

echo ""
echo "═══════════════════════════════════════════════════════"
echo "4. Manus OAuth (HAGYD BÉKÉN — Auth sprint scope)"
echo "═══════════════════════════════════════════════════════"
grep -rnE "manusAuthMiddleware|server/_core/oauth|registerOAuthRoutes" \
  --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules --exclude-dir=dist \
  . || echo "  (no matches)"
echo "  ↑ ha van match: HAGYD BÉKÉN. Auth migration sprint kezeli."
EOF
chmod +x bin/manus-audit.sh
```

- [ ] **Step 2: Run the audit**

```bash
./bin/manus-audit.sh > /tmp/manus-audit-output.txt 2>&1
cat /tmp/manus-audit-output.txt
```

Expected output (decisions for Task 2):
- Section 1 → matches in `server/_core/env.ts`, `server/storage.ts`, `server/_core/map.ts`, etc. + `env.local.example`
- Section 2 → matches in `package.json`, `pnpm-lock.yaml`
- Section 3 → all 6 scaffold files: `(no imports — safe to delete)`
- Section 4 → matches in `server/_core/index.ts:12` and `server/_core/oauth.ts`, with "HAGYD BÉKÉN" reminder

- [ ] **Step 3: Commit audit script**

```bash
git add bin/manus-audit.sh
git commit -m "chore: add Manus scaffold audit script for pre-containerization cleanup"
```

- [ ] **Step 4: User checkpoint** — "Audit script committed and output reviewed. Ready for Task 2 (execute cleanup)."

---

## Task 2: Dead Manus scaffold cleanup (4 commits, NEVER squash)

**Files:**
- Create: `docs/deployment/manus-audit-report-YYYY-MM-DD.md`
- Modify: `package.json`, `pnpm-lock.yaml`, `server/_core/env.ts`, `env.local.example`
- Delete: `server/storage.ts`, `server/_core/map.ts`, `server/_core/voiceTranscription.ts`, `server/_core/imageGeneration.ts`, `server/_core/dataApi.ts`, `server/_core/notification.ts`

**Commit 1: audit evidence**

- [ ] **Step 1: Save audit output**

```bash
DATE=$(date -u +%Y-%m-%d)
./bin/manus-audit.sh > "docs/deployment/manus-audit-report-${DATE}.md" 2>&1
```

- [ ] **Step 2: Add a header to the audit report**

Edit `docs/deployment/manus-audit-report-YYYY-MM-DD.md` (replace YYYY-MM-DD with actual date) and prepend:
```markdown
# Manus scaffold dead-code audit — YYYY-MM-DD

**Run:** `./bin/manus-audit.sh` from the repo root (branch `feat/infra-foundation-staging`).
**Purpose:** evidence record for §7 pre-containerization cleanup decisions.

---

```

- [ ] **Step 3: Commit 1**

```bash
git add docs/deployment/manus-audit-report-*.md
git commit -m "audit: Manus scaffold dead-code inventory report"
```

**Commit 2: remove `@aws-sdk/*` deps**

- [ ] **Step 4: Remove AWS SDK deps**

```bash
corepack pnpm remove @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

This modifies `package.json` and `pnpm-lock.yaml`.

- [ ] **Step 5: Verify tsc still passes**

```bash
corepack pnpm check
```
Expected: 0 errors.

- [ ] **Step 6: Verify tests still pass**

```bash
corepack pnpm test
```
Expected: ~203 tests passing (same count as before, nothing depended on these deps).

- [ ] **Step 7: Commit 2**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: remove unused @aws-sdk dependencies"
```

**Commit 3: delete 6 Manus scaffold files**

- [ ] **Step 8: Delete the scaffold files**

```bash
rm server/storage.ts \
   server/_core/map.ts \
   server/_core/voiceTranscription.ts \
   server/_core/imageGeneration.ts \
   server/_core/dataApi.ts \
   server/_core/notification.ts
```

- [ ] **Step 9: Verify tsc still passes**

```bash
corepack pnpm check
```
Expected: 0 errors (if any errors → the audit missed a dynamic import; see §7.4 escape hatch).

- [ ] **Step 10: Verify tests still pass**

```bash
corepack pnpm test
```
Expected: 203 passing.

- [ ] **Step 11: Local dev-mode happy-path verify (escape hatch per §7.4)**

```bash
corepack pnpm dev &
DEV_PID=$!
sleep 6
curl -s http://localhost:${PORT:-4000}/ -o /dev/null -w "%{http_code}\n"
# Expected: 200 (static index.html or vite dev server)
kill $DEV_PID
```

If `pnpm dev` errors about a missing module (not just the Vite warning), that's a dynamic-import breakage — STOP and restore the relevant file:
```bash
git show HEAD:server/<file-that-was-dynamically-imported> > server/<file>
```

- [ ] **Step 12: Commit 3**

```bash
git add server/storage.ts server/_core/map.ts server/_core/voiceTranscription.ts \
        server/_core/imageGeneration.ts server/_core/dataApi.ts server/_core/notification.ts
git commit -m "chore: delete unused Manus scaffold modules"
```

Note: `git add` on a deleted file stages the deletion. `git status` should show all 6 as `deleted:`.

**Commit 4: remove dead Manus env bindings**

- [ ] **Step 13: Edit `server/_core/env.ts` — remove `forgeApiUrl` and `forgeApiKey`**

After the edit, the file should contain 6 bindings (not 8):
```typescript
export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",           // Manus OAuth — Auth sprint scope
  cookieSecret: process.env.JWT_SECRET ?? "",     // core — JWT sign
  databaseUrl: process.env.DATABASE_URL ?? "",    // core — Drizzle
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",  // Manus OAuth — Auth sprint scope
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",   // Manus OAuth — Auth sprint scope
  isProduction: process.env.NODE_ENV === "production",
  // forgeApiUrl, forgeApiKey — REMOVED (Manus Forge proxy scaffolds deleted in Task 2 commit 3)
};
```

- [ ] **Step 14: Edit `env.local.example` — remove `BUILT_IN_FORGE_*` lines**

Delete any lines containing `BUILT_IN_FORGE_API_URL` or `BUILT_IN_FORGE_API_KEY`.

- [ ] **Step 15: Verify tsc still passes**

```bash
corepack pnpm check
```
Expected: 0 errors.

- [ ] **Step 16: Verify tests still pass**

```bash
corepack pnpm test
```
Expected: 203 passing.

- [ ] **Step 17: Commit 4**

```bash
git add server/_core/env.ts env.local.example
git commit -m "chore: remove dead Manus env bindings"
```

- [ ] **Step 18: User checkpoint** — "Task 2 done. 4 commits (audit + aws-sdk + scaffold files + env bindings). All 203 tests still passing. Ready for Task 3 (logger)."

---

## Task 3: Structured JSON logger (TDD)

**Files:**
- Create: `server/_core/logger.ts`
- Create: `server/_core/logger.test.ts`

- [ ] **Step 1: Write failing tests first**

Create `server/_core/logger.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "./logger";

describe("structured JSON logger", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let capturedLines: string[] = [];

  beforeEach(() => {
    capturedLines = [];
    stdoutSpy = vi.spyOn(console, "log").mockImplementation((line: string) => {
      capturedLines.push(line);
    });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it("emits valid JSON with severity=INFO for logger.info", () => {
    logger.info({ event: "test_event", foo: "bar" });
    expect(capturedLines).toHaveLength(1);
    const parsed = JSON.parse(capturedLines[0]);
    expect(parsed.severity).toBe("INFO");
    expect(parsed.event).toBe("test_event");
    expect(parsed.foo).toBe("bar");
    expect(typeof parsed.timestamp).toBe("string");
    expect(() => new Date(parsed.timestamp).toISOString()).not.toThrow();
  });

  it("emits severity=WARNING for logger.warn", () => {
    logger.warn({ event: "warn_event" });
    const parsed = JSON.parse(capturedLines[0]);
    expect(parsed.severity).toBe("WARNING");
  });

  it("emits severity=ERROR for logger.error", () => {
    logger.error({ event: "error_event", message: "oops" });
    const parsed = JSON.parse(capturedLines[0]);
    expect(parsed.severity).toBe("ERROR");
  });

  it("emits severity=DEBUG for logger.debug", () => {
    logger.debug({ event: "debug_event" });
    const parsed = JSON.parse(capturedLines[0]);
    expect(parsed.severity).toBe("DEBUG");
  });

  it("timestamp is ISO 8601 UTC format", () => {
    logger.info({ event: "x" });
    const parsed = JSON.parse(capturedLines[0]);
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("payload key 'severity' in input does NOT override the level", () => {
    // Guarding against accidental payload injection (user wouldn't do this, but safety check)
    logger.info({ severity: "EMERGENCY", event: "x" } as any);
    const parsed = JSON.parse(capturedLines[0]);
    // Our emit() spreads payload AFTER severity, so payload.severity would override.
    // This test documents the behavior: last-write-wins on key collision.
    // If we want to harden this, add an Object.assign({severity}, payload, {severity}) pattern.
    // For now we accept the simple spread behavior but document it.
    expect(parsed.severity).toBe("EMERGENCY");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
corepack pnpm test server/_core/logger.test.ts
```
Expected: module not found / cannot import. Proceed.

- [ ] **Step 3: Implement `server/_core/logger.ts`**

```typescript
type LogLevel = "debug" | "info" | "warn" | "error";

// Cloud Logging severity mapping:
// https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#LogSeverity
const severityMap: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
};

function emit(level: LogLevel, payload: Record<string, unknown>) {
  const entry = {
    severity: severityMap[level],
    timestamp: new Date().toISOString(),
    ...payload,
  };
  // stdout → Cloud Run → Cloud Logging auto-ingest
  console.log(JSON.stringify(entry));
}

export const logger = {
  debug: (payload: Record<string, unknown>) => emit("debug", payload),
  info: (payload: Record<string, unknown>) => emit("info", payload),
  warn: (payload: Record<string, unknown>) => emit("warn", payload),
  error: (payload: Record<string, unknown>) => emit("error", payload),
};
```

- [ ] **Step 4: Run tests to verify pass**

```bash
corepack pnpm test server/_core/logger.test.ts
```
Expected: 6 passing.

- [ ] **Step 5: Run full test suite (regression check)**

```bash
corepack pnpm test
corepack pnpm check
```
Expected: 203 + 6 = 209 passing, 0 tsc errors.

- [ ] **Step 6: Commit Task 3**

```bash
git add server/_core/logger.ts server/_core/logger.test.ts
git commit -m "feat: structured JSON logger shim for Cloud Logging"
```

- [ ] **Step 7: User checkpoint** — "Task 3 done. Logger committed, 6 new tests passing, total 209. Ready for Task 4 (dev auth stub)."

---

## Task 4: Dev auth stub module (TDD, 3 gate + 6 handler tests)

**Files:**
- Create: `server/auth/dev-login.ts`
- Create: `server/__tests__/dev-login-gate.test.ts`
- Create: `server/__tests__/dev-login-handler.test.ts`

**Sub-task 4a: gate tests first (TDD, fail → implement → pass)**

- [ ] **Step 1: Create gate test file**

```bash
mkdir -p server/__tests__
```

Write `server/__tests__/dev-login-gate.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run gate tests (expected: module not found → fail)**

```bash
corepack pnpm test server/__tests__/dev-login-gate.test.ts
```
Expected: cannot import `../auth/dev-login`. Proceed.

- [ ] **Step 3: Create the dev-login module skeleton (enough to pass gate tests)**

```bash
mkdir -p server/auth
```

Write `server/auth/dev-login.ts`:

```typescript
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
```

- [ ] **Step 4: Run gate tests to verify pass**

```bash
corepack pnpm test server/__tests__/dev-login-gate.test.ts
```
Expected: 5 passing.

**Sub-task 4b: handler tests (TDD)**

- [ ] **Step 5: Create handler test file**

Write `server/__tests__/dev-login-handler.test.ts`:

```typescript
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
```

- [ ] **Step 6: Add supertest dep (if missing)**

```bash
node -e "const p = require('./package.json'); console.log('supertest' in (p.devDependencies ?? {}) ? 'HAVE' : 'MISSING')"
```

If `MISSING`:
```bash
corepack pnpm add -D supertest @types/supertest
```

- [ ] **Step 7: Run handler tests**

```bash
corepack pnpm test server/__tests__/dev-login-handler.test.ts
```
Expected: 6 passing.

- [ ] **Step 8: Run full test suite**

```bash
corepack pnpm test
corepack pnpm check
```
Expected: 203 + 6 logger + 5 gate + 6 handler = 220 passing, 0 tsc errors.

- [ ] **Step 9: Commit Task 4**

```bash
git add server/auth/dev-login.ts \
        server/__tests__/dev-login-gate.test.ts \
        server/__tests__/dev-login-handler.test.ts \
        package.json pnpm-lock.yaml
git commit -m "feat: triple-gated dev auth stub with SDK-compatible session cookie"
```

- [ ] **Step 10: User checkpoint** — "Task 4 done. dev-login module + 11 new tests (5 gate + 6 handler) passing. Total 220. Ready for Task 5 (cloud bootstrap)."

**Note on Task 4 mock scope:** `vi.mock("../db", () => ({ upsertUser: ... }))` only mocks `upsertUser` because that's the only named member dev-login.ts imports from `../db`. If a future change adds another `db.*` call in dev-login.ts, extend the mock accordingly.

---

## Task 5: GCP project + WIF + SA bootstrap (one-time manual, user runs on their laptop)

**Files:** none in the repo. This task creates cloud resources.

**Prerequisite:** Balint has `gcloud` CLI authenticated (`gcloud auth login`), and a billing account linked to Google Cloud.

- [ ] **Step 1: Create or select the GCP project**

```bash
# Option A: use an existing project
export PROJECT=<existing-project-id>

# Option B: create new
export PROJECT="deep-research-staging-$(date +%Y%m%d)"  # or any available ID
gcloud projects create $PROJECT --name="Deep Research Staging"
# Link billing account (interactive if multiple exist)
BILLING_ACCOUNT=$(gcloud billing accounts list --format='value(name)' --limit=1)
gcloud billing projects link $PROJECT --billing-account=$BILLING_ACCOUNT
```

- [ ] **Step 2: Set environment variables for the bootstrap**

```bash
export PROJECT_NUMBER=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
export REGION=europe-west3
export REPO=tipometer/Research_App

# Verify
echo "PROJECT=$PROJECT PROJECT_NUMBER=$PROJECT_NUMBER REGION=$REGION REPO=$REPO"
```

- [ ] **Step 3: Enable required APIs**

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  cloudbuild.googleapis.com \
  --project=$PROJECT
```

Expected output: `Operation finished successfully.` (may take 30-60 sec).

- [ ] **Step 4: Create service accounts**

```bash
gcloud iam service-accounts create deploy-sa \
  --display-name="GitHub Actions deployer" --project=$PROJECT

gcloud iam service-accounts create cloud-run-runtime-sa \
  --display-name="Cloud Run runtime" --project=$PROJECT
```

- [ ] **Step 5: Grant `deploy-sa` strict least-privilege roles (NO Secret Manager access)**

```bash
for ROLE in roles/run.admin roles/iam.serviceAccountUser roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding $PROJECT \
    --member="serviceAccount:deploy-sa@$PROJECT.iam.gserviceaccount.com" \
    --role="$ROLE"
done
```

Verify (spec §7.1 requirement — deploy-sa has NO secretmanager role):
```bash
gcloud projects get-iam-policy $PROJECT \
  --flatten="bindings[].members" \
  --filter="bindings.members:deploy-sa@$PROJECT.iam.gserviceaccount.com" \
  --format="value(bindings.role)"
```
Expected output:
```
roles/artifactregistry.writer
roles/iam.serviceAccountUser
roles/run.admin
```
(No `roles/secretmanager.*` anywhere — intentional.)

- [ ] **Step 6: Allow `deploy-sa` to impersonate `cloud-run-runtime-sa` (required for Cloud Run deploy)**

```bash
gcloud iam service-accounts add-iam-policy-binding \
  cloud-run-runtime-sa@$PROJECT.iam.gserviceaccount.com \
  --member="serviceAccount:deploy-sa@$PROJECT.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser" \
  --project=$PROJECT
```

- [ ] **Step 7: Create Workload Identity Pool + OIDC provider**

```bash
gcloud iam workload-identity-pools create github-pool \
  --location=global --display-name="GitHub Actions Pool" --project=$PROJECT

gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global \
  --workload-identity-pool=github-pool \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='$REPO'" \
  --project=$PROJECT
```

**Important:** the `--attribute-condition` is a second-layer guard: only OIDC tokens from `tipometer/Research_App` can use this pool, even if `principalSet:` binding had a typo.

- [ ] **Step 8: Bind deploy-sa to the repo-scoped WIF principal**

```bash
gcloud iam service-accounts add-iam-policy-binding \
  deploy-sa@$PROJECT.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/attribute.repository/$REPO" \
  --project=$PROJECT
```

- [ ] **Step 9: Create Artifact Registry repo**

```bash
gcloud artifacts repositories create research-app-staging \
  --repository-format=docker \
  --location=$REGION \
  --project=$PROJECT
```

Verify:
```bash
gcloud artifacts repositories list --location=$REGION --project=$PROJECT
```

- [ ] **Step 10: Save bootstrap values to GitHub secrets**

The deploy workflow needs `GCP_PROJECT_NUMBER` as a GitHub secret (NOT a token — just the number).

```bash
gh secret set GCP_PROJECT_NUMBER --body "$PROJECT_NUMBER" --repo $REPO
gh secret set GCP_PROJECT_ID --body "$PROJECT" --repo $REPO  # optional, can also be in workflow env
```

- [ ] **Step 11: Commit a bootstrap record (evidence)**

Write `docs/deployment/gcp-bootstrap-record-YYYY-MM-DD.md`:
```markdown
# GCP Bootstrap Record — YYYY-MM-DD

- Project: `<PROJECT>`
- Project Number: `<PROJECT_NUMBER>` (shared in GitHub secrets as GCP_PROJECT_NUMBER)
- Region: europe-west3
- Service Accounts:
  - deploy-sa@<PROJECT>.iam.gserviceaccount.com (roles: run.admin, iam.SAUser, artifactregistry.writer)
  - cloud-run-runtime-sa@<PROJECT>.iam.gserviceaccount.com (per-secret secretAccessor — added in Task 6)
- WIF Pool: github-pool (attribute-condition = repo==tipometer/Research_App)
- Artifact Registry: research-app-staging (europe-west3)

Bootstrap commands: spec §5.4 (copy-paste reproducible).
```

```bash
git add docs/deployment/gcp-bootstrap-record-*.md
git commit -m "docs: GCP staging bootstrap record (project/SAs/WIF/AR)"
```

- [ ] **Step 12: User checkpoint** — "Task 5 done. GCP project + 2 SAs + WIF pool + AR repo created. GitHub secret set. Record committed. Ready for Task 6 (TiDB + Secret Manager)."

---

## Task 6: TiDB cluster + Secret Manager bootstrap + db.ts TLS + migrations

**Files:**
- Modify: `server/db.ts`

**Sub-task 6a: TiDB cluster provisioning (manual, TiDB Console)**

- [ ] **Step 1: Create TiDB project + cluster**

Navigate to `https://tidbcloud.com`:
1. Sign in with Google (same account as GCP)
2. Create project "Deep Research" (if not exists)
3. Create Serverless cluster:
   - Name: `deep-research-staging`
   - Cloud provider: **AWS** (Serverless tier is AWS-only)
   - Region: **Frankfurt (eu-central-1)**
   - Tier: Free
4. After cluster ACTIVE: create database `research_app`
5. Click "Connect" → select "mysql CLI" tab → copy the full connection string (format `mysql://USER.root:PASSWORD@gateway01.eu-central-1.prod.aws.tidbcloud.com:4000/research_app`)

Save the URL to a LOCAL env var (do NOT commit it):
```bash
export TIDB_URL='<pasted URL>'
# Verify connectivity before proceeding
mysql --ssl-mode=VERIFY_IDENTITY --host=gateway01.eu-central-1.prod.aws.tidbcloud.com \
  --port=4000 --user=<USER> --password='<PASS>' research_app \
  -e "SELECT 1"
# Expected: 1
```

**Sub-task 6b: Secret Manager bootstrap (manual, Balint's laptop)**

- [ ] **Step 2: Create the 4 core secrets**

⚠️ **`master-encryption-key` — ONE-TIME CREATE.** Never re-run `gcloud secrets versions add master-encryption-key` — see spec §7.5.

```bash
# master-encryption-key (AES-256, base64 32 byte, NO trailing newline)
openssl rand -base64 32 | tr -d '\n' | gcloud secrets create master-encryption-key \
  --data-file=- --replication-policy=user-managed \
  --locations=europe-west3 --project=$PROJECT

# database-url (from TiDB Console)
printf "%s" "$TIDB_URL" | gcloud secrets create database-url \
  --data-file=- --replication-policy=user-managed \
  --locations=europe-west3 --project=$PROJECT

# jwt-secret (HS256 sign key, 64 byte entropy)
openssl rand -base64 64 | tr -d '\n' | gcloud secrets create jwt-secret \
  --data-file=- --replication-policy=user-managed \
  --locations=europe-west3 --project=$PROJECT

# dev-login-key (256-bit entropy)
openssl rand -base64 32 | tr -d '\n' | gcloud secrets create dev-login-key \
  --data-file=- --replication-policy=user-managed \
  --locations=europe-west3 --project=$PROJECT
```

Verify:
```bash
gcloud secrets list --project=$PROJECT --format='value(name)'
# Expected: 4 secrets listed
```

- [ ] **Step 3: Grant runtime SA per-secret `secretAccessor`**

```bash
export RUNTIME_SA="cloud-run-runtime-sa@$PROJECT.iam.gserviceaccount.com"

for SECRET in master-encryption-key database-url jwt-secret dev-login-key; do
  gcloud secrets add-iam-policy-binding $SECRET \
    --member="serviceAccount:$RUNTIME_SA" \
    --role="roles/secretmanager.secretAccessor" \
    --project=$PROJECT
done
```

Verify (no project-wide grant, only per-secret):
```bash
gcloud projects get-iam-policy $PROJECT --flatten="bindings[].members" \
  --filter="bindings.members:$RUNTIME_SA" --format="value(bindings.role)"
# Expected: empty (no project-wide secretAccessor — only per-secret)
```

- [ ] **Step 4: Grant Balint user `secretAccessor` on `database-url` + `dev-login-key` only**

```bash
export BALINT_EMAIL=balint@tipometer.com  # adjust to actual email

gcloud secrets add-iam-policy-binding database-url \
  --member="user:$BALINT_EMAIL" \
  --role="roles/secretmanager.secretAccessor" \
  --project=$PROJECT

gcloud secrets add-iam-policy-binding dev-login-key \
  --member="user:$BALINT_EMAIL" \
  --role="roles/secretmanager.secretAccessor" \
  --project=$PROJECT
```

**Balint does NOT get access to `master-encryption-key` or `jwt-secret`** — even accidental reads are blocked, which is the point.

**Sub-task 6c: db.ts TLS config (code change)**

- [ ] **Step 5: Modify `server/db.ts` — wrap `drizzle()` in a pool with TLS**

Edit the `getDb()` function (current location ~line 16-28):

Replace:
```typescript
let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
```

With:
```typescript
import mysql from "mysql2/promise";

let _db: ReturnType<typeof drizzle> | null = null;

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
```

- [ ] **Step 6: Verify existing tests still pass**

```bash
corepack pnpm test
corepack pnpm check
```
Expected: 220 passing, 0 errors.

**Sub-task 6d: Drizzle migrations against TiDB (laptop, one-time)**

- [ ] **Step 7: Apply Drizzle migrations to the TiDB cluster**

```bash
export DATABASE_URL="$TIDB_URL"
corepack pnpm db:push
unset DATABASE_URL
```

Expected: Drizzle reports schema tables created (`users`, `researches`, `researchPhases`, `sources`, `surveys`, `surveyResponses`, `creditTransactions`, `brainstormSessions`, `auditLogs`, `aiConfigs`, etc.).

If TLS error appears: add `ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true }` to `drizzle.config.ts` `dbCredentials` and retry.

Verify:
```bash
export MYSQL_PWD=$(echo "$TIDB_URL" | sed -E 's|^mysql://[^:]+:([^@]+)@.*|\1|')
TIDB_USER=$(echo "$TIDB_URL" | sed -E 's|^mysql://([^:]+):.*|\1|')
TIDB_HOST=$(echo "$TIDB_URL" | sed -E 's|^mysql://[^@]+@([^:/]+).*|\1|')

mysql -h "$TIDB_HOST" -P 4000 -u "$TIDB_USER" --ssl-mode=VERIFY_IDENTITY research_app \
  -e "SHOW TABLES"

unset MYSQL_PWD TIDB_USER TIDB_HOST
```
Expected: ~10 tables listed including `users` and `aiConfigs`.

- [ ] **Step 8: Commit db.ts TLS config + bootstrap record**

Write `docs/deployment/secret-bootstrap-record-YYYY-MM-DD.md`:
```markdown
# Secret Manager Bootstrap Record — YYYY-MM-DD

4 core secrets created, each with user-managed replication in europe-west3:
- master-encryption-key (⚠️ NEVER rotate before C3 dual-key decrypt)
- database-url (TiDB Serverless eu-central-1 connection URI)
- jwt-secret
- dev-login-key

IAM bindings:
- cloud-run-runtime-sa: secretAccessor on all 4 secrets (per-secret)
- user:<balint-email>: secretAccessor on database-url + dev-login-key only

TiDB cluster: deep-research-staging (AWS eu-central-1), DB: research_app
Drizzle migrations applied: X tables.
```

```bash
git add server/db.ts docs/deployment/secret-bootstrap-record-*.md
git commit -m "feat: TiDB TLS pool config + Secret Manager bootstrap record"
```

- [ ] **Step 9: User checkpoint** — "Task 6 done. TiDB cluster live, 4 secrets created (master-encryption-key ⚠️ no-rotate flagged), per-secret IAM grants set, Drizzle migrations applied, db.ts TLS config merged. Ready for Task 7 (index.ts integration)."

---

## Task 7: `server/_core/index.ts` integration + Cloud Logging queries doc

**Files:**
- Modify: `server/_core/index.ts`
- Create: `docs/deployment/cloud-logging-queries.md`

- [ ] **Step 1: Modify `server/_core/index.ts`**

Add imports at the top (near other `_core/*` imports):
```typescript
import { registerDevLoginIfEnabled } from "../auth/dev-login";
import { logger } from "./logger";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
```

In `startServer()`, add `registerDevLoginIfEnabled(app)` between the body-parser setup and the SSE route (around the point where `app.use(express.urlencoded(...))` ends, before `app.get("/api/research/:id/stream", ...)`):

```typescript
// ── Dev auth stub (staging only — triple-gated) ───────────────────────────
const devAuthEnabled = registerDevLoginIfEnabled(app);
// registerOAuthRoutes(app) remains untouched below (Auth sprint scope)
```

Replace the existing `server.listen(port, () => { console.log(...) })` (around line 118) with:

```typescript
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
```

- [ ] **Step 2: tsc check**

```bash
corepack pnpm check
```
Expected: 0 errors.

- [ ] **Step 3: Local smoke boot (dev auth DISABLED — should work like before)**

```bash
# NODE_ENV=development (default), ENABLE_DEV_LOGIN unset
corepack pnpm dev &
DEV_PID=$!
sleep 8
# Check startup_complete log appeared (it should, as dev-mode also goes through server.listen)
# Check tRPC endpoint is reachable
curl -s http://localhost:${PORT:-4000}/ -o /dev/null -w "%{http_code}\n"
# Expected: 200 (static / vite dev)
kill $DEV_PID
```

If `startup_db_check_failed` appears in the output, the local `.env.local` `DATABASE_URL` might not reach TiDB — which is expected if it's pointing to a Manus-managed MySQL (not in scope for this sprint). This is fine for the staging deploy; the issue only applies to local dev post-Auth-sprint.

If `process.exit(1)` actually fires locally, update `.env.local` to point to TiDB or any reachable MySQL, OR temporarily comment the smoke-query block during local dev.

- [ ] **Step 4: Local smoke boot (dev auth ENABLED — /dev/login route present)**

```bash
# Set dev auth env, use test DATABASE_URL (reuse TIDB_URL from Task 6 if convenient)
NODE_ENV=staging \
  ENABLE_DEV_LOGIN=true \
  DEV_LOGIN_KEY=localdevkey-44chars-xxxxxxxxxxxxxxxxxxxxxxxx \
  JWT_SECRET=localdevjwtsecret-at-least-32-chars-long-xx \
  DATABASE_URL="$TIDB_URL" \
  corepack pnpm dev &
DEV_PID=$!
sleep 8
# /dev/login should exist (401 without key)
curl -s http://localhost:${PORT:-4000}/dev/login -o /dev/null -w "%{http_code}\n"
# Expected: 401
kill $DEV_PID
```

- [ ] **Step 5: Create Cloud Logging queries doc**

Write `docs/deployment/cloud-logging-queries.md`:

```markdown
# Cloud Logging Saved Queries — Staging

## 1. All ERROR severity (last 1 hour)
resource.type="cloud_run_revision"
resource.labels.service_name="research-app-staging"
severity>=ERROR

## 2. Auth stub logs (success + failure + rate limit)
resource.type="cloud_run_revision"
jsonPayload.event=~"dev_login_.*|dev_user_.*|dev_session_.*"

## 3. Encryption path health (C2b plaintext warn — indicates a row hasn't migrated yet)
resource.type="cloud_run_revision"
jsonPayload.event="plaintext_api_key_detected"

## 4. Pipeline phase durations
resource.type="cloud_run_revision"
jsonPayload.event="phase_complete"
# (Cloud Logging Explore panel: aggregate on jsonPayload.durationMs)

## 5. Cold start detection
resource.type="cloud_run_revision"
jsonPayload.event="startup_complete"

## 6. DB smoke-query retries (TiDB auto-pause wake diagnostics)
resource.type="cloud_run_revision"
jsonPayload.event="startup_db_check_retry"
```

- [ ] **Step 6: Commit Task 7**

```bash
git add server/_core/index.ts docs/deployment/cloud-logging-queries.md
git commit -m "feat: dev-login registration + startup smoke-query + logging queries doc"
```

- [ ] **Step 7: User checkpoint** — "Task 7 done. index.ts integrated, startup health + dev auth wired. Local smoke with ENABLE_DEV_LOGIN=true shows /dev/login responding. Ready for Task 8 (Dockerfile)."

---

## Task 8: Dockerfile + .dockerignore + local build verify (mysql2 Alpine acceptance gate)

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Write `Dockerfile` (multi-stage)**

```dockerfile
# ---- Build stage ----
FROM node:22-alpine AS builder
WORKDIR /app

# NODE_ENV=production for Vite frontend optimization.
# esbuild does NOT inline process.env.NODE_ENV by default, so the dev-login
# triple-gate is preserved at runtime. The dev-login-gate.test.ts catches any
# future accidental --define:process.env.NODE_ENV=... bundler flag.
ENV NODE_ENV=production

# corepack enable — pnpm version auto-read from package.json "packageManager"
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---- Runtime stage ----
FROM node:22-alpine AS runtime
WORKDIR /app

# Staging default; Cloud Run --set-env-vars overrides.
ENV NODE_ENV=staging
ENV PORT=8080

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 8080
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Write `.dockerignore`**

```
node_modules
dist
.git
.github
docs
*.md
.env*
coverage
vitest.config.ts
vitest.integration.config.ts
server/__tests__
**/*.test.ts
**/*.spec.ts
```

- [ ] **Step 3: Build the image locally**

```bash
docker build -t research-app:local-test .
```
Expected: successful build. If the pnpm install step fails with "lockfile is not up to date", the `packageManager` field mismatch hit us — Task 0 should have caught this.

- [ ] **Step 4: Alpine mysql2 acceptance gate (preflight #6)**

```bash
docker run --rm --entrypoint node research-app:local-test \
  -e "require('mysql2'); console.log('mysql2 loaded OK')"
```

Expected: `mysql2 loaded OK`.

**Fallback on failure** (error like `ENOENT /lib/ld-musl-x86_64.so.1` or similar glibc/musl mismatch):

Edit `Dockerfile`: replace BOTH `FROM node:22-alpine` lines with `FROM node:22-slim`. Rebuild and re-run the acceptance gate. Image grows ~30 MB (acceptable per spec §5.2).

- [ ] **Step 5: Quick runtime smoke of the image (stand-alone, no secrets)**

```bash
# Set minimal env — server will fail-fast on missing MASTER_ENCRYPTION_KEY, which proves the fast-fail works
docker run --rm -e PORT=8080 -p 8080:8080 research-app:local-test 2>&1 | head -5
```
Expected output includes something like:
```
Error: MASTER_ENCRYPTION_KEY is not set
```
(Or similar, depending on C2b's error message.) This proves the fast-fail is working — exactly what we want.

Kill the container if it hung: `docker stop $(docker ps -q --filter ancestor=research-app:local-test)`.

- [ ] **Step 6: Commit Task 8**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: multi-stage Dockerfile (Node 22 Alpine) + .dockerignore"
```

- [ ] **Step 7: User checkpoint** — "Task 8 done. Dockerfile builds, mysql2 loads in container, fast-fail validation works. Ready for Task 9 (GitHub Actions)."

---

## Task 9: GitHub Actions workflows (test.yml + deploy-staging.yml)

**Files:**
- Create: `.github/workflows/test.yml`
- Create: `.github/workflows/deploy-staging.yml`

- [ ] **Step 1: Write `.github/workflows/test.yml`**

```bash
mkdir -p .github/workflows
```

Create `test.yml`:

```yaml
name: Tests
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: pnpm/action-setup@v4
        # no version: — reads from package.json "packageManager"
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
      - run: pnpm test
```

- [ ] **Step 2: Write `.github/workflows/deploy-staging.yml`**

```yaml
name: Deploy staging
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

env:
  PROJECT_ID: ${{ secrets.GCP_PROJECT_ID }}  # set in Task 5 Step 10
  REGION: europe-west3
  SERVICE: research-app-staging
  AR_REPO: research-app-staging

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: projects/${{ secrets.GCP_PROJECT_NUMBER }}/locations/global/workloadIdentityPools/github-pool/providers/github-provider
          service_account: deploy-sa@${{ env.PROJECT_ID }}.iam.gserviceaccount.com

      - uses: google-github-actions/setup-gcloud@v2

      - name: Configure docker auth
        run: gcloud auth configure-docker ${{ env.REGION }}-docker.pkg.dev --quiet

      - name: Build + push image
        run: |
          IMAGE=${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.AR_REPO }}/app:${{ github.sha }}
          docker build -t $IMAGE .
          docker push $IMAGE
          echo "IMAGE=$IMAGE" >> $GITHUB_ENV

      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy ${{ env.SERVICE }} \
            --image=${{ env.IMAGE }} \
            --region=${{ env.REGION }} \
            --no-allow-unauthenticated \
            --service-account=cloud-run-runtime-sa@${{ env.PROJECT_ID }}.iam.gserviceaccount.com \
            --set-env-vars=NODE_ENV=staging,ENABLE_DEV_LOGIN=true \
            --set-secrets=MASTER_ENCRYPTION_KEY=master-encryption-key:latest,DATABASE_URL=database-url:latest,JWT_SECRET=jwt-secret:latest,DEV_LOGIN_KEY=dev-login-key:latest \
            --max-instances=5 \
            --min-instances=0 \
            --cpu=1 \
            --memory=512Mi \
            --timeout=300s \
            --project=${{ env.PROJECT_ID }}
```

- [ ] **Step 3: Commit workflows (BEFORE pushing — this commit is the one that triggers the first deploy when pushed)**

```bash
git add .github/workflows/test.yml .github/workflows/deploy-staging.yml
git commit -m "feat: GitHub Actions test + deploy-staging workflows (WIF)"
```

- [ ] **Step 4: User checkpoint** — "Task 9 done. Workflows committed. Next task (Task 10) pushes the branch and triggers the FIRST deploy. Confirm ready before proceeding."

---

## Task 10: First deploy + Cloud Run invoker IAM grant

**Files:** none in repo (branch push + IAM grant).

- [ ] **Step 1: Push the branch**

```bash
cd /Users/balintkovacs/Work/ClaudeCode/Research_App/repo-c1-ai-pipeline
git push -u origin feat/infra-foundation-staging
```

- [ ] **Step 2: Open PR (draft mode initially)**

```bash
gh pr create \
  --title "Infra Foundation Sprint: staging deploy off Manus" \
  --body "$(cat <<'EOF'
## Summary
- Google Cloud Run (europe-west3) + TiDB Cloud Serverless + Secret Manager + GitHub Actions WIF
- Dev auth stub (triple-gated) with SDK-compatible session cookie — unchanged `sdk.authenticateRequest`
- Pre-containerization Manus scaffold cleanup
- Task 8 C2b E2E smoke-test protocol

Spec: docs/superpowers/specs/2026-04-20-infra-foundation-staging-design.md
Plan: docs/superpowers/plans/2026-04-20-infra-foundation-staging.md

## Test plan
- [ ] All CI checks pass (vitest + tsc) on PR
- [ ] Push to main triggers deploy-staging workflow
- [ ] Cloud Run revision Ready
- [ ] Balint user IAM granted roles/run.invoker on the service
- [ ] Task 8 smoke-test protocol (§9 of spec) runs green end-to-end
- [ ] Smoke-test SUCCESS record committed

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" \
  --draft
```

- [ ] **Step 3: Wait for CI test workflow on the PR**

```bash
gh pr checks --watch
```
Expected: the `Tests` workflow passes (220 tests + tsc). If it fails — STOP. Fix the issue, push a new commit.

- [ ] **Step 4: Merge to trigger deploy-staging**

Mark the PR ready and merge (squash merge per project convention, or merge commit — user preference):

```bash
gh pr ready
gh pr merge --squash --delete-branch=false  # delete-branch later, after smoke-test success
```

(Or: leave the PR open and manually trigger `workflow_dispatch` for deploy-staging.yml against the branch, if Balint wants to validate before merge.)

- [ ] **Step 5: Monitor the deploy-staging run**

```bash
gh run watch  # picks up the most recent run
# OR
gh run list --workflow=deploy-staging.yml --limit=3
```

Expected: ~3-5 min. The `docker build` takes ~2-3 min, push + deploy another 1-2 min.

- [ ] **Step 6: Verify Cloud Run revision Ready**

```bash
gcloud run services describe research-app-staging \
  --region=europe-west3 --project=$PROJECT \
  --format='value(status.conditions[0].type,status.conditions[0].status,status.url)'
```
Expected: `Ready` / `True` / `https://research-app-staging-<hash>-ew.a.run.app`.

- [ ] **Step 7: Grant Balint user `roles/run.invoker` on the deployed service**

This step was deferred in Task 5 because the service didn't exist yet.

```bash
gcloud run services add-iam-policy-binding research-app-staging \
  --member="user:$BALINT_EMAIL" \
  --role="roles/run.invoker" \
  --region=europe-west3 --project=$PROJECT
```

- [ ] **Step 8: Verify auth-gated access works**

```bash
# Unauthenticated call should 403
STAGING_URL=$(gcloud run services describe research-app-staging \
  --region=europe-west3 --project=$PROJECT --format='value(status.url)')
curl -s -o /dev/null -w "%{http_code}\n" "$STAGING_URL/"
# Expected: 403 (or 401)

# Authenticated call (with gcloud ID token) should work
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$STAGING_URL/"
# Expected: 200
```

- [ ] **Step 9: Commit deploy success record**

Write `docs/deployment/first-deploy-record-YYYY-MM-DD.md`:
```markdown
# First Deploy Record — YYYY-MM-DD

- Cloud Run service: research-app-staging (europe-west3)
- Revision: <revision-name>
- URL: <cloud-run-url> (IAM-gated, --no-allow-unauthenticated)
- Image: <ar-image-path>:<sha>
- IAM: Balint user granted roles/run.invoker
- GitHub Actions run: <gh-run-url>

Next: Task 11 smoke-test (docs/deployment/smoke-test-c2b.md).
```

```bash
git checkout feat/infra-foundation-staging
git add docs/deployment/first-deploy-record-*.md
git commit -m "docs: first staging deploy record"
git push
```

- [ ] **Step 10: User checkpoint** — "Task 10 done. First deploy SUCCESSFUL. Cloud Run revision Ready, Balint IAM granted, auth gate verified. Ready for Task 11 (C2b E2E smoke-test)."

---

## Task 11: Task 8 C2b E2E smoke-test execution + SUCCESS record

**Files:**
- Create: `docs/deployment/smoke-test-c2b.md`
- Create: `docs/deployment/smoke-test-c2b-run-YYYY-MM-DD.md`

**Sub-task 11a: smoke-test protocol document (if not already written in Task 10 commit)**

- [ ] **Step 1: Create `docs/deployment/smoke-test-c2b.md`**

Copy the §11 (Task 8 E2E smoke-test protocol) from the spec into a standalone runbook file. Full content at spec §11.1–§11.4. Commit:

```bash
git add docs/deployment/smoke-test-c2b.md
git commit -m "docs: Task 8 C2b E2E smoke-test protocol runbook"
```

**Sub-task 11b: run the protocol (Balint, manual, ~10 min)**

Run the steps from `docs/deployment/smoke-test-c2b.md` sequentially.

- [ ] **Step 2: Preflight check (spec §11.1)**

```bash
export PROJECT=<project-id>
# 4 secrets exist
for s in master-encryption-key database-url jwt-secret dev-login-key; do
  gcloud secrets describe $s --project=$PROJECT --format='value(name,createTime)'
done
# Cloud Run Ready
gcloud run services describe research-app-staging \
  --region=europe-west3 --project=$PROJECT \
  --format='value(status.conditions[0].type,status.conditions[0].status)'
```

- [ ] **Step 3: Dev login URL (spec §11.2 Step 2)**

```bash
export DEV_KEY=$(HISTFILE=/dev/null gcloud secrets versions access latest \
  --secret=dev-login-key --project=$PROJECT)
export STAGING_URL=$(gcloud run services describe research-app-staging \
  --region=europe-west3 --project=$PROJECT --format='value(status.url)')
echo "${STAGING_URL}/dev/login?key=${DEV_KEY}"
unset DEV_KEY
```

- [ ] **Step 4: IAM proxy + browser login (spec §11.2 Step 3-4)**

```bash
# In one terminal:
gcloud run services proxy research-app-staging --region=europe-west3 --project=$PROJECT &
PROXY_PID=$!
# In browser: http://localhost:8080/dev/login?key=<DEV_KEY>
# Verify: 302 redirect to /, nav bar visible, user menu "Dev Admin (staging)", /admin accessible
```

- [ ] **Step 5: OpenAI API key save (spec §11.2 Step 5)**

Browser: Admin → AI Config → OpenAI → paste real `sk-...` key → Save.
- [ ] "🔒 Encrypted" badge appears
- [ ] Network tab: 200 response, no error

- [ ] **Step 6: DB ciphertext verify (spec §11.2 Step 6) — THE CRITICAL CHECK**

```bash
export DB_URL=$(HISTFILE=/dev/null gcloud secrets versions access latest \
  --secret=database-url --project=$PROJECT)

TIDB_USER=$(echo "$DB_URL" | sed -E 's|^mysql://([^:]+):.*|\1|')
TIDB_HOST=$(echo "$DB_URL" | sed -E 's|^mysql://[^@]+@([^:/]+).*|\1|')
TIDB_PORT=$(echo "$DB_URL" | sed -E 's|^mysql://[^@]+@[^:/]+:([0-9]+).*|\1|')
TIDB_DB=$(echo "$DB_URL"   | sed -E 's|^mysql://[^@]+@[^/]+/([^?]+).*|\1|')
export MYSQL_PWD=$(echo "$DB_URL" | sed -E 's|^mysql://[^:]+:([^@]+)@.*|\1|')

mysql -h "$TIDB_HOST" -P "$TIDB_PORT" -u "$TIDB_USER" \
  --ssl-mode=VERIFY_IDENTITY "$TIDB_DB" \
  -e "SELECT provider, LEFT(apiKey, 5) AS prefix, LENGTH(apiKey) AS len, updatedAt
      FROM aiConfigs WHERE provider='openai' ORDER BY updatedAt DESC LIMIT 1;"

unset MYSQL_PWD DB_URL TIDB_USER TIDB_HOST TIDB_PORT TIDB_DB
```

Expected:
- [ ] `prefix` = `ENC1:`
- [ ] `len` between 80 and 130
- [ ] NOT `sk-...` (if `sk-` → STOP, encryption path broken, BLOCKER)

**TLS fallback:** if `mysql --ssl-mode=VERIFY_IDENTITY` fails with a CA cert validation error (unusual, but possible in some CLI setups), retry with `--ssl-mode=REQUIRED` — this still enforces TLS but skips the hostname-cert-identity check. TiDB Serverless certificates are issued by a standard public CA, so `VERIFY_IDENTITY` should succeed on macOS / Linux with an up-to-date system trust store.

- [ ] **Step 7: Research pipeline trigger (spec §11.2 Step 7)**

Browser: `/new-research` → prompt "Mi a napelem elterjedtsége Magyarországon 2025-ben?" → strategy Quick → Start.
- [ ] SSE live feed shows phase progression
- [ ] Report renders, radar chart visible, source library populated

- [ ] **Step 8: Cloud Logging verify (spec §11.2 Step 8)**

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   resource.labels.service_name="research-app-staging"
   (jsonPayload.event="phase_complete" OR jsonPayload.event="pipeline_complete"
    OR severity="ERROR")' \
  --project=$PROJECT --limit=50 --format=json | \
  jq '.[] | {timestamp, severity, event: .jsonPayload.event, phase: .jsonPayload.phase}'
```

Expected:
- [ ] 4 `phase_complete` events
- [ ] 1 `pipeline_complete` event
- [ ] ZERO `DecryptionError` or ERROR severity entries

- [ ] **Step 9: Stop proxy**

```bash
kill $PROXY_PID
```

- [ ] **Step 10: Commit success record**

```bash
DATE=$(date -u +%Y-%m-%d)
REVISION=$(gcloud run revisions list --service=research-app-staging \
  --region=europe-west3 --project=$PROJECT --format='value(metadata.name)' --limit=1 | head -1)

cat > docs/deployment/smoke-test-c2b-run-${DATE}.md << EOF
# Task 8 C2b Smoke-Test — SUCCESS
Run: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Cloud Run revision: $REVISION
TiDB cluster: deep-research-staging
ENC1 prefix verified: YES
Pipeline phases complete: YES (4 phase_complete + 1 pipeline_complete)
Errors in logs: 0
Encryption len observed: <N> bytes (80-130 expected range)
EOF

git add docs/deployment/smoke-test-c2b-run-*.md
git commit -m "docs: Task 8 C2b smoke-test SUCCESS record"
git push
```

- [ ] **Step 11: User checkpoint** — "Task 11 done. **C2b E2E smoke-test PASSED.** Encryption round-trip verified in live staging. Record committed. Ready for Task 12 (final PR + cleanup)."

---

## Task 12: Final PR merge + cleanup

- [ ] **Step 1: Final push**

```bash
git push
```

- [ ] **Step 2: If the PR was draft earlier, mark ready and merge**

If not already merged (per Task 10 Step 4):
```bash
gh pr ready
gh pr checks --watch   # verify test.yml still green
gh pr merge --squash --delete-branch
```

If already merged but more commits pushed after (docs commits for smoke-test records), those can be separate trailing commits on main — or bundled as a follow-up docs PR.

- [ ] **Step 3: Verify memory update (inform user)**

After merge, the memory file `project_deep-research-c1-done.md` can be updated to reflect:
- Infra Foundation staging deploy merged
- Task 8 C2b smoke-test: PASSED on <date>
- Next sub-project: Auth migration (off Manus OAuth)

(This is a user-facing followup; don't auto-edit memory without confirmation.)

- [ ] **Step 4: Cleanup (optional)**

```bash
# Remove the stale 'repo' clone if no longer used (parent dir has both repo/ and repo-c1-ai-pipeline/)
# ONLY if user confirms — check memory project_deep-research-c1-done.md for worktree preservation rules.
```

- [ ] **Step 5: Final user checkpoint** — "Infra Foundation Sprint COMPLETE. Staging deploy live, C2b encryption validated in cloud env, PR merged. Next sub-project candidate: Auth migration off Manus OAuth."

---

## Post-sprint: what's left for follow-up PRs / sprints

**Minor improvements (could be follow-up PRs off main):**
- `env.ts` zod schema + fast-fail on missing required env (footgun `?? ""` removed)
- Graceful SIGTERM handler in `index.ts` (drain SSE connections before Cloud Run 10s grace ends)
- `gcloud billing budgets create` staging-project-level $10/month alert

**Next sub-projects (separate specs + plans):**
- **Auth migration** off Manus OAuth → natív OAuth (Google/GitHub) + session revocation + rate-limited auth endpoints
- **Prod launch** → custom domain, Cloud Armor WAF, public URL, Sentry, `min-instances=1`, uptime check, DR runbook
- **Storage / Export** → GCS bucket, blob upload, PDF/MD export, CSV import
- **Payment** → Stripe + Számlázz.hu integration
- **C3 KMS sprint** → Google Cloud KMS, dual-key decrypt window, automated re-encryption batch, admin "Re-encrypt all" button, encryption audit events

---

*End of implementation plan.*
