# Infra Foundation Sprint — Staging Deploy Design

**Verzió:** 1.0
**Dátum:** 2026-04-20
**Scope:** Infra foundation sub-project (a V1 remainderből) — natív deploy off Manus platformról, staging környezetbe
**Kontextus:** Deep Research app, migráció Manus platformról natív stackre. C1/C2a/C2b merged (PR #1-#6). Auth migráció, prod launch, storage, payment = külön sub-projektek.
**Előzmény:** C2b sprint merged 2026-04-18 (PR #5 + #6). Task 8 E2E smoke-test (a C2b encryption roundtrip élő cloud env-ben való verifikációja) deployment checklist-re halasztva — ez a sprint oldja fel.

---

## 1. Vezetői összefoglaló

A Deep Research app jelenleg a Manus platformon fut (Manus OAuth, Manus runtime, Manus Forge API proxy). Ez a sprint az első natív deploy target felállítása: **Google Cloud Run (europe-west3 Frankfurt)** + **TiDB Cloud Serverless (eu-central-1 Frankfurt)** + **Google Secret Manager** + **GitHub Actions CI/CD Workload Identity Federation-nel**. A staging környezet **IAM-gated** (`--no-allow-unauthenticated`), így csak Google-authentikált approved user éri el — az auth migráció (off Manus OAuth) **külön sub-projekt** lesz.

A sprint végén a **Task 8 E2E smoke-test** (§9) igazolja, hogy a C2b AES-256-GCM envelope encryption teljes oda-vissza működik a valódi cloud env-ben: admin menti az OpenAI API kulcsot → TiDB-ben `ENC1:` ciphertext-ként jelenik meg → research pipeline dekódolja → sikeres OpenAI hívás → riport render-el a UI-ban.

**Négy kulcs tervezési döntés:**

1. **Sub-project decomposition.** Infra ≠ Auth ≠ Prod launch. Ez a sprint *csak* a staging foundation-t állítja fel; az auth, a custom domain/WAF/Sentry, a storage, a payment mind külön spec+plan+PR cycle-t kapnak.
2. **IAM-only staging, dev-only auth stub.** A Cloud Run staging URL nyilvánosan elérhetetlen; egy triple-gated `/dev/login` endpoint ad be JWT session-t csak `NODE_ENV !== "production"` AND `ENABLE_DEV_LOGIN=true` AND a route registration maga is `if`-alá gated.
3. **Strict least-privilege IAM.** Két külön service account: `deploy-sa` (csak Cloud Run + Artifact Registry + IAM use), `cloud-run-runtime-sa` (csak per-secret `secretAccessor`). A `deploy-sa` sosem látja a secret értékeket; a `cloud-run-runtime-sa` nem tud deploy-olni.
4. **DB-first, ENV fallback megőrizve.** A C1 óta érvényben lévő architektúra változatlan: a provider API kulcsok a TiDB `aiConfigs` tábla `ENC1:` ciphertext oszlopából jönnek, a Secret Manager-beli `openai/anthropic/gemini-api-key` csak integration bootstrap-hez kell (és nem a tényleges prod flow-hoz).

A sprint végén nem kerül a kód prod-ba: a staging egy elkötelezett „clean cloud env" a C2b validációhoz, amire az Auth sprint építhet. Production launch külön sub-projekt, ami domain-t, WAF-ot, public URL-t, Sentry-t, `min-instances=1`-et és monitoring-mélyítést hoz.

---

## 2. Scope & Non-scope

### 2.1 In scope

**Infra artefaktumok:**
- `Dockerfile` (multi-stage, Node 22 Alpine — `node:22-slim` fallback ha `mysql2` musl-gond)
- `.dockerignore`
- `.github/workflows/test.yml` (PR-re: vitest + tsc)
- `.github/workflows/deploy-staging.yml` (main push-ra: build → AR push → Cloud Run deploy)
- `bin/manus-audit.sh` (one-time audit script, §7.1)
- `docs/deployment/smoke-test-c2b.md` (§9 protocol)
- `docs/deployment/manus-audit-report-YYYY-MM-DD.md` (audit evidence record, §7.1)
- `docs/deployment/cloud-logging-queries.md` (saved queries, §8.2)

**Kódváltozások:**
- `server/auth/dev-login.ts` (új modul — `registerDevLoginIfEnabled`, `devLoginHandler`, `devAuthMiddleware`, `ensureDevUserExists`)
- `server/_core/index.ts` (integráció: `registerDevLoginIfEnabled(app)` + Manus middleware feltételes mount + `/health` endpoint + `startup_complete` log)
- `server/_core/logger.ts` (új, structured JSON logging shim)
- `server/db.ts` (TiDB TLS config beépítése)
- `server/_core/env.ts` (szelektív cleanup: `forgeApiUrl`, `forgeApiKey` törlés)
- `server/__tests__/dev-login-gate.test.ts` (új, 3 teszt)
- `server/__tests__/dev-login-handler.test.ts` (új, ~6 teszt)
- 6 Manus scaffold file törlése (`server/storage.ts`, `server/_core/map.ts`, `server/_core/voiceTranscription.ts`, `server/_core/imageGeneration.ts`, `server/_core/dataApi.ts`, `server/_core/notification.ts`)
- `@aws-sdk/client-s3` és `@aws-sdk/s3-request-presigner` dep eltávolítás
- `express-rate-limit` dep hozzáadás

**Cloud resource-ok (one-time manual setup, dokumentált `gcloud` parancsokkal):**
- GCP projekt (`deep-research-staging-XXX`) + API-k engedélyezése
- 2 service account (`deploy-sa`, `cloud-run-runtime-sa`) + IAM bindings
- Workload Identity Pool + OIDC provider (repo-scoped)
- Artifact Registry repo (`research-app-staging`, europe-west3)
- Secret Manager 4 core secret (`master-encryption-key`, `database-url`, `jwt-secret`, `dev-login-key`) — opcionálisan 3 AI provider secret bootstrap-hez
- Cloud Run service (IAM-gated)
- TiDB Cloud Serverless cluster + DB + Drizzle migration applied
- Balint user IAM: `roles/run.invoker` a service-re + per-secret `secretAccessor` a `database-url`-re és a `dev-login-key`-re

### 2.2 Explicit out of scope (külön sprint-ek)

| Sub-projekt | Scope | Miért külön |
|---|---|---|
| **Auth migration** off Manus OAuth | Natív email/password vagy OAuth provider (Google, GitHub), session revocation, rate limit | Az Infra sprint kockázatmenedzsmentje miatt — két nagy ismeretlen egyidőben bedől → nem tudjuk melyik réteg a bűnös |
| **Prod launch** | Custom domain (`research.tipometer.com`), Cloud Armor WAF, public URL, Sentry, `min-instances=1` (Cloud Run + TiDB), automated uptime check, DR runbook | User traffic alatt más a prioritás-profil (latency, observability depth, incident response) |
| **Storage / Export** | GCS bucket, blob upload, PDF/MD export, CSV import | Blob storage jelenleg nem használt (Manus scaffold scaffold dead code) |
| **Payment** | Stripe + Számlázz.hu, e-számla flow, kredit ledger | Független domain, külső vendor integráció |
| **KMS + rotation** (C3) | Google Cloud KMS integráció, dual-key decrypt window, automated re-encryption batch script, admin „Re-encrypt all legacy keys" gomb, encryption audit log events | A Secret Manager-beli `master-encryption-key` most előkészíti a KMS-váltást (same-project, IAM inheritance), de a rotation mechanika **függetlenül** ütemezett |
| **Synthesis 2.0, DOMPurify, CSV import** | V1 remainder feature-ök | Nem infra-adjacent |

### 2.3 Success criteria

A sprint „Done" kritériumai (mind teljesülnie kell):

1. **Deploy pipeline zöld:** `main`-re push → GHA workflow zöld → új Cloud Run revision létrejön és `Ready`-vé válik
2. **IAM-gated staging elérés:** `roles/run.invoker`-rel rendelkező Google account képes `gcloud run services proxy` vagy IAP-szerű módon elérni a Cloud Run URL-t, unauthenticated request 403-at kap
3. **Auth stub működik:** `/dev/login?key=$DEV_LOGIN_KEY` → 302 redirect → `/` → navigation bar látható → `/admin` elérhető, 401 nincs
4. **DB encryption round-trip:** admin UI-n OpenAI API key save → TiDB `aiConfigs.apiKey` oszlopban `ENC1:` prefix-szel tárolódik (80–130 char hossz); research pipeline fut → **NO `DecryptionError`** a Cloud Logging-ban + `pipeline_complete` SSE event jelenik meg + research eredmény render-el a UI-ban
5. **Triple-gate működik:** `ENABLE_DEV_LOGIN` unset VAGY `NODE_ENV=production` esetén a `/dev/login` endpoint **404-et ad** (a route nincs regisztrálva, nem pusztán handler-szinten blokkolt)

---

## 3. Pre-implementation checklist (Task 0 — KÖTELEZŐ ELSŐKÉNT)

Az implementáció bármelyik task-ja ELŐTT futtasd:

**Task 0.1 — tRPC context field audit.** Nyisd meg a `server/_core/trpc.ts` és `server/_core/context.ts` file-okat, grep-eld:
```bash
grep -rnE "req\.user|req\.auth|req\.manusUser|ctx\.user|ctx\.auth" \
  --include="*.ts" server/
```

Dokumentáld:
- A tRPC context builder melyik request-field-ből olvassa a user-t? (várható: `req.user`, de lehet `req.manusUser` vagy `req.auth`)
- Milyen shape-et vár? (`{ id, email, role }`? `{ id, openId }`? stb.)

Ennek alapján:
- Ha `req.user` mezőt olvas → a §6 `devAuthMiddleware` `(req as any).user = {...}` implementációja változtatás nélkül jó
- Ha más field-et olvas → a `devAuthMiddleware`-t ahhoz kell igazítani (ugyanazt a field-et kell írnia)
- **SOHA ne** módosítsd a tRPC context builder-t, hogy Manus-specifikus field helyett `req.user`-t olvasson — az az Auth sprint scope-ja

**Task 0.2 — `users` schema audit.** Nyisd meg `drizzle/schema.ts` (vagy ami a users tábla schema definíciója) és jegyezd le a column neveket:
- `email` vagy `emailAddress`?
- `role` enum vagy string? `'admin'` érték valid-e?
- `name` vagy `displayName`?
- `emailVerified` flag kötelező-e? (a seeded `dev-admin@staging.local`-nak állítsd `true`-ra)

Az `ensureDevUserExists` seed logika ezeket a pontos column-neveket fogja használni.

**Task 0.3 — `packageManager` field verify.** A `package.json`-ban van-e `"packageManager": "pnpm@X.Y.Z"` field? Ha nincs, adj hozzá:
```bash
pnpm --version  # → aktuális lokális verzió
# majd manuálisan a package.json-ba:
#   "packageManager": "pnpm@9.12.3"
# (kiolvasott verzió, nem major-only)
pnpm install --frozen-lockfile  # verify: nem módosítja a lockfile-t
```

**Task 0 acceptance:** egy rövid `docs/deployment/task-0-audit-findings.md` file committed a repo-ba, amiben a fenti 3 audit output-ja dokumentálva van. Nélküle a §6 auth stub implementációja találgatáson alapulna.

---

## 4. Target architecture

### 4.1 Component topology

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          GitHub (tipometer/Research_App)                │
│  ┌──────────────────┐        ┌────────────────────────────────────────┐ │
│  │  PR opened       │───────▶│  .github/workflows/test.yml            │ │
│  │                  │        │    pnpm install + vitest + tsc         │ │
│  └──────────────────┘        └────────────────────────────────────────┘ │
│  ┌──────────────────┐        ┌────────────────────────────────────────┐ │
│  │  push main       │───────▶│  .github/workflows/deploy-staging.yml  │ │
│  │                  │        │    WIF auth (OIDC → GCP SA)            │ │
│  │                  │        │    docker build + AR push              │ │
│  │                  │        │    gcloud run deploy --set-secrets     │ │
│  └──────────────────┘        └────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                                          │ OIDC
                                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   Google Cloud (project: deep-research-staging-XXX)     │
│                                                                          │
│   ┌────────────────────┐    ┌──────────────────────────────────────┐    │
│   │ Workload Identity  │    │ Artifact Registry (europe-west3)     │    │
│   │ Pool: github-pool  │    │   repo: research-app-staging         │    │
│   │ Provider:          │    │   images: Node 22 Alpine             │    │
│   │   github-provider  │    └──────────────────┬───────────────────┘    │
│   │ attribute-cond:    │                       │                        │
│   │   repo=tipometer/  │                       │ pulls image            │
│   │     Research_App   │                       ▼                        │
│   └─────────┬──────────┘    ┌──────────────────────────────────────┐    │
│             │               │ Cloud Run: research-app-staging      │    │
│             │ issues token  │   europe-west3                       │    │
│             ▼               │   --no-allow-unauthenticated         │    │
│   ┌─────────────────────┐   │   --service-account=                 │    │
│   │ deploy-sa           │   │     cloud-run-runtime-sa@...         │    │
│   │   roles/run.admin   │───▶   --set-secrets: MASTER_ENCRYPTION_  │    │
│   │   roles/iam.SAUser  │   │     KEY, DATABASE_URL, JWT_SECRET,   │    │
│   │   roles/artifact-   │   │     DEV_LOGIN_KEY [+ AI key-ek opt.] │    │
│   │     registry.writer │   │   --set-env: NODE_ENV=staging,       │    │
│   │ (NO Secret Manager  │   │     ENABLE_DEV_LOGIN=true            │    │
│   │  role — strict LP)  │   │   --min-instances=0, --max=5         │    │
│   └─────────────────────┘   │   --cpu=1 --memory=512Mi             │    │
│                             │   --timeout=300s (SSE)               │    │
│                             └──────────┬──────────────┬────────────┘    │
│                                        │ reads        │ logs            │
│                                        ▼              ▼                 │
│   ┌──────────────────────┐   ┌─────────────────────┐                    │
│   │ Secret Manager       │   │ Cloud Logging +     │                    │
│   │  europe-west3        │   │ Error Reporting     │                    │
│   │  user-managed repl.  │   │  (default routing,  │                    │
│   │  4 core + 0-3 opt.   │   │   ERROR auto-group) │                    │
│   │                      │   └─────────────────────┘                    │
│   │  cloud-run-runtime-  │                                              │
│   │    sa: per-secret    │                                              │
│   │    secretAccessor    │                                              │
│   │    (NOT project-wide)│                                              │
│   └──────────────────────┘                                              │
│                                                                          │
│   Balint user IAM:                                                       │
│     roles/run.invoker (on research-app-staging service)                  │
│     roles/secretmanager.secretAccessor (on database-url + dev-login-key) │
└─────────────────────────────────────────────────────────────────────────┘
                                          │
                                          │ mysql2 (TLS 1.2+)
                                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│           TiDB Cloud Serverless (PingCAP, AWS eu-central-1 Frankfurt)   │
│              cluster: deep-research-staging                             │
│              DB: research_app                                           │
│              host: gateway01.eu-central-1.prod.aws.tidbcloud.com:4000   │
│              Encryption at rest: AES-256 (TiDB-managed, AWS KMS)        │
│              Backup: 24h PITR on free tier                              │
│              aiConfigs.apiKey column: ENC1:iv:ct:tag app-level ciphertext│
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Kulcs architekturális döntések

- **Két service account least-privilege-hez.** `deploy-sa` sosem lát secret értéket; `cloud-run-runtime-sa` nem deploy-ol. Ha az egyik kompromittálódik, a másik scope-ja ép.
- **Per-secret IAM binding.** A `cloud-run-runtime-sa` nem kap projekt-szintű `secretAccessor` role-t — minden secret explicit grant-ot igényel. Új secret = új binding.
- **Multi-region replication kikapcsolva.** Secret Manager `--replication-policy=user-managed --locations=europe-west3` — data residency EU-ban, nem US-copy.
- **SSE timeout 300s.** A research pipeline phase-ek 60-120 sec-et is futhatnak; Cloud Run Gen2 max 60 min-t enged. 300s konzervatív.
- **Min-instances=0.** Staging scale-to-zero → $0 idle cost. Cold start ~500-650 ms (részletek §5.1), elfogadott.
- **Cross-cloud DB.** TiDB csak AWS-en kínál Serverless tier-t — Cloud Run GCP eu-west3 ↔ TiDB AWS eu-central-1 ~10 ms latency, ugyanaz a földrajzi régió.
- **NODE_ENV build-time vs runtime szétválasztás.** Dockerfile `build stage`-ben `NODE_ENV=production` (Vite frontend optimization), `runtime stage`-ben `NODE_ENV=staging` (auth stub + decryptIfNeeded WARN aktív). Cloud Run `--set-env-vars` runtime override-olhatja.

---

## 5. Deployment pipeline (Dockerfile + CI/CD + WIF bootstrap)

### 5.1 Dockerfile (multi-stage)

```dockerfile
# ---- Build stage ----
FROM node:22-alpine AS builder
WORKDIR /app

# NODE_ENV=production a frontend optimalizáláshoz (Vite).
# Az esbuild server bundle ezt NEM inline-olja (default viselkedés);
# ha valaki --define:process.env.NODE_ENV=... flag-et ad, a
# dev-login-gate.test.ts vitest-ben piros lesz.
ENV NODE_ENV=production

# corepack enable: a package.json "packageManager" field pnpm verzióját használja auto
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---- Runtime stage ----
FROM node:22-alpine AS runtime
WORKDIR /app

# Staging default; Cloud Run --set-env-vars override-olhatja.
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

**Cold start budget (startup validation után first response time):**
- Cloud Run container boot (Node 22 Alpine + ESM module graph): ~200–400 ms
- Startup validation (`getMasterKey()` base64 decode + key length check): ~10–50 ms (C2b fast-fail meglévő)
- mysql2 pool first handshake + TiDB wake-from-auto-pause (7 nap): ~200 ms
- First HTTP/SSE response TTFB: **~500–650 ms cold**
- **Mitigation** (prod launch scope-ja): `min-instances=1` + TiDB paid tier = ~$30/hó, cold-start 0-ra megy. Staging-en elfogadva.

### 5.2 Task 1 acceptance gate — mysql2 Alpine kompatibilitás

A Node 22 Alpine musl libc miatt a `mysql2` natív binding verify-t igényel:

```bash
docker build -t research-app:test .
docker run --rm --entrypoint node research-app:test \
  -e "require('mysql2'); console.log('mysql2 loaded OK')"
```

**Ha `ENOENT /lib/ld-musl-x86_64.so.1` vagy hasonló:** fallback a Dockerfile-ban `FROM node:22-alpine` → `FROM node:22-slim` (Debian slim, glibc). Image méret ~150 MB → ~180 MB, elfogadható.

### 5.3 `.dockerignore`

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

### 5.4 WIF + SA bootstrap (one-time manual)

```bash
export PROJECT=deep-research-staging-XXX        # user fills in
export PROJECT_NUMBER=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
export REGION=europe-west3
export REPO=tipometer/Research_App

# 1) API-k engedélyezése
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  --project=$PROJECT

# 2) Service account-ok
gcloud iam service-accounts create deploy-sa \
  --display-name="GitHub Actions deployer" --project=$PROJECT
gcloud iam service-accounts create cloud-run-runtime-sa \
  --display-name="Cloud Run runtime" --project=$PROJECT

# 3) deploy-sa role-ok (strict least-privilege, NINCS Secret Manager role)
for ROLE in roles/run.admin roles/iam.serviceAccountUser roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding $PROJECT \
    --member="serviceAccount:deploy-sa@$PROJECT.iam.gserviceaccount.com" \
    --role="$ROLE"
done

# deploy-sa impersonate-olhatja a runtime SA-t (Cloud Run deploy-hoz szükséges)
gcloud iam service-accounts add-iam-policy-binding \
  cloud-run-runtime-sa@$PROJECT.iam.gserviceaccount.com \
  --member="serviceAccount:deploy-sa@$PROJECT.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser" \
  --project=$PROJECT

# 4) Workload Identity Pool + OIDC Provider (attribute-condition = repo-scoped)
gcloud iam workload-identity-pools create github-pool \
  --location=global --display-name="GitHub Actions Pool" --project=$PROJECT

gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global \
  --workload-identity-pool=github-pool \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='$REPO'" \
  --project=$PROJECT

# 5) deploy-sa kötve csak erre a repo-ra
gcloud iam service-accounts add-iam-policy-binding \
  deploy-sa@$PROJECT.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/attribute.repository/$REPO" \
  --project=$PROJECT

# 6) Artifact Registry repo
gcloud artifacts repositories create research-app-staging \
  --repository-format=docker \
  --location=$REGION \
  --project=$PROJECT

# 7) Cloud Run invoker role Balint user-nek — a first deploy UTÁN fut
# gcloud run services add-iam-policy-binding research-app-staging \
#   --member="user:balint@tipometer.com" \
#   --role="roles/run.invoker" \
#   --region=$REGION --project=$PROJECT
```

### 5.5 GitHub Actions — `.github/workflows/deploy-staging.yml`

```yaml
name: Deploy staging
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  id-token: write  # WIF OIDC token

env:
  PROJECT_ID: deep-research-staging-XXX
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

- `secrets.GCP_PROJECT_NUMBER`: nem érzékeny, csak a WIF provider full path-hoz kell
- Opcionális AI provider key-ek (`OPENAI_API_KEY` stb.) csak ENV fallback integrációs teszthez adódnak a `--set-secrets`-hez

### 5.6 GitHub Actions — `.github/workflows/test.yml`

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
        # nincs version: — a package.json "packageManager" field-ből olvas
      - run: pnpm install --frozen-lockfile
      - run: pnpm check     # tsc --noEmit
      - run: pnpm test      # vitest run (unit + dev-login-gate + handler tests)
```

---

## 6. Database setup (TiDB Cloud Serverless)

### 6.1 Cluster provisioning (one-time manual)

Nincs `gcloud` egyenérték — TiDB külső SaaS. Lépések:

1. **SSO:** `https://tidbcloud.com` → Sign in with Google (ugyanaz a Google Workspace identitás, mint GCP-hez)
2. **Project create:** „Deep Research" project
3. **Serverless cluster create:**
   - Name: `deep-research-staging`
   - Cloud provider: `AWS` (TiDB Serverless csak AWS-en, GCP nincs)
   - Region: `Frankfurt (eu-central-1)` — ~10 ms latency GCP europe-west3-hoz
   - Tier: free (25 GB storage, 250M RU/hó)
4. **DB create:** cluster → "Add Database" → name: `research_app`
5. **Credentials:** Console → "Connect" → copy connection string:
   ```
   mysql://USER.root:PASSWORD@gateway01.eu-central-1.prod.aws.tidbcloud.com:4000/research_app
   ```
   (A `?ssl=...` URL-paramot NEM használjuk — TLS config kódban, §6.2)

### 6.2 mysql2 TLS config (`server/db.ts`)

A `DATABASE_URL` egyetlen Secret Manager entry-ben marad (nem komponensekre bontva — a Drizzle migrate is ezt várja). A TLS config kódban aktiválódik, nem URL-paramban:

```typescript
// server/db.ts (implementáció Task 3 során)
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing");

// TLS kötelező minden nem-localhost hoszton. TiDB / managed DB-k mind
// TLS-t követelnek; csak a (nem létező) lokál MySQL lehet plain.
const isLocal = /@(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);
const ssl = isLocal
  ? undefined
  : { minVersion: "TLSv1.2" as const, rejectUnauthorized: true };

export const pool = mysql.createPool({
  uri: url,
  ssl,
  connectionLimit: 10,
  waitForConnections: true,
});
```

**Drizzle-kit migration TLS:** a `drizzle-kit migrate` laptop-ról futtatáskor a `drizzle.config.ts` nem feltétlenül veszi át a TLS-t a URL-ből. Ha a `pnpm db:push`/`db:migrate` TLS-hibát dob, a `drizzle.config.ts`-ben explicit `dbCredentials: { url, ssl: { minVersion: "TLSv1.2" } }`-t kell használni — Task 3 implementation-közben verify.

### 6.3 Migration strategy — kézi laptop-ról

A schema migrationt **Balint laptop-járól** futtatjuk, nem CI-ben. Indok: a `deploy-sa` strict-least-privilege elv szerint nem kap Secret Manager access-t, ezért nem tud DATABASE_URL-t olvasni; külön `migrate-sa` + dedicated workflow + extra IAM setup helyett staging-re a kézi trigger elegendő (a schema változások ritkák).

```bash
export DATABASE_URL=$(HISTFILE=/dev/null gcloud secrets versions access latest \
  --secret=database-url --project=$PROJECT)
pnpm db:push  # vagy pnpm db:generate + pnpm db:migrate (lásd policy alább)
unset DATABASE_URL
```

**Schema change policy:**

- **Non-destructive changes** (column ADD, index ADD, új tábla): `pnpm db:push` fast-path, staging-re OK
- **Destructive changes** (column DROP, TYPE change, RENAME): `db:push` adatvesztést okozhat figyelmeztetés nélkül → váltás `db:generate` + `db:migrate` workflow-ra:
  ```bash
  pnpm db:generate   # drizzle/<hash>.sql migration file
  # manuális review a generált SQL-re (ALTER/DROP statementek!)
  pnpm db:migrate    # apply
  git add drizzle/ && git commit -m "db: migration for <change>"
  ```
- **Rule of thumb:** ha `pnpm db:push` „Warning: destructive change detected" üzenetet ad → STOP, váltás migration workflow-ra
- **Never commit locally-generated `db:push` state** — a `drizzle/meta/*.json` snapshot-ok csak `db:generate` path-on módosulnak, hogy a main-en a history konzisztens maradjon

### 6.4 Encryption at rest + backup

- **At rest:** TiDB Serverless default AES-256, AWS KMS-hátterű (TiDB-managed). A `aiConfigs.apiKey` column **double-encrypted**: app-szintű AES-256-GCM (C2b) + DB-szintű at-rest. Az igazi védelmi vonal továbbra is a C2b app-szintű kulcs — a DB at-rest nem véd egy szivárgott query log ellen.
- **Backup:** free tier 24h automatic incremental, 24h PITR window. Staging-re elég; prod paid tier-be 7–14 napos retention.

### 6.5 Task 3 acceptance

1. TiDB cluster `deep-research-staging` `ACTIVE` eu-central-1-ben
2. `research_app` DB létrehozva
3. Connection test laptop-ról: `mysql -h ... --ssl-mode=VERIFY_IDENTITY -e "SELECT 1"`
4. `database-url` secret feltöltve Secret Manager-be (§7.2)
5. `pnpm db:push` laptop-ról sikeres, `SHOW TABLES` listázza az `aiConfigs`, `researches`, `users` stb. tableket

---

## 7. Secrets management (Google Secret Manager)

### 7.1 Secret-ek teljes listája (kebab-case naming)

| Secret név | Scope | Runtime SA | Deploy SA | Balint user | Forrás | Rotation |
|---|---|---|---|---|---|---|
| `master-encryption-key` | Core (C2b AES-256) | ✅ `secretAccessor` | ❌ | ❌ | `openssl rand -base64 32` | **⚠️ TILOS** C3 előtt (§7.5) |
| `database-url` | Core (TiDB URI) | ✅ | ❌ | ✅ | TiDB Console → Connect | TiDB password rotation esetén |
| `jwt-secret` | Core (JWT sign) | ✅ | ❌ | ❌ | `openssl rand -base64 64` | Auth migration sprint felülvizsgálja |
| `dev-login-key` | Auth stub | ✅ | ❌ | ✅ | `openssl rand -base64 32` | Amikor a dev stub megszűnik (Auth sprint) |
| `openai-api-key` | *Optional* ENV fallback | ✅ (ha set) | ❌ | ❌ | platform.openai.com | Admin UI runtime rotate preferált |
| `anthropic-api-key` | *Optional* ENV fallback | ✅ (ha set) | ❌ | ❌ | console.anthropic.com | Admin UI runtime rotate preferált |
| `gemini-api-key` | *Optional* ENV fallback | ✅ (ha set) | ❌ | ❌ | aistudio.google.com | Admin UI runtime rotate preferált |

**Megjegyzés az opcionális AI key-ekhez:** a DB-first architektúra szerint a production path-on az admin UI menti a provider kulcsokat a TiDB `aiConfigs` táblába (ahol a C2b encryption védi). A Secret Manager-beli `openai-api-key` entry **csak** first-deploy bootstrap-hez vagy integration teszthez kell — utána törölhető. **A spec ezt explicit hangsúlyozza:** Secret Manager `openai-api-key` ≠ prod kulcs-tárolás, csak dev-ramp utility.

### 7.2 Secret create parancsok (one-time, Balint laptop-ról)

```bash
export PROJECT=deep-research-staging-XXX

# ⚠️ printf "%s" (NOT echo) — a trailing newline a 32 byte kulcsot 33 byte-á tenné,
# amit a getMasterKey() fast-fail elkap, de jobb ha első try-ra sikerül.

openssl rand -base64 32 | tr -d '\n' | gcloud secrets create master-encryption-key \
  --data-file=- --replication-policy=user-managed \
  --locations=europe-west3 --project=$PROJECT

read -s -p "Paste TiDB URL: " TIDB_URL
printf "%s" "$TIDB_URL" | gcloud secrets create database-url \
  --data-file=- --replication-policy=user-managed \
  --locations=europe-west3 --project=$PROJECT
unset TIDB_URL

openssl rand -base64 64 | tr -d '\n' | gcloud secrets create jwt-secret \
  --data-file=- --replication-policy=user-managed \
  --locations=europe-west3 --project=$PROJECT

openssl rand -base64 32 | tr -d '\n' | gcloud secrets create dev-login-key \
  --data-file=- --replication-policy=user-managed \
  --locations=europe-west3 --project=$PROJECT
```

**`--replication-policy=user-managed --locations=europe-west3`:** a secret fizikailag Frankfurt-ban replikálódik, nem automatic multi-region. **Data residency EU guarantee** — nem US-copy-val szétterjedt `automatic` policy.

### 7.3 Runtime SA per-secret IAM binding

```bash
export RUNTIME_SA="cloud-run-runtime-sa@$PROJECT.iam.gserviceaccount.com"

for SECRET in master-encryption-key database-url jwt-secret dev-login-key; do
  gcloud secrets add-iam-policy-binding $SECRET \
    --member="serviceAccount:$RUNTIME_SA" \
    --role="roles/secretmanager.secretAccessor" \
    --project=$PROJECT
done
```

**Nincs projekt-szintű `secretAccessor`** a runtime SA-ra. Minden új secret tudatos grant-ot igényel.

### 7.4 Balint user per-secret binding (migration + smoke-test)

```bash
# DATABASE_URL: a pnpm db:push laptop-workflow miatt
gcloud secrets add-iam-policy-binding database-url \
  --member="user:balint@tipometer.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=$PROJECT

# DEV_LOGIN_KEY: a Task 8 smoke-test protokollhoz
# (a /dev/login?key=<DEV_LOGIN_KEY> URL-hez a kulcsot ki kell olvasnod)
gcloud secrets add-iam-policy-binding dev-login-key \
  --member="user:balint@tipometer.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=$PROJECT
```

**NEM** kapsz hozzáférést a `master-encryption-key`-hez és `jwt-secret`-hez — még te sem tudod accidentally kiexportálni. Ha egyszer szükség lesz rá (pl. local debug), explicit grant + audit trail.

### 7.5 ⚠️ KRITIKUS: `master-encryption-key` rotation tilalom

> **⚠️ A `master-encryption-key` secret értékét TILOS megváltoztatni, amíg a C3 dual-key decrypt nincs implementálva.**
>
> Ha az értéke megváltozik, az összes `ENC1:` ciphertext sor a TiDB `aiConfigs` táblában olvashatatlanná válik. Minden admin-nek újra be kell írnia a provider kulcsokat az admin UI-n keresztül.
>
> **Recovery (C3 előtt):** admin login → AI Config → minden provider → új key save. Az encryptApiKey új key-jel ír, az olvasás sikeres lesz.
>
> **Automatizált recovery (C3 scope):**
> - Dual-key decrypt window: `MASTER_ENCRYPTION_KEY_OLD` + `MASTER_ENCRYPTION_KEY` egyszerre aktív
> - Re-encryption batch script: végigmegy az `aiConfigs` rekordokon, dekódol old key-jel, kódol új key-jel, ír vissza
> - Admin „Re-encrypt all legacy keys" gomb
> - Encryption-specific audit log event-ek (`key_rotated`, `ciphertext_reencrypted`)

### 7.6 Secret rotation strategy előkészítés (C3 előtt)

- **Most:** `gcloud secrets versions add <name> --data-file=-` → új verzió → Cloud Run `:latest` automatikusan a következő deployed revisionben. Régi verzió `gcloud secrets versions disable <old>` után kivonható.
- **Zero-downtime rotation** akkor biztos, ha a rotation után új revision deploy-ol. Running instance-ok a régi verziót cache-elik memóriában; új revision deploy = fresh pull.
- **C3 scope:** dual-key decrypt (legacy + current master key egyszerre), re-encryption batch, rotation audit events.

---

## 8. Auth stub design (`server/auth/dev-login.ts`)

### 8.1 Architektúra: triple-gated registration

A triple-gate **három dolgot** kapcsol ki egyszerre:

1. `/dev/login` route regisztrációja
2. `devAuthMiddleware` mount (a `/api/*`-ra)
3. Seeded `dev-admin-staging` user row (lazy idempotent)

Nincs részleges „disabled but reachable" állapot.

### 8.2 `registerDevLoginIfEnabled(app)` — az unified gate

```typescript
// server/auth/dev-login.ts
import type { Express, Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { db } from "../db";
import { users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { logger } from "../_core/logger";

const DEV_USER_SUB = "dev-admin-staging";
const DEV_USER_EMAIL = "dev-admin@staging.local";
const COOKIE_NAME = "dev_session";
const COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000;  // 12 óra

let seeded = false;

export function registerDevLoginIfEnabled(app: Express): boolean {
  const enabled =
    process.env.NODE_ENV !== "production" &&
    process.env.ENABLE_DEV_LOGIN === "true";
  if (!enabled) return false;

  // Fast-fail validation — analóg a C2b getMasterKey()-jel
  if (!process.env.DEV_LOGIN_KEY) {
    throw new Error("ENABLE_DEV_LOGIN=true but DEV_LOGIN_KEY is missing");
  }
  if (!process.env.JWT_SECRET) {
    throw new Error("ENABLE_DEV_LOGIN=true but JWT_SECRET is missing");
  }

  app.get("/dev/login", devLoginHandler);
  app.use("/api", devAuthMiddleware);

  return true;
}

async function ensureDevUserExists(): Promise<void> {
  if (seeded) return;
  const existing = await db.select().from(users).where(eq(users.email, DEV_USER_EMAIL));
  if (existing.length === 0) {
    // Task 0.2 audit alapján a pontos column-neveket kell használni
    await db.insert(users).values({
      email: DEV_USER_EMAIL,
      name: "Dev Admin (staging)",
      role: "admin",
    });
  }
  seeded = true;
}
```

### 8.3 `/dev/login` handler — timing-safe compare + rate limit + audit log

```typescript
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

async function devLoginHandler(req: Request, res: Response) {
  await new Promise<void>((r) => devLoginLimiter(req, res, () => r()));
  await ensureDevUserExists();

  const keyParam = req.query.key;
  const expectedKey = process.env.DEV_LOGIN_KEY!;
  const ip = req.ip;

  // Timing-safe compare (KÖTELEZŐ, nem recommendation).
  // Length check: a két buffer különböző hosszúságánál a timingSafeEqual dob.
  // A length leak elfogadott: a DEV_LOGIN_KEY hossza (44 char, base64 32 byte) nem titok.
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
    return res.status(401).send("Unauthorized");
  }

  const token = jwt.sign(
    { sub: DEV_USER_SUB, email: DEV_USER_EMAIL, role: "admin" },
    process.env.JWT_SECRET!,
    {
      expiresIn: "12h",
      issuer: "research-app-staging",
      audience: "research-app",
    }
  );

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,         // Cloud Run mindig HTTPS
    sameSite: "lax",      // "strict" a redirect flow-t törné
    maxAge: COOKIE_MAX_AGE_MS,
    path: "/",
  });

  logger.info({ event: "dev_login_success", ip, sub: DEV_USER_SUB });
  res.redirect("/");
}
```

### 8.4 `devAuthMiddleware` — JWT verify → `ctx.user`

```typescript
async function devAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: "No dev session" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!, {
      issuer: "research-app-staging",
      audience: "research-app",
    }) as jwt.JwtPayload;

    if (decoded.sub !== DEV_USER_SUB) {
      return res.status(401).json({ error: "Invalid dev session subject" });
    }

    // ⚠️ Task 0.1 audit eredménye szerint: ha a tRPC context builder NEM req.user-ből
    // olvassa a user-t, akkor a megfelelő field-be írni (req.manusUser, req.auth, stb.).
    (req as any).user = {
      id: DEV_USER_SUB,
      email: DEV_USER_EMAIL,
      role: "admin",
    };

    next();
  } catch (err) {
    logger.warn({ event: "dev_session_invalid", error: String(err) });
    return res.status(401).json({ error: "Invalid dev session" });
  }
}
```

### 8.5 Integráció a meglévő auth chain-nel

A `server/_core/index.ts`-ben a Manus OAuth middleware marad (Auth sprint scope), de staging-en nem mountolódik:

```typescript
// server/_core/index.ts
import { registerDevLoginIfEnabled } from "../auth/dev-login";
import { manusAuthMiddleware } from "./oauth";

const devAuthEnabled = registerDevLoginIfEnabled(app);
if (!devAuthEnabled) {
  // Production / non-dev path — meglévő Manus flow érintetlen
  app.use("/api", manusAuthMiddleware);
}
```

**Mutually exclusive:** dev auth aktív → Manus middleware nincs mountolva. Dev auth inaktív → csak Manus. Nincs „dev + Manus fallback" kombó, ami félkész állapotot produkálna production-ban.

### 8.6 Guard tesztek — `dev-login-gate.test.ts`

```typescript
import { afterEach, describe, it, expect, vi } from "vitest";
import express from "express";
import { registerDevLoginIfEnabled } from "../auth/dev-login";

describe("dev-login route gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("registers /dev/login when NODE_ENV=staging + ENABLE_DEV_LOGIN=true", () => {
    vi.stubEnv("NODE_ENV", "staging");
    vi.stubEnv("ENABLE_DEV_LOGIN", "true");
    vi.stubEnv("DEV_LOGIN_KEY", "test-key");
    vi.stubEnv("JWT_SECRET", "test-secret");
    const app = express();
    registerDevLoginIfEnabled(app);
    const hasDev = app._router.stack.some((l: any) => l.regexp?.source?.includes("dev"));
    expect(hasDev).toBe(true);
  });

  it("does NOT register when NODE_ENV=production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_DEV_LOGIN", "true");
    const app = express();
    registerDevLoginIfEnabled(app);
    const hasDev = app._router.stack.some((l: any) => l.regexp?.source?.includes("dev"));
    expect(hasDev).toBe(false);
  });

  it("does NOT register when ENABLE_DEV_LOGIN is unset", () => {
    vi.stubEnv("NODE_ENV", "staging");
    // ENABLE_DEV_LOGIN deliberately not stubbed
    const app = express();
    registerDevLoginIfEnabled(app);
    const hasDev = app._router.stack.some((l: any) => l.regexp?.source?.includes("dev"));
    expect(hasDev).toBe(false);
  });
});
```

A harmadik teszt kritikus: verify-álja, hogy a gate nem csak `=== "true"` ellenőrzést végez, hanem az unset állapotot is explicit false-ként kezeli.

### 8.7 Handler tesztek — `dev-login-handler.test.ts` (~6 eset)

- `/dev/login` hibás key → 401, `dev_login_failure` log
- `/dev/login` helyes key → 302 redirect, `dev_session` cookie set (httpOnly + secure + lax), `dev_login_success` log
- `/dev/login` 6. próbálkozás/perc → 429 rate limit
- `devAuthMiddleware` valid JWT → `req.user = { role: 'admin', ... }`
- `devAuthMiddleware` expired JWT → 401
- `devAuthMiddleware` hibás issuer/audience → 401

### 8.8 Biztonsági audit összefoglaló

| Támadásvektor | Védelem |
|---|---|
| Public URL exposure | Cloud Run `--no-allow-unauthenticated` |
| Accidentally production deploy | Triple-gate (route registration + NODE_ENV + ENABLE_DEV_LOGIN) |
| DEV_LOGIN_KEY brute-force | Rate limit 5/perc, 256-bit entropy, Cloud Run IAM előzetes barrier |
| DEV_LOGIN_KEY leak | Rotate: új secret version → új Cloud Run revision. Régi JWT-k 12h-n belül expire |
| Stolen JWT cookie | httpOnly + secure + sameSite=lax, 12h max-age. Rotate JWT_SECRET = invalidate all |
| Build-time DCE (esbuild `--define`) | `dev-login-gate.test.ts` bundled build verify |
| Manus middleware mellett dupla auth | `if (!devAuthEnabled) use manus` — mutually exclusive |
| Timing attack DEV_LOGIN_KEY-re | `timingSafeEqual` kötelező |

**Elfogadott kockázat:** `devAuthMiddleware` nem rate-limited. Érvényes JWT-vel rendelkező támadó (ellopott cookie) korlátlan API hívást tehet 12 órán keresztül. Mitigation: session revocation / token blocklist a **prod-level Auth migration sprint scope-ja**. Staging-en az IAM-gated URL + 12h JWT expire + JWT_SECRET rotation = elfogadható védelem.

---

## 9. Pre-containerization audit + dead code cleanup

Ez a Task 0 utáni első implementációs lépés — a Dockerfile írása ELŐTT, hogy az image ne vigyen dead code-ot.

### 9.1 Audit script — `bin/manus-audit.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "═══════════════════════════════════════════════════════"
echo "9.1.1 — Manus env var references"
echo "═══════════════════════════════════════════════════════"
grep -rnE "BUILT_IN_FORGE_API_URL|BUILT_IN_FORGE_API_KEY|OAUTH_SERVER_URL|VITE_APP_ID|OWNER_OPEN_ID|MANUS_|VITE_ANALYTICS_ENDPOINT" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.json" --include="*.example" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=drizzle \
  . || echo "  (no matches)"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "9.1.2 — AWS SDK references"
echo "═══════════════════════════════════════════════════════"
grep -rnE "@aws-sdk|AWS\.|aws-sdk" \
  --include="*.ts" --include="*.tsx" --include="*.json" \
  --exclude-dir=node_modules --exclude-dir=dist \
  . || echo "  (no matches)"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "9.1.3 — Scaffold file import graph"
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
echo "9.1.4 — Manus OAuth (NE piszkáld, Auth sprint scope)"
echo "═══════════════════════════════════════════════════════"
grep -rnE "manusAuthMiddleware|server/_core/oauth" \
  --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules --exclude-dir=dist \
  . || echo "  (no matches)"
echo "  ↑ ha van match: HAGYD BÉKÉN. Auth migration sprint kezeli."
```

Output → `docs/deployment/manus-audit-report-YYYY-MM-DD.md` committed.

### 9.2 Döntés-mátrix per artifakt

| Artifact | Várt audit eredmény | Döntés | Ok |
|---|---|---|---|
| `@aws-sdk/client-s3` dep | 0 import | **törlés** | Dead dep, ~15 MB image |
| `@aws-sdk/s3-request-presigner` dep | 0 import | **törlés** | Dead dep |
| `server/storage.ts` | 0 import | **törlés** | Manus Forge proxy dead |
| `server/_core/map.ts` | 0 import | **törlés** | Google Maps Manus proxy |
| `server/_core/voiceTranscription.ts` | 0 import | **törlés** | Manus STT proxy |
| `server/_core/imageGeneration.ts` | 0 import | **törlés** | Manus image-gen proxy |
| `server/_core/dataApi.ts` | 0 import | **törlés** | Manus generic data API |
| `server/_core/notification.ts` | 0 import | **törlés** | Manus push notif |
| `server/_core/oauth.ts` | imported from `_core/index.ts` | **MARAD** | Auth sprint scope |
| `env.ts: forgeApiUrl, forgeApiKey` | tied to deleted scaffolds | **törlés** | Dead env bindings |
| `env.ts: cookieSecret, databaseUrl, isProduction` | core | **MARAD** | App runtime használja |
| `env.ts: appId, oAuthServerUrl, ownerOpenId` | Manus OAuth scope | **MARAD** | Auth sprint scope |
| `VITE_ANALYTICS_ENDPOINT` | audit-függő | **törlés HA** nincs runtime olvasó | Manus scaffold ghost egyes verziókban |
| `env.local.example` | dead env-eket tartalmaz | **frissítés** — csak élő env-ek | Developer onboarding |

**`env.ts` szelektív cleanup:** az audit output alapján a file **mix** — 3 core + 3 Manus OAuth + 2 dead. Ebben a sprintben **csak a dead kettő törlődik**; a többi változatlan. Ha egy későbbi sprint minden binding-ot átmozgat egy dedicated `env-schema.ts`-be (zod validation-nel), akkor az `env.ts` teljes törlésre kerülhet.

### 9.3 Cleanup commit order (egy PR, szekvenciális commits, NEM squash)

```
commit 1: audit: manus scaffold dead-code inventory report
  → docs/deployment/manus-audit-report-YYYY-MM-DD.md
  → nincs code change, evidence record

commit 2: chore: remove unused @aws-sdk dependencies
  → package.json + pnpm-lock.yaml
  → pnpm install --frozen-lockfile verify

commit 3: chore: delete unused Manus scaffold modules
  → 6 file törlés (server/storage.ts + 5 _core/* file)
  → pnpm check (tsc) verify — ha piros: rejtett import, audit nem találta
  → pnpm test verify

commit 4: chore: remove dead Manus env bindings
  → env.ts: forgeApiUrl + forgeApiKey törlés (2 sor)
  → env.local.example frissítés
  → pnpm check + pnpm test verify
```

A commit-ok **NEM squashelődnek**. Ha a commit 3 után runtime hiba (dynamic `await import(...)` string-concat), a `git reset --hard HEAD~1` az előző 2 cleanup-ot megtartja.

### 9.4 Escape hatch

A commit 3 után **lokálisan** `pnpm dev` + happy-path click-through (landing → dashboard → admin → research indítás). Ha module-not-found error a dev console-ban → restore az érintett file-t git history-ból, stub-oljon helyette (export `throw new Error("...")` a metódusokból, hogy a hívó azonnali runtime error-t kapjon, ne silent fail).

### 9.5 Mellékes win

Cleanup után az image ~30 MB-tal kisebb (AWS SDK ~15 MB + dead scaffolds ~1-2 MB + `pnpm --prod` kizárja a dev dep-eket). Cold start gyorsul ~50-100 ms-szal (kisebb container layer pull).

---

## 10. Observability

### 10.1 Structured JSON logging — `server/_core/logger.ts`

Nincs új dependency. A stdlib `console.log` JSON-formátummal a Cloud Logging `severity` + `jsonPayload.*` mezőket automatikusan parse-olja.

```typescript
type LogLevel = "debug" | "info" | "warn" | "error";

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
  console.log(JSON.stringify(entry));
}

export const logger = {
  debug: (p: Record<string, unknown>) => emit("debug", p),
  info: (p: Record<string, unknown>) => emit("info", p),
  warn: (p: Record<string, unknown>) => emit("warn", p),
  error: (p: Record<string, unknown>) => emit("error", p),
};
```

### 10.2 Startup log emission — `server/_core/index.ts`

A server `listen` callback-en, a startup validation UTÁN:

```typescript
// server/_core/index.ts — listen callback
app.listen(port, async () => {
  // C2b getMasterKey() már a startup-on validál.
  // Kiegészítés: DB smoke-query
  try {
    await db.execute(sql`SELECT 1`);
  } catch (err) {
    logger.error({ event: "startup_db_check_failed", error: String(err) });
    process.exit(1);
  }

  logger.info({
    event: "startup_complete",
    port,
    nodeEnv: process.env.NODE_ENV,
    devAuthEnabled,  // a registerDevLoginIfEnabled return value
  });
});
```

**Clarifikáció:** a `startup_complete` event **a mi observability-nkhöz** kell, **NEM a Cloud Run deploy gate-hez**. Cloud Run a container port bindingot + TCP probe-ot figyeli a revision health-hez, függetlenül a log-tól. A `startup_complete` event a cold-start pattern diagnosztikájához (query #5, §10.4) hasznos.

### 10.3 Használat kritikus path-okon

- `server/ai/crypto.ts` `decryptIfNeeded` plaintext WARN (C2b meglévő): `console.warn(...)` → `logger.warn({ event: "plaintext_api_key_detected", provider })`
- `server/ai/pipeline-phases.ts` phase complete: `logger.info({ event: "phase_complete", phase, researchId, durationMs })`
- `server/auth/dev-login.ts` success/failure: §8.3-ban már JSON payload-ként
- Error middleware: `logger.error({ event: "unhandled_exception", message: err.message, stack: err.stack, path: req.path })`

**Nem cél:** a teljes `console.log` migráció. Legacy plain-text log-ok is eljutnak Cloud Logging-ba (plainText payload), csak kevésbé keresekhetők — staging-en OK.

### 10.4 Cloud Logging queries — `docs/deployment/cloud-logging-queries.md`

```
# 1. Minden ERROR utolsó 1 órában
resource.type="cloud_run_revision"
resource.labels.service_name="research-app-staging"
severity>=ERROR

# 2. Auth stub log-ok (success + failure + rate limit)
resource.type="cloud_run_revision"
jsonPayload.event=~"dev_login_.*|dev_session_.*"

# 3. Encryption path health (C2b plaintext warn)
resource.type="cloud_run_revision"
jsonPayload.event="plaintext_api_key_detected"

# 4. Pipeline phase durations
resource.type="cloud_run_revision"
jsonPayload.event="phase_complete"
# Explore panel: jsonPayload.durationMs aggregálás

# 5. Cold start detection
resource.type="cloud_run_revision"
jsonPayload.event="startup_complete"
```

### 10.5 Error Reporting — zero config

Cloud Run → Cloud Logging default routing → Error Reporting auto-group (stack trace hash alapján). **Nincs extra setup.** A `logger.error({ stack: err.stack })` pattern elég az auto-detect-hez. `@google-cloud/error-reporting` npm package **NEM** kell (extra dep + ugyanaz a viselkedés mint auto).

### 10.6 Uptime check — kihagyva ebben a sprintben

IAM-gated staging-en uptime check ROI alacsony (Cloud Run built-in container health már működik, public traffic nincs). **Prod launch sprint hatáskör.**

### 10.7 Log retention

Cloud Logging default 30 nap. Free tier 50 GB/hó. Volumenünk ettől nagyságrendekkel alatt. Nincs extra action.

---

## 11. Task 8 E2E smoke-test protocol

Deployment gate check. First deploy után egyszer futtatod, outcome-ot dokumentálod.

### 11.1 Előfeltételek

- [ ] `deploy-staging.yml` zöld (legutóbbi main push után)
- [ ] `gcloud run services describe research-app-staging --region=europe-west3 --format='value(status.conditions[0].type,status.conditions[0].status)'` → `Ready True`
- [ ] TiDB cluster `deep-research-staging` `ACTIVE`
- [ ] Balint user IAM: `run.invoker` a Cloud Run service-en + `secretAccessor` a `database-url` és `dev-login-key`-re

### 11.2 Lépések (~5-10 perc)

**Step 1 — Secret létezés ellenőrzése**

```bash
export PROJECT=deep-research-staging-XXX
for s in master-encryption-key database-url jwt-secret dev-login-key; do
  gcloud secrets describe $s --project=$PROJECT --format='value(name,createTime)'
done
# Várható: 4 sor. Bármelyik hiányzik → STOP, §7.2 bootstrap nem futott.
```

**Step 2 — Dev login URL összeállítása**

```bash
# HISTFILE=/dev/null — a DEV_KEY ne kerüljön shell history-ba
export DEV_KEY=$(HISTFILE=/dev/null gcloud secrets versions access latest \
  --secret=dev-login-key --project=$PROJECT)
export STAGING_URL=$(gcloud run services describe research-app-staging \
  --region=europe-west3 --project=$PROJECT --format='value(status.url)')
echo "${STAGING_URL}/dev/login?key=${DEV_KEY}"
# Copy & paste böngészőbe
unset DEV_KEY
```

**Step 3 — IAM-authenticated browser session**

```bash
# Option A: gcloud proxy (stdlib, nincs extra tool)
gcloud run services proxy research-app-staging --region=europe-west3
# localhost:8080-on forward-olva; böngészőben
# http://localhost:8080/dev/login?key=...
```

**Step 4 — Login → admin UI**

- [ ] `/dev/login?key=...` → 302 → `/`
- [ ] Navigation bar látható, user menu: "Dev Admin (staging)"
- [ ] `/admin` vagy `/settings/api-keys` elérhető, 401 nincs

**Step 5 — OpenAI API key save**

- [ ] Admin → AI Config → OpenAI provider → valódi `sk-...` kulcs
- [ ] Save → "🔒 Encrypted" badge (C2b UI)
- [ ] Network: 200, nincs error

**Step 6 — DB ciphertext verify (KRITIKUS)**

```bash
export DB_URL=$(HISTFILE=/dev/null gcloud secrets versions access latest \
  --secret=database-url --project=$PROJECT)

# URL parsing (bash, extra dep nélkül)
TIDB_USER=$(echo "$DB_URL" | sed -E 's|^mysql://([^:]+):.*|\1|')
TIDB_HOST=$(echo "$DB_URL" | sed -E 's|^mysql://[^@]+@([^:/]+).*|\1|')
TIDB_PORT=$(echo "$DB_URL" | sed -E 's|^mysql://[^@]+@[^:/]+:([0-9]+).*|\1|')
TIDB_DB=$(echo "$DB_URL"   | sed -E 's|^mysql://[^@]+@[^/]+/([^?]+).*|\1|')
# MYSQL_PWD: nem látszik a ps output-ban
export MYSQL_PWD=$(echo "$DB_URL" | sed -E 's|^mysql://[^:]+:([^@]+)@.*|\1|')

mysql -h "$TIDB_HOST" -P "$TIDB_PORT" -u "$TIDB_USER" \
  --ssl-mode=VERIFY_IDENTITY "$TIDB_DB" \
  -e "SELECT provider, LEFT(apiKey, 5) AS prefix, LENGTH(apiKey) AS len, updatedAt
      FROM aiConfigs WHERE provider='openai' ORDER BY updatedAt DESC LIMIT 1;"

unset MYSQL_PWD DB_URL TIDB_USER TIDB_HOST TIDB_PORT TIDB_DB
```

Várt output:
```
+----------+--------+-----+---------------------+
| provider | prefix | len | updatedAt           |
+----------+--------+-----+---------------------+
| openai   | ENC1:  | XXX | 2026-04-20 HH:MM:SS |
+----------+--------+-----+---------------------+
```

- [ ] `prefix` = `ENC1:` (C2b envelope prefix)
- [ ] `len` 80–130 byte (függ a kulcs hosszától: OpenAI ~115, Anthropic ~130, Gemini ~80)
- [ ] **NEM** `sk-...` (ha ezt látod: encryption path nem futott → BLOCKER)

Ciphertext hossz magyarázat:
```
ENC1: (5) + IV_b64(16) + ":" (1) + CT_b64(ceil(N_plaintext/3)*4) + ":" (1) + TAG_b64(24)
N_plaintext: OpenAI sk- ~51 byte, Anthropic sk-ant- ~100 byte, Gemini ~39 byte
→ total: ~80 (Gemini) — ~130 (Anthropic long)
```

**Step 7 — Research pipeline trigger**

- [ ] `/new-research` → test prompt („Mi a napelem elterjedtsége Magyarországon 2025-ben?")
- [ ] Strategy: „Quick"
- [ ] Start → Research Progress → SSE live feed

**Step 8 — Pipeline success verify a Cloud Logging-ban**

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   resource.labels.service_name="research-app-staging"
   (jsonPayload.event="phase_complete" OR jsonPayload.event="pipeline_complete"
    OR severity="ERROR")' \
  --project=$PROJECT --limit=50 --format=json | \
  jq '.[] | {timestamp, severity, event: .jsonPayload.event, phase: .jsonPayload.phase}'
```

Várt:
- [ ] 4 `phase_complete` event (wide scan, gap detection, deep dives, synthesis)
- [ ] 1 `pipeline_complete`
- [ ] **ZERO** `DecryptionError` vagy `ERROR`-severity
- [ ] Report megjelenik UI-ban, radar chart render-el, source library populated

### 11.3 Success record

```bash
cat > docs/deployment/smoke-test-c2b-run-YYYY-MM-DD.md << EOF
# Task 8 C2b Smoke-Test — SUCCESS
Run: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Cloud Run revision: $(gcloud run revisions list --service=research-app-staging \
  --region=europe-west3 --project=$PROJECT --format='value(metadata.name)' --limit=1)
TiDB cluster: deep-research-staging
ENC1 prefix verified: YES
Pipeline complete: YES
Errors in logs: 0
EOF
git add docs/deployment/smoke-test-c2b-run-*.md
git commit -m "docs: Task 8 C2b smoke-test success record"
```

### 11.4 Failure recovery

| Step | Hiba | Diagnosztika |
|---|---|---|
| 1 | Secret hiányzik | §7.2 bootstrap futott-e? |
| 2 | `PERMISSION_DENIED` | §7.4 Balint binding `dev-login-key`-re nincs |
| 3 | `proxy` 403 | Balint `roles/run.invoker` nem beállítva (§5.4 step 7 nem futott) |
| 4 | 401 redirect loop | `DEV_LOGIN_KEY` env ↔ secret mismatch — Cloud Run revision nem a legfrissebb secret-et kapta; redeploy |
| 5 | tRPC mutate 500 | `getMasterKey()` startup fail → Cloud Run log: key length mismatch vagy `--set-secrets` hiányzik |
| 6 | `prefix=sk-` | **Encryption path nem futott.** `encryptApiKey` hívási hely verify az admin API endpoint-on — C2b regression |
| 7 | Research start 500 | AI provider key invalid vagy Gemini grounding URL blokkolt (Cloud Run egress) |
| 8 | `DecryptionError` event | `aiConfigs.apiKey` dekódolás fail runtime-ban → `master-encryption-key` secret érték inkonzisztens a ciphertext-et készítő kulccsal. **KRITIKUS (§7.5 warning):** manual delete + re-save az admin UI-n (a C3 dual-key decrypt a strukturált megoldás) |

---

## 12. Risks, deferred items, follow-ups

### 12.1 Known risks (elfogadott, dokumentált)

| # | Risk | Impact | Mitigation / deferral |
|---|---|---|---|
| R1 | TiDB Serverless auto-pause 7 nap → ~200 ms cold start | User-visible latency ~500-650 ms staging-en | Prod launch: paid tier `min-instance=1`. Early-stage: elfogadva |
| R2 | `mysql2` TiDB URL-param TLS kompat | Blokkoló hiba | §6.2 TLS config kódban; Task 3 verify |
| R3 | `node:22-alpine` musl `mysql2` kompat | Image fail | §5.2 Task 1 acceptance gate; fallback `node:22-slim` |
| R4 | tRPC context `req.user` field name | Minden tRPC call 401 | §3 Task 0.1 kötelező audit |
| R5 | `master-encryption-key` accidental rotation | Teljes `aiConfigs` olvashatatlan | §7.5 ⚠️ warning + IAM-no-access Balintnak. C3 dual-key decrypt a strukturált megoldás |
| R6 | `ENABLE_DEV_LOGIN=true` + `NODE_ENV=staging` accidentally prod-on | Triple-gate működne prod-on | Triple-gate mind a 3 komponense nem-default. Prod launch: `NODE_ENV=production` kötelezése |
| R7 | Manus cleanup runtime error (dynamic import miss) | 500 response egyes flow-kon | §9.4 escape hatch: `pnpm dev` click-through commit 3 után |
| R8 | Cloud Run egress: Gemini grounding URL block | Phase 1-3 pipeline fail | Default Cloud Run egress nyitott, de ha VPC connector bind-olódik, cross-cloud blocked. Smoke-test Step 8 detekálja |
| R9 | Cross-cloud latency GCP ↔ AWS TiDB | ~10 ms/query = ~50 ms/pipeline overhead | Elfogadva; prod `min-instances=1` + pooling mitigál |
| R10 | GCP free tier limit | Bill start | `<$5/hó` várható; `gcloud billing budgets create` follow-up |
| R11 | pnpm-lock.yaml version drift CI vs lokál | `--frozen-lockfile` fail | `package.json` `packageManager` field + `corepack enable` mindkét helyen (Task 0.3 audit) |

### 12.2 Explicit deferred items

- **Auth migration** off Manus OAuth → külön sub-projekt
- **Prod launch:** custom domain, Cloud Armor WAF, public URL, Sentry, `min-instances=1`, uptime check, DR runbook
- **Storage / Export:** GCS bucket, blob upload, PDF/MD export, CSV import
- **Payment:** Stripe + Számlázz.hu
- **DOMPurify hardening, Synthesis 2.0** → V1 remainder
- **KMS + rotation + dual-key decrypt + re-encryption batch** → C3 sub-projekt
- **Automated E2E smoke-test script / Playwright** → C3 (rotation validation miatt amúgy is kell)

### 12.3 Follow-up minor improvements

- **`env.ts` zod schema + fast-fail** — jelenleg `?? ""` fallback footgun (missing DB_URL → silent empty string → runtime crash). Zod parse() startup-on + fast-fail.
- **Graceful shutdown** — Cloud Run SIGTERM 10s grace. Jelenleg nincs SIGTERM handler; SSE drain hiányzik. Prod launch scope.
- **Billing alert** — `gcloud billing budgets create` staging-re $10/hó limit.
- **CPU allocation `--cpu-throttling` vs `--no-cpu-throttling`** — default throttled (CPU csak request alatt). Pipeline background tRPC stream során aktív, nem probléma staging-en. Prod-on revisit.

### 12.4 Success-verification checkpoints (sprint közben, nem csak end)

1. Task 0 (audit) után: `docs/deployment/task-0-audit-findings.md` commit
2. Task 1 (Dockerfile + build) után: `docker build` + `docker run --rm node -e "require('mysql2')"` acceptance
3. Task 2 (WIF + SA setup) után: GHA test.yml dry-run (auth-only)
4. Task 3 (TiDB + secrets) után: laptop `mysql` smoke + `gcloud secrets list`
5. Task 4 (dev auth stub + logger) után: vitest zöld (9 új dev-login tests + meglévő 203)
6. Task 5 (Manus cleanup) után: `pnpm check` + `pnpm test` + `pnpm dev` click-through
7. Task 6 (first deploy) után: Cloud Run revision `Ready`, `/health` 200
8. Task 7 (Task 8 E2E smoke-test) után: §11 protokoll → success record commit

Minden task „Done" kritérium: push + user checkpoint (batch/checkpoint memória pattern).

---

## 13. Appendix

### 13.1 Secret name exact-match audit tábla

Bootstrap script (`§7.2`), workflow (`§5.5`), kód (csak env var nevek, nem secret nevek) mind ugyanazt a kebab-case secret nevet használja:

| Secret (Secret Manager) | Workflow `--set-secrets` | Kód `process.env.X` |
|---|---|---|
| `master-encryption-key` | `MASTER_ENCRYPTION_KEY=master-encryption-key:latest` | `MASTER_ENCRYPTION_KEY` |
| `database-url` | `DATABASE_URL=database-url:latest` | `DATABASE_URL` |
| `jwt-secret` | `JWT_SECRET=jwt-secret:latest` | `JWT_SECRET` |
| `dev-login-key` | `DEV_LOGIN_KEY=dev-login-key:latest` | `DEV_LOGIN_KEY` |
| `openai-api-key` *(opt.)* | `OPENAI_API_KEY=openai-api-key:latest` | `OPENAI_API_KEY` |
| `anthropic-api-key` *(opt.)* | `ANTHROPIC_API_KEY=anthropic-api-key:latest` | `ANTHROPIC_API_KEY` |
| `gemini-api-key` *(opt.)* | `GEMINI_API_KEY=gemini-api-key:latest` | `GEMINI_API_KEY` |

Exact match kötelező. Ha bármelyik eltér, a Cloud Run deploy fail-el „Secret not found" üzenettel.

### 13.2 Hivatkozások

- C1 design: `docs/superpowers/specs/2026-04-17-ai-pipeline-c1-design.md`
- C2a design: `docs/superpowers/specs/2026-04-18-c2a-fallback-sanitization-design.md`
- C2b design: `docs/superpowers/specs/2026-04-18-c2b-encryption-design.md`
- PRD §3.4 (Infrastruktúra és Naplózás)
- Handoff doc §15 (Decisions log — Infra deploy target választás)

---

*End of design document.*
