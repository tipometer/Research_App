# Secret Manager Bootstrap Record — 2026-04-20

**Executed by:** balint@skillnaut.co (local `gcloud` CLI).
**Project:** `deep-research-staging-20260420`.
**Plan reference:** Task 6c of `docs/superpowers/plans/2026-04-20-infra-foundation-staging.md`.

## Secrets created (region: europe-west3, replication: user-managed)

| Secret | Purpose | Source | Rotation policy |
|---|---|---|---|
| `master-encryption-key` | C2b AES-256-GCM envelope encryption of `aiConfigs.apiKey` | `openssl rand -base64 32 \| tr -d '\n'` | ⚠️ **NO ROTATION before C3** — see spec §7.5 |
| `database-url` | TiDB Serverless connection URI | `$TIDB_URL` from local shell (URL-encoded password) | On TiDB password rotation |
| `jwt-secret` | HS256 session cookie sign key (= `ENV.cookieSecret`) | `openssl rand -base64 64 \| tr -d '\n'` | On Auth migration sprint revisit |
| `dev-login-key` | Dev auth stub key for `/dev/login?key=...` | `openssl rand -base64 32 \| tr -d '\n'` | When dev stub is removed |

All 4 secrets created with `printf "%s"` or `\| tr -d '\n'` — no trailing newline, per preflight rule #6 (avoids C2b `getMasterKey()` length guard false-positive).

## IAM bindings

**Runtime SA** `cloud-run-runtime-sa@deep-research-staging-20260420.iam.gserviceaccount.com` (per-secret `secretAccessor`):
- master-encryption-key
- database-url
- jwt-secret
- dev-login-key

**Balint user** `balint@skillnaut.co` (per-secret `secretAccessor`, staging operator access):
- database-url (for `pnpm db:push` local migrations)
- dev-login-key (for Task 8 smoke-test URL construction)

**Deliberately NOT granted** to Balint user:
- master-encryption-key — prevents accidental `gcloud secrets versions access` leak; emergency grant requires audit-logged explicit role binding
- jwt-secret — same reasoning; rotation invalidates all sessions

**Deliberately NOT granted** to deploy-sa at all (per Task 5 strict least-privilege) — Cloud Run service agent resolves `:latest` at container start time with the runtime SA's binding.

## Drizzle migration

`pnpm db:push` successfully applied against the TiDB cluster (spec §6.3), creating 11 tables: `ai_configs`, `audit_logs`, `brainstorm_sessions`, `credit_transactions`, `model_routing`, `research_phases`, `researches`, `sources`, `survey_responses`, `surveys`, `users`.

**Drizzle-kit TLS fix required during this step:**
- Initial attempt failed with TiDB's "Connections using insecure transport are prohibited" error (errno 1105).
- drizzle-kit 0.31.5 ignores the `ssl` field when `dbCredentials.url` is used.
- Fix: parse `DATABASE_URL` into components (host/port/user/password/database) in `drizzle.config.ts` so `ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true }` is honored. Commit `bad288c`.

## Deferred to Task 6b

- **Server runtime TLS config (`server/db.ts`):** the `getDb()` function currently uses `drizzle(process.env.DATABASE_URL)` shorthand which does not pass TLS options. Task 6b subagent will refactor to `mysql.createPool({ uri, ssl })` + `drizzle(pool)`.

## Deferred to Task 10

- **Cloud Run invoker IAM for Balint user** — can only be bound once the `research-app-staging` Cloud Run service exists (created in the first deploy).

## Re-runnability

Secret creation is **NOT** idempotent via `gcloud secrets create` — re-running fails with "already exists". To re-create, either:
- Delete existing: `gcloud secrets delete <name> --project=$PROJECT` (destructive; `master-encryption-key` deletion DESTROYS all `ENC1:` data)
- Add a new version: `... | gcloud secrets versions add <name> --data-file=-`

**⚠️ NEVER** run `gcloud secrets versions add master-encryption-key` before C3 dual-key decrypt is in place.
