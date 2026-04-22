# Sprint 1 — Demo-Quality Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec reference:** [docs/superpowers/specs/2026-04-22-sprint1-demo-quality-product-design.md](../specs/2026-04-22-sprint1-demo-quality-product-design.md)

**Goal:** A Validation Workspace backend foundation (PR #13-#14) láthatóvá tétele a frontenden (4 decision panel + dimension-grouped source chipek a meglévő `ResearchReport.tsx`-en), plusz P1 AI API keys Secret Manager + P2 synthesis scoring rubric fix, hogy a termék **belső demóra kész** legyen a Sprint 2 (public-ready shell) előtt.

**Architecture:**
- **No new navigation**: 4 decision panel a meglévő radar alatt, `Tabs` komponens felett; a "Mind" chip dimension filter a meglévő Források tab-on. A pre-PR #13 research-ek teljesen változatlanul működnek (conditional render fallback).
- **Additive-only**: nem módosítjuk az `auth`, `billing`, `AI routing`, `synthesis pipeline architektúrát` — csak egy prompt additív blokk (P2) és 3 frontend data integráció (`validation.getSnapshot`, `validation.getEvidenceByDimension`).
- **DB-first, ENV fallback (P1)**: a C1 óta érvényes provider key mechanizmus változatlan; a `gemini/anthropic/openai-api-key` Secret Manager entry-k **csak bootstrap fallback**-ként szolgálnak (DB-beli `aiConfigs.apiKey` ENC1:-ciphertext az elsődleges source).

**Tech Stack:**
- React 18 + TypeScript + tRPC v11 client (auto-typed procedures from `AppRouter`)
- shadcn/ui (`Card`, `Badge`, `Skeleton`, `Tabs`) — mind már importált a target fájlokban
- lucide-react (`CheckCircle2`, `AlertTriangle`, `HelpCircle`, `ArrowRight` — új import-ok)
- react-i18next (`useTranslation` hook, meglévő minta a `ResearchReport.tsx`-en)
- Tailwind CSS + meglévő `cn(...)` utility
- `gcloud` CLI (P1 Secret Manager bootstrap)
- Zod 4 (`SynthesisSchema` kibővítése már PR #13-ban megtörtént; ebben a sprintben nem nyúlunk hozzá)
- Vitest (backend only — **frontend RTL out-of-scope**, lásd spec §5.2)

**Scope (in this sprint):**
- P1: 3 API key (`gemini-api-key`, `anthropic-api-key`, `openai-api-key`) Google Secret Manager-be + `deploy-staging.yml` `--set-secrets` binding
- P2: `server/ai/pipeline-phases.ts` `runPhase4Stream` synthesis user prompt additív bővítés 5-dimension × 3-anchor scoring rubric blokkal
- 4 decision panel (`DecisionContextBlock` komponens) a `ResearchReport.tsx` radar alatti területén
- 5 dimension chip + "Mind" chip a meglévő Források tab-on, client-side filter
- HU + EN i18n kulcsok (`report.decision.*` + `report.sources.dimensionChips.*`)
- Staging smoke §5.3 minden pont
- 1 új backend unit teszt (`pipeline-phases.test.ts`) a rubric prompt substring-re

**Scope (NOT in this sprint):**
- Frontend unit/integration tesztek (spec §5.2: RTL infrastruktúra hiány miatt post-beta backlog)
- Új navigáció / tab struktúra (option b/c a spec-ben)
- `DecisionEngine` / `VerdictPolicy` osztályok (refaktor doksi Sprint 4+)
- Survey → evidence ingestion, `validation.recompute` endpoint (post-beta)
- Google/Facebook/LinkedIn OAuth (Sprint 2)
- Stripe + Számlázz.hu (Sprint 3)
- Legal oldalak, Sentry, analytics, transactional email (Sprint 2-3)
- Prod Cloud Run env + custom domain + SSL (Sprint 3)
- Visszamenőleges snapshot generálás régi research-ekre (explicit fallback marad)

---

## Pre-work: Worktree + branch setup

A Sprint 1 a `main` branchről indul, a repo root:

```bash
cd /Users/balintkovacs/Work/ClaudeCode/Research_App/repo-c1-ai-pipeline
git checkout main
git pull origin main
git checkout -b feat/sprint1-demo-quality-product
```

**Working directory for all commands:** `/Users/balintkovacs/Work/ClaudeCode/Research_App/repo-c1-ai-pipeline`. Ha a shell resetelődik, prefix `cd /Users/balintkovacs/Work/ClaudeCode/Research_App/repo-c1-ai-pipeline && `.

A `.env.local` a worktree-ben tartalmazza a 3 AI provider kulcsot + `MASTER_ENCRYPTION_KEY`-t + `PORT=4000`-t (Infra sprint closeout óta). A `node_modules` install-ban.

---

## ⚠️ Preflight safety notes — READ BEFORE ANY IMPLEMENTATION

Non-negotiable szabályok. Ha egy task step ezzel ütközik, ezek nyernek:

1. **Use `corepack pnpm`, never `pnpm` or `npm`.** A `package.json` `packageManager` field pinneli a verziót, corepack auto-aktivál. Ha helyi shell nem ismeri, `corepack enable` első.

2. **`server/_core/oauth.ts` + `server/routers.ts` auth/billing szekció — DO NOT MODIFY.** Sprint 1 nem nyúl auth-hoz, billing-hez, synthesis pipeline architektúrához. Ha egy step-hez mégis kelleni látszik → STOP és kérdezz.

3. **Meglévő `SynthesisSchema` nem változik.** A P2 munka kizárólag a **prompt-ba** tesz új blokkot (`server/ai/pipeline-phases.ts` `runPhase4Stream`). A `server/ai/schemas.ts` a PR #13-ban landolt bővített schema-val marad, ahhoz nem nyúlunk.

4. **`master-encryption-key` + `database-url` + `jwt-secret` + `dev-login-key` Secret Manager entry-khez nem nyúlunk.** A 3 új AI key entry additív. A meglévők regenerálása tilos (C2b `ENC1:` rows elvesznek).

5. **Triple-gate dev-login maradjon érintetlen.** A `registerDevLoginIfEnabled` + `ENABLE_DEV_LOGIN` + `DEV_LOGIN_KEY` flow (Infra sprint eredmény) változatlan. Auth migráció Sprint 2 scope.

6. **Régi research backward compat**: a Task 4+ minden commit után **manuális smoke** egy pre-PR #13 research ID-n (staging DB-n: `researchId=1`, `2`, vagy `3`, ha léteznek). Ha valamelyik régi research layout shift-elne vagy error toast-ot dobna → revert + debug mielőtt continue.

7. **`validation.getSnapshot` NOT_FOUND kezelés**: ez **NEM ERROR**, hanem expected state. A tRPC hook `isError` helyett `data === undefined` + `error.data?.code === "NOT_FOUND"` pattern-nel kell checkelni. Tanácsos a tRPC options-ben `retry: false` régi research-re, hogy ne rázzon 3 próbával a UI.

8. **Mobile viewport smoke kötelező Task 5 és Task 6 után.** Chrome DevTools 375×667 iPhone SE viewport. Layout shift vagy overflow → fix, nem "látogat post-launch".

9. **i18n kulcs hiány = runtime warning, nem error.** De a DoD pont 3 ("HU + EN i18n-aware") requires both files updated **synchronously** — sosem commit-olunk csak egy nyelvet. Minden i18n add egy commit-ban mindkét oldalra megy.

10. **P1 smoke verify**: a 3 API key `gcloud secrets create` után **per-secret curl-lel** ellenőrizni a staging Cloud Run-on keresztül, NEM mindhármat egyszerre. Ha mondjuk a Gemini key rossz formátumú, izolálható a baj. (Spec §11 kockázat.)

---

## File Structure

**Új fájlok:**
- `client/src/components/decision/DecisionContextBlock.tsx` — 4 panel grid container + data wiring
- `client/src/components/decision/DecisionPanel.tsx` — egy panel reusable komponens (icon + title + bullet list + empty state)
- `client/src/components/decision/DimensionChips.tsx` — dimension chip row a Források tab-ra
- `server/ai/__scripts__/smoke-synthesis-cp2.sh` — CP2 fixture rerun script (P2 verifikáció, `RUN_LIVE_AI=1` gated)

**Módosított fájlok:**
- `.github/workflows/deploy-staging.yml` — `--set-secrets` 3 új binding
- `server/ai/pipeline-phases.ts` — `runPhase4Stream` user prompt additív blokk (5-dim × 3-anchor rubric)
- `server/ai/pipeline-phases.test.ts` — 1 új unit test (rubric prompt substring check)
- `client/src/pages/ResearchReport.tsx` — import-ok + `DecisionContextBlock` + `DimensionChips` wiring
- `client/src/i18n/hu.ts` — új `report.decision.*` + `report.sources.dimensionChips.*` block
- `client/src/i18n/en.ts` — ugyanaz EN fordítással

**Külső változás (nem kód):**
- Google Cloud Secret Manager: 3 új secret (`gemini-api-key`, `anthropic-api-key`, `openai-api-key`)

---

## Task 1 — Discovery + 1-page plan (Nap 1)

**Cél:** hard evidence gyűjtés a Task 2+ lépések pontosításához + user plan approval gate.

**Files:**
- Create: (transient) notes file or markdown summary
- Read only: `client/src/pages/ResearchReport.tsx`, `client/src/i18n/{hu,en}/index.ts`, `server/ai/pipeline-phases.ts`, `.github/workflows/deploy-staging.yml`

- [ ] **Step 1.1: `file-reader` subagent (Haiku) kódbázis exploration**

Dispatch a Haiku `file-reader` subagent (already exists in `.claude/agents/file-reader.md` from Infra sprint):

```
subagent_type: file-reader
prompt: |
  Read and summarize these files — report structure, key functions, exports, patterns:
  1. /Users/balintkovacs/Work/ClaudeCode/Research_App/repo-c1-ai-pipeline/client/src/pages/ResearchReport.tsx
     — especially: Tabs structure line range, where the radar renders (CardContent), where "sources" TabsContent is
  2. /Users/balintkovacs/Work/ClaudeCode/Research_App/repo-c1-ai-pipeline/client/src/i18n/hu.ts
     — structure of `report.*` block, where `report.sources` key is (line)
  3. /Users/balintkovacs/Work/ClaudeCode/Research_App/repo-c1-ai-pipeline/client/src/i18n/en.ts
     — same structure, confirm key-parity with hu.ts
  4. /Users/balintkovacs/Work/ClaudeCode/Research_App/repo-c1-ai-pipeline/server/ai/pipeline-phases.ts
     — where runPhase4Stream is defined (line), where the user prompt is built (template literal?), what the existing "positiveDrivers/negativeDrivers" prompt block looks like
  5. /Users/balintkovacs/Work/ClaudeCode/Research_App/repo-c1-ai-pipeline/.github/workflows/deploy-staging.yml
     — existing --set-secrets line exact format

  Report: one section per file, line numbers for key anchors, under 300 words total.
  Do NOT modify anything.
```

- [ ] **Step 1.2: Write 1-page plan (inline in this session)**

Based on subagent output, write a concrete 1-page plan inline covering:
- Exact file:line anchors for ResearchReport.tsx where `DecisionContextBlock` will mount
- Exact format of existing `--set-secrets` in deploy-staging.yml (3 new entries follow the same format)
- Exact position of the synthesis prompt additive block (append after existing "positiveDrivers/negativeDrivers" directive, before the "Return valid JSON" closing instruction)
- Any discovered constraint surprise — if found, STOP and propose how to handle

- [ ] **Step 1.3: User approval gate**

STOP. Post the 1-page plan to the user and wait for explicit approval before starting Task 2. If the user flags an issue, revise the plan before proceeding.

- [ ] **Step 1.4: Commit (empty — spec/plan reference only)**

No commit for Task 1 (discovery-only, no code).

---

## Task 2 — P1: Staging Secret Manager + workflow binding (Nap 2)

**Cél:** 3 AI API key Google Secret Manager-ben, bekötve `deploy-staging.yml`-be, staging deploy fut, key-ek elérhetők a runtime-on.

**Files:**
- Modify: `.github/workflows/deploy-staging.yml` (line ~48, `--set-secrets` bővítés)
- External: Google Cloud Secret Manager (3 új secret)

- [ ] **Step 2.1: Verify gcloud auth + project context**

```bash
gcloud auth list
gcloud config get-value project
```

Expected: aktív user a staging projecthez, `project` értéke a staging project ID (Infra sprint record-ban: `docs/deployment/gcp-bootstrap-record-2026-04-20.md`). Ha nem match, `gcloud config set project <id>` vagy `gcloud auth login`.

- [ ] **Step 2.2: Create 3 Secret Manager entries (empty)**

```bash
# Frankfurt region — match infra sprint setup
REGION=europe-west3

for SECRET in gemini-api-key anthropic-api-key openai-api-key; do
  gcloud secrets create "$SECRET" \
    --replication-policy=user-managed \
    --locations="$REGION" || echo "$SECRET already exists, skipping"
done

gcloud secrets list --filter="name~(gemini-api-key|anthropic-api-key|openai-api-key)"
```

Expected: 3 secret listázódik. (Ha már léteznek, `already exists` OK.)

- [ ] **Step 2.3: Add secret version with the actual API key (1 per secret)**

The actual API keys live in the `.env.local` (Infra sprint), **per-key, one at a time**:

```bash
# Gemini
printf "%s" "$(grep '^GEMINI_API_KEY=' .env.local | cut -d= -f2-)" \
  | gcloud secrets versions add gemini-api-key --data-file=-

# Anthropic
printf "%s" "$(grep '^ANTHROPIC_API_KEY=' .env.local | cut -d= -f2-)" \
  | gcloud secrets versions add anthropic-api-key --data-file=-

# OpenAI
printf "%s" "$(grep '^OPENAI_API_KEY=' .env.local | cut -d= -f2-)" \
  | gcloud secrets versions add openai-api-key --data-file=-
```

**CRITICAL: `printf "%s"` not `echo`** — no trailing newline, otherwise the key is 1 byte too long and all subsequent API calls fail with opaque errors (spec §11 risk).

- [ ] **Step 2.4: Grant runtime service account `secretAccessor` role**

```bash
# Find the runtime service account from infra sprint setup
RUNTIME_SA="cloud-run-runtime-sa@$(gcloud config get-value project).iam.gserviceaccount.com"

for SECRET in gemini-api-key anthropic-api-key openai-api-key; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:$RUNTIME_SA" \
    --role="roles/secretmanager.secretAccessor"
done
```

Verify:

```bash
gcloud secrets get-iam-policy gemini-api-key
```

Expected: output shows `secretmanager.secretAccessor` binding to `cloud-run-runtime-sa@…`.

- [ ] **Step 2.5: Modify `.github/workflows/deploy-staging.yml` — append 3 secret bindings**

Open the file, locate the `--set-secrets` line (approx line 48 — exact line number confirmed in Task 1.1 Step output). The existing line ends with something like:

```yaml
--set-secrets=MASTER_ENCRYPTION_KEY=master-encryption-key:latest,DATABASE_URL=database-url:latest,JWT_SECRET=jwt-secret:latest,DEV_LOGIN_KEY=dev-login-key:latest
```

Append 3 new bindings **at the end, comma-separated**:

```yaml
--set-secrets=MASTER_ENCRYPTION_KEY=master-encryption-key:latest,DATABASE_URL=database-url:latest,JWT_SECRET=jwt-secret:latest,DEV_LOGIN_KEY=dev-login-key:latest,GEMINI_API_KEY=gemini-api-key:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest,OPENAI_API_KEY=openai-api-key:latest
```

**Exact env var names must match**: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (match what `server/ai/*` reads via `process.env.*` — verified in Task 1.1).

- [ ] **Step 2.6: Commit workflow change**

```bash
git add .github/workflows/deploy-staging.yml
git commit -m "chore(deploy): bind Gemini/Anthropic/OpenAI API keys from Secret Manager on staging"
```

- [ ] **Step 2.7: Push branch and trigger staging deploy**

```bash
git push -u origin feat/sprint1-demo-quality-product
```

Monitor the GitHub Actions run for `deploy-staging.yml`. Expected: green run, new revision deployed.

- [ ] **Step 2.8: Staging smoke — verify key availability**

Two verification paths:

**(a) Via Cloud Run direct check (runtime env):**
```bash
gcloud run services describe research-app-staging \
  --region=europe-west3 \
  --format="value(spec.template.spec.containers[0].env)"
```

Expected: output lists `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` as secret references (not plaintext values).

**(b) Via functional smoke** — one 3-phase staging research:

Follow the staging smoke procedure from `server/ai/__scripts__/smoke-staging-cp3.sh` (from PR #13). Expected: Phase 1 (Gemini Wide Scan) completes without `No API key configured for provider: gemini` error. If Phase 1 succeeds → P1 green.

- [ ] **Step 2.9: If any key fails, isolate and debug**

Per-provider failure: test each key in isolation via a minimal staging admin AI test request (Admin Panel "Test Provider" button — spec §11). Re-check `printf "%s"` in Step 2.3 if the key format looks mangled.

- [ ] **Step 2.10: DoD #1 mark green in plan**

Check DoD §6 point 1 as green in session notes. Proceed to Task 3.

---

## Task 3 — P2: Synthesis scoring rubric prompt bővítés (Nap 3)

**Cél:** `runPhase4Stream` synthesis prompt kiegészül 5 dimension × 3 anchor scoring rubric blokkal. A meglévő `clampSynthesisOutput` + `clamp10()` unchanged.

**Files:**
- Modify: `server/ai/pipeline-phases.ts` (exact line range: Task 1.1 Step output)
- Modify: `server/ai/pipeline-phases.test.ts` (1 new test)
- Create: `server/ai/__scripts__/smoke-synthesis-cp2.sh`

- [ ] **Step 3.1: Write the failing test**

Open `server/ai/pipeline-phases.test.ts`. Add a new describe block or extend the existing one:

```typescript
describe("runPhase4Stream synthesis prompt", () => {
  it("includes scoring rubric block with 5 dimensions and 3 anchor points each", () => {
    // Import the prompt builder or the constant — in Task 1.1 discovery confirm
    // the exact export surface. If prompt is inline, extract it to a top-level
    // const (minimal refactor, keep the existing function signature unchanged).
    const prompt = buildSynthesisPrompt(/* fixture inputs */);

    const dimensions = ["market_size", "competition", "feasibility", "monetization", "timeliness"];
    for (const dim of dimensions) {
      expect(prompt).toContain(dim);
    }

    // Anchor markers — we require lines like "9-10:", "5-6:", "1-2:" (at least 3 anchor hints)
    expect(prompt.match(/9-10:/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(prompt.match(/5-6:/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(prompt.match(/1-2:/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });
});
```

If `buildSynthesisPrompt` doesn't exist as an export, the minimal refactor is to extract the prompt template into a top-level `const SYNTHESIS_RUBRIC_BLOCK = \`...\`` and export it for the test. Don't change the calling function signature.

- [ ] **Step 3.2: Run test to verify it fails**

```bash
cd /Users/balintkovacs/Work/ClaudeCode/Research_App/repo-c1-ai-pipeline
corepack pnpm test server/ai/pipeline-phases.test.ts
```

Expected: **FAIL** — "does not contain market_size" or similar. This confirms the rubric is missing.

- [ ] **Step 3.3: Add the rubric block to the synthesis prompt**

In `server/ai/pipeline-phases.ts`, locate `runPhase4Stream` (line confirmed in Task 1.1). Find where the user prompt is built (template literal). **Append** the rubric block **after** the existing "positiveDrivers/negativeDrivers" directive and **before** the "Return valid JSON" closing instruction:

```typescript
const SYNTHESIS_RUBRIC_BLOCK = `
## Scoring rubric (0-10 per dimension)

Use the following anchors to score consistently. Do NOT default to 10 — calibrate against the evidence actually gathered in phases 1-3.

**market_size**
- 9-10: $1B+ TAM triangulated with ≥2 independent market studies and clear ICP count
- 5-6: plausible niche, numbers are hand-wavy or LLM-estimated without sources
- 1-2: no market evidence — only anecdote or speculation

**competition**
- 9-10: ≤3 direct competitors, all with clear weaknesses you documented; open pricing bands
- 5-6: crowded but differentiable; 5-15 competitors, some with moats
- 1-2: dominant incumbents with deep moats; no clear differentiation angle

**feasibility**
- 9-10: a small team can ship v1 in ≤3 months with off-the-shelf tech; no novel research
- 5-6: real engineering challenges but known patterns (ML, integrations, scale)
- 1-2: requires novel research, regulatory approval, or hardware that doesn't exist

**monetization**
- 9-10: target users already pay for comparable tools at clear price points
- 5-6: willingness-to-pay plausible, but requires signaling or primer validation
- 1-2: target users historically don't pay; free/ads-only models dominant

**timeliness**
- 9-10: macro trend demonstrably rising (adoption, regulation, tech unlock) in last 12mo
- 5-6: long-running stable demand; neither rising nor declining sharply
- 1-2: declining trend or counter-cyclical risk

Scores below 4 in any single dimension must be explicitly justified in the rationale.
`;

// Inside the prompt builder, append:
const userPrompt = `${existingPromptContent}${SYNTHESIS_RUBRIC_BLOCK}${closingInstruction}`;
```

**Export `SYNTHESIS_RUBRIC_BLOCK` or a `buildSynthesisPrompt()` function** so the test in Step 3.1 can import it.

- [ ] **Step 3.4: Run test to verify it passes**

```bash
corepack pnpm test server/ai/pipeline-phases.test.ts
```

Expected: **PASS**. All 5 dimension names present ≥1 time each, 9-10/5-6/1-2 anchors present ≥5 times each.

- [ ] **Step 3.5: Run the full test suite — no regressions**

```bash
corepack pnpm test
corepack pnpm check
```

Expected: **278+1 = 279 tests pass**, `tsc --noEmit` clean.

- [ ] **Step 3.6: Commit the rubric + test**

```bash
git add server/ai/pipeline-phases.ts server/ai/pipeline-phases.test.ts
git commit -m "feat(ai): add 5-dimension scoring rubric to synthesis prompt (P2)"
```

- [ ] **Step 3.7: Create CP2 fixture rerun script**

Create `server/ai/__scripts__/smoke-synthesis-cp2.sh`:

```bash
#!/usr/bin/env bash
# CP2 fixture rerun for P2 rubric verification
# Usage: RUN_LIVE_AI=1 ./server/ai/__scripts__/smoke-synthesis-cp2.sh
# Re-runs the 2 CP2 niches through the updated synthesis prompt
# and prints the new score variance per niche.

set -euo pipefail

if [[ "${RUN_LIVE_AI:-0}" != "1" ]]; then
  echo "ERROR: Set RUN_LIVE_AI=1 to run (AI costs ~\$1-2)"
  exit 1
fi

FIXTURE_DIR="server/ai/__fixtures__"
NICHES=(
  "beer-dumbbell-coach"
  "b2b-contract-reviewer-hu"
)

for NICHE in "${NICHES[@]}"; do
  FIXTURE="$FIXTURE_DIR/synthesis-output-$NICHE.json"
  if [[ ! -f "$FIXTURE" ]]; then
    echo "ERROR: fixture missing: $FIXTURE"
    exit 1
  fi

  echo "=== Rerunning: $NICHE ==="
  # Extract the niche prompt from fixture metadata
  NICHE_NAME=$(jq -r '.niche.nicheName' "$FIXTURE")
  NICHE_DESC=$(jq -r '.niche.description' "$FIXTURE")
  NICHE_STRATEGY=$(jq -r '.niche.strategy' "$FIXTURE")

  # Call the existing smoke-synthesis.ts helper (PR #13) with these inputs
  npx tsx server/ai/__scripts__/smoke-synthesis.ts \
    --niche="$NICHE_NAME" \
    --description="$NICHE_DESC" \
    --strategy="$NICHE_STRATEGY" \
    --output="/tmp/synthesis-rerun-$NICHE.json"

  # Compute score variance
  SCORES=$(jq -r '.synthesis.scores | to_entries | map(.value) | [min, max]' "/tmp/synthesis-rerun-$NICHE.json")
  echo "  Scores min/max: $SCORES"
  VARIANCE=$(echo "$SCORES" | jq 'max - .[0]')
  echo "  Variance: $VARIANCE"

  if (( $(echo "$VARIANCE < 3" | bc -l) )); then
    echo "  ⚠️  WARNING: variance < 3 for $NICHE — rubric may still be too flat"
  else
    echo "  ✅ variance >= 3 — rubric differentiates"
  fi
done
```

Make executable: `chmod +x server/ai/__scripts__/smoke-synthesis-cp2.sh`

**Note:** this script depends on `server/ai/__scripts__/smoke-synthesis.ts` (exists from PR #13 per closeout doc §2). If the flag names differ, Task 1.1 discovery should have confirmed the correct interface — adapt in Step 3.7 if needed.

- [ ] **Step 3.8: Run CP2 rerun — live AI**

```bash
RUN_LIVE_AI=1 ./server/ai/__scripts__/smoke-synthesis-cp2.sh
```

Expected: 2 niches processed, variance printed per niche.

- [ ] **Step 3.9: BUSINESS CHECKPOINT 1 — user review**

STOP. Post to user:
- The 2 niche output JSONs (tail of the synthesis section — scores + verdict + positiveDrivers + negativeDrivers)
- Variance per niche
- Your recommendation: **ship** (both variance >= 3) or **iterate** (one or both < 3)

Wait for explicit user decision. If user says "iterate" → modify rubric (more aggressive anchors, clearer low-end language), commit, rerun, re-post. Max 2 iterations — if still uniform, STOP and ask user for a business decision (ship with flat scores flagged, or extended prompt work as a new sub-task).

- [ ] **Step 3.10: Commit CP2 rerun script**

```bash
git add server/ai/__scripts__/smoke-synthesis-cp2.sh
git commit -m "test(ai): CP2 fixture rerun script for P2 rubric verification"
```

---

## Task 4 — i18n kulcsok HU + EN (Nap 4 — részlet)

**Cél:** minden új `report.decision.*` és `report.sources.dimensionChips.*` kulcs létezik HU + EN oldalon, azonos szerkezettel.

**Files:**
- Modify: `client/src/i18n/hu.ts` (append to `report:` block)
- Modify: `client/src/i18n/en.ts` (append to `report:` block, same key structure)

- [ ] **Step 4.1: Bővítsd `hu.ts` `report:` blokkját a `sources:` key után**

Nyisd meg `client/src/i18n/hu.ts`, a `report:` blokkon belül keresd meg a `sources: "Forráskönyvtár",` sort (line ~109 per Task 1.1). A `sources:` helyett strukturált objektumot teszünk:

```typescript
sources: {
  title: "Forráskönyvtár",
  dimensionChips: {
    all: "Mind",
    marketSize: "Piaci méret",
    competition: "Verseny",
    feasibility: "Megvalósíthatóság",
    monetization: "Monetizáció",
    timeliness: "Időszerűség",
  },
},
```

⚠️ Ez **breaking change** a meglévő `t("report.sources")` call-site-oknak. Keresd meg:

```bash
corepack pnpm exec grep -rn '"report.sources"' client/src/
```

Minden találatot **updatelj** `"report.sources.title"`-re. A `ResearchReport.tsx` line ~305 (`<TabsTrigger value="sources">{t("report.sources")}</TabsTrigger>`) → `t("report.sources.title")`.

**Alternatív, kevésbé invazív megoldás**: hagyd `sources: "Forráskönyvtár"` stringet, és add külön top-level kulcsként:

```typescript
sourcesTitle: "Forráskönyvtár", // marad, ha használatos
sourceDimensions: {
  all: "Mind",
  marketSize: "Piaci méret",
  competition: "Verseny",
  feasibility: "Megvalósíthatóság",
  monetization: "Monetizáció",
  timeliness: "Időszerűség",
},
```

**Választás**: ha <3 find találat a grep-ben, csináld a struktúrált objektum verziót (tisztább). Ha >3, csináld az alternatív separate-key verziót.

- [ ] **Step 4.2: Add `decision:` block to `hu.ts` `report:`**

Ugyanabban a `report:` blokkban, az új chipek előtt/után add:

```typescript
decision: {
  positiveDrivers: {
    title: "Mi húzta fel a score-t",
    empty: "Nincs azonosított pozitív driver",
  },
  negativeDrivers: {
    title: "Mi húzta le",
    empty: "Nincs azonosított negatív driver",
  },
  missingEvidence: {
    title: "Mi hiányzik még",
    empty: "Nincs azonosított bizonyítékhiány",
  },
  nextActions: {
    title: "Következő lépések",
    empty: "Nincs javasolt akció",
  },
},
```

- [ ] **Step 4.3: Mirror EN in `en.ts`**

```typescript
decision: {
  positiveDrivers: {
    title: "What boosted the score",
    empty: "No positive drivers identified",
  },
  negativeDrivers: {
    title: "What weakened it",
    empty: "No negative drivers identified",
  },
  missingEvidence: {
    title: "Missing evidence",
    empty: "No evidence gaps identified",
  },
  nextActions: {
    title: "Next actions",
    empty: "No suggested actions",
  },
},
```

Plus the `sources` / `sourceDimensions` update matching the HU choice in Step 4.1.

- [ ] **Step 4.4: Verify i18n key parity**

```bash
corepack pnpm check
```

Expected: TypeScript passes. If the type of `hu` and `en` diverge (i18next infers from `hu`, ensures parity), tsc catches it.

Manual visual diff:

```bash
diff <(grep -E "^\s+[a-z]" client/src/i18n/hu.ts | sort) \
     <(grep -E "^\s+[a-z]" client/src/i18n/en.ts | sort)
```

Expected: empty output or only value differences (not key differences).

- [ ] **Step 4.5: Commit i18n changes**

```bash
git add client/src/i18n/hu.ts client/src/i18n/en.ts
# also any file where t("report.sources") call-sites were updated
git add client/src/pages/ResearchReport.tsx
git commit -m "feat(i18n): add report.decision.* + source dimension chip labels (HU+EN)"
```

---

## Task 5 — Decision panel components (Nap 4)

**Cél:** `DecisionContextBlock` + `DecisionPanel` komponensek, 4 panel 2×2 grid-ben a `ResearchReport.tsx` radar alatt.

**Files:**
- Create: `client/src/components/decision/DecisionContextBlock.tsx`
- Create: `client/src/components/decision/DecisionPanel.tsx`
- Modify: `client/src/pages/ResearchReport.tsx` (import + mount point)

- [ ] **Step 5.1: Create `DecisionPanel.tsx`**

```typescript
// client/src/components/decision/DecisionPanel.tsx
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type DecisionPanelTone = "positive" | "negative" | "warning" | "info";

const TONE_STYLES: Record<DecisionPanelTone, { border: string; iconColor: string }> = {
  positive: { border: "border-green-200 dark:border-green-900", iconColor: "text-green-600 dark:text-green-400" },
  negative: { border: "border-red-200 dark:border-red-900", iconColor: "text-red-600 dark:text-red-400" },
  warning: { border: "border-yellow-200 dark:border-yellow-900", iconColor: "text-yellow-600 dark:text-yellow-400" },
  info: { border: "border-blue-200 dark:border-blue-900", iconColor: "text-blue-600 dark:text-blue-400" },
};

type Props = {
  title: string;
  items: string[];
  emptyText: string;
  tone: DecisionPanelTone;
  icon: LucideIcon;
  numbered?: boolean;
};

export function DecisionPanel({ title, items, emptyText, tone, icon: Icon, numbered = false }: Props) {
  const toneStyle = TONE_STYLES[tone];
  return (
    <Card className={cn("h-full", toneStyle.border)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Icon className={cn("h-4 w-4", toneStyle.iconColor)} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">{emptyText}</p>
        ) : numbered ? (
          <ol className="list-decimal list-inside space-y-1 text-sm">
            {items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ol>
        ) : (
          <ul className="list-disc list-inside space-y-1 text-sm">
            {items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5.2: Create `DecisionContextBlock.tsx`**

```typescript
// client/src/components/decision/DecisionContextBlock.tsx
import { useTranslation } from "react-i18next";
import { CheckCircle2, AlertTriangle, HelpCircle, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { DecisionPanel } from "./DecisionPanel";

type Props = { researchId: number };

export function DecisionContextBlock({ researchId }: Props) {
  const { t } = useTranslation();
  const query = trpc.validation.getSnapshot.useQuery(
    { researchId },
    {
      retry: false,                    // NOT_FOUND is expected, don't retry
      refetchOnWindowFocus: false,
    }
  );

  // Fallback: régi research (NOT_FOUND) → render nothing
  if (query.error?.data?.code === "NOT_FOUND") {
    return null;
  }

  // Loading: skeleton grid
  if (query.isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  // Other errors: silent fallback
  if (query.error || !query.data) {
    if (import.meta.env.DEV && query.error) {
      console.error("DecisionContextBlock error:", query.error);
    }
    return null;
  }

  const snapshot = query.data;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      <DecisionPanel
        title={t("report.decision.positiveDrivers.title")}
        items={snapshot.positiveDrivers ?? []}
        emptyText={t("report.decision.positiveDrivers.empty")}
        tone="positive"
        icon={CheckCircle2}
      />
      <DecisionPanel
        title={t("report.decision.negativeDrivers.title")}
        items={snapshot.negativeDrivers ?? []}
        emptyText={t("report.decision.negativeDrivers.empty")}
        tone="negative"
        icon={AlertTriangle}
      />
      <DecisionPanel
        title={t("report.decision.missingEvidence.title")}
        items={snapshot.missingEvidence ?? []}
        emptyText={t("report.decision.missingEvidence.empty")}
        tone="warning"
        icon={HelpCircle}
      />
      <DecisionPanel
        title={t("report.decision.nextActions.title")}
        items={snapshot.nextActions ?? []}
        emptyText={t("report.decision.nextActions.empty")}
        tone="info"
        icon={ArrowRight}
        numbered
      />
    </div>
  );
}
```

- [ ] **Step 5.3: Mount in `ResearchReport.tsx`**

Nyisd meg `client/src/pages/ResearchReport.tsx`. A Task 1.1 discovery konfirmálta a radar `CardContent` + Tabs közti pontos beiktatási pontot. Add hozzá az import-ot a fájl tetején:

```typescript
import { DecisionContextBlock } from "@/components/decision/DecisionContextBlock";
```

A radar `Card` záró `</Card>` és a `<Tabs>` nyitó tag közé (line ~300 környékén, pontos sor Task 1.1-ből):

```tsx
{/* existing radar Card closes here */}
</Card>

{/* NEW: Decision context block */}
<DecisionContextBlock researchId={report.id} />

{/* existing Tabs starts here */}
<Tabs defaultValue="report">
```

A `report.id` field a research tRPC response-ban található — ha a report mező neve más (pl. `report.researchId` vagy `data.researchId`), Task 1.1 discovery output-jából vegyük a pontos nevet.

- [ ] **Step 5.4: `tsc --noEmit`**

```bash
corepack pnpm check
```

Expected: 0 error. Ha type error jön (pl. `snapshot.positiveDrivers` nem létezik a tRPC type-on), akkor a `validation.router.ts` return type-ja nem tartalmazza ezeket a mezőket. Ebben az esetben ellenőrizzük a `validation.router.ts` `getSnapshot` Zod output schema-ját a server oldalon (PR #13-ban landolt).

- [ ] **Step 5.5: Dev server manual smoke**

```bash
cp .env.local.example .env.local 2>/dev/null || true  # already exists
corepack pnpm dev
```

Nyiss egy browser tab-ot `http://localhost:4000/` URL-re. Loggolj be dev-login-nel (Infra sprint doku). Lépj be Dashboard → egy kész research (új, post-PR #13) → ResearchReport.

**Manual checks:**
- 4 panel renderelődik a radar alatt, 2×2 grid-ben
- Szövegek HU-ul (alapértelmezett) — "Mi húzta fel a score-t" etc.
- Language toggle (ha van UI-n, ha nem, kézzel: `localStorage.setItem("lang", "en"); location.reload();`) — szövegek EN-re váltanak
- DevTools → Responsive → iPhone SE (375×667) → 4 panel 1 oszlopban, nem overflow-zik

**Fallback smoke (régi research, ha van pre-PR #13 a dev DB-n):**
- Nyiss meg egy pre-PR #13 research-et → 4 panel **nem renderelődik**, layout pixel-identikus a korábbihoz
- Console: **NINCS error** prod módban; dev módban 1 soros `console.error` OK (NOT_FOUND fallback-ből)

- [ ] **Step 5.6: Commit panel components + ResearchReport wiring**

```bash
git add client/src/components/decision/ client/src/pages/ResearchReport.tsx
git commit -m "feat(report): add DecisionContextBlock with 4 panels (positiveDrivers, negativeDrivers, missingEvidence, nextActions)"
```

---

## Task 6 — Dimension chips on Források tab (Nap 5)

**Cél:** 5 dimension chip + "Mind" chip a Források tab-on, client-side filter a forráslistán, lazy-load evidence endpoint.

**Files:**
- Create: `client/src/components/decision/DimensionChips.tsx`
- Modify: `client/src/pages/ResearchReport.tsx` (Források TabsContent bővítése)

- [ ] **Step 6.1: Create `DimensionChips.tsx`**

```typescript
// client/src/components/decision/DimensionChips.tsx
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Dimension = "all" | "market_size" | "competition" | "feasibility" | "monetization" | "timeliness";

type Props = {
  selected: Dimension;
  onSelect: (dim: Dimension) => void;
  disabled?: boolean;
};

const DIMENSIONS: Array<{ key: Dimension; i18nKey: string }> = [
  { key: "all", i18nKey: "report.sourceDimensions.all" },
  { key: "market_size", i18nKey: "report.sourceDimensions.marketSize" },
  { key: "competition", i18nKey: "report.sourceDimensions.competition" },
  { key: "feasibility", i18nKey: "report.sourceDimensions.feasibility" },
  { key: "monetization", i18nKey: "report.sourceDimensions.monetization" },
  { key: "timeliness", i18nKey: "report.sourceDimensions.timeliness" },
];

export function DimensionChips({ selected, onSelect, disabled = false }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {DIMENSIONS.map(({ key, i18nKey }) => (
        <Badge
          key={key}
          variant={selected === key ? "default" : "outline"}
          className={cn(
            "cursor-pointer select-none",
            disabled && "opacity-50 cursor-not-allowed pointer-events-none"
          )}
          onClick={() => !disabled && onSelect(key)}
        >
          {t(i18nKey)}
        </Badge>
      ))}
    </div>
  );
}
```

⚠️ Ha Step 4.1-ben az **első variánst** választottuk (`sources` → `sources.title` + `sources.dimensionChips.*`), akkor az i18n kulcs `report.sources.dimensionChips.*`. Adjust the `DIMENSIONS` array accordingly. A fenti példa az **alternatív** (`sourceDimensions`) struktúrát feltételezi.

- [ ] **Step 6.2: Integrate into `ResearchReport.tsx` "sources" TabsContent**

A `TabsContent value="sources"` blokkba (line ~324+ per Task 1.1), a forráslista elé:

```tsx
import { DimensionChips } from "@/components/decision/DimensionChips";
import { useState } from "react";

// Inside ResearchReport component body:
const [activeTab, setActiveTab] = useState("report");
const [selectedDimension, setSelectedDimension] = useState<Dimension>("all");

const evidenceBuckets = trpc.validation.getEvidenceByDimension.useQuery(
  { researchId: report.id },
  { enabled: activeTab === "sources", retry: false }
);

// In JSX:
<Tabs value={activeTab} onValueChange={setActiveTab} defaultValue="report">
  {/* existing TabsTrigger */}
  <TabsContent value="sources">
    {!evidenceBuckets.isError && (
      <DimensionChips
        selected={selectedDimension}
        onSelect={setSelectedDimension}
        disabled={evidenceBuckets.isLoading}
      />
    )}

    {/* Filtered source list */}
    {renderFilteredSources(report.sources, evidenceBuckets.data, selectedDimension)}
  </TabsContent>
</Tabs>
```

A `renderFilteredSources` helper a meglévő source render logic mellé:

```typescript
function renderFilteredSources(
  allSources: typeof report.sources,
  buckets: typeof evidenceBuckets.data,
  selected: Dimension
) {
  if (selected === "all" || !buckets) {
    return renderSourceList(allSources);  // existing render function
  }
  const bucketed = buckets[selected] ?? [];
  // Map Evidence[] → Source[] via sourceUrl match, or render as-is
  const urlSet = new Set(bucketed.map((e) => e.sourceUrl).filter(Boolean));
  const filtered = allSources.filter((s) => urlSet.has(s.url));
  return renderSourceList(filtered);
}
```

**If `web_source` evidence records don't have source URLs consistently matching `report.sources` entries** (possible, per closeout doc §8 "web_source evidence has dimensions=[]"), the filter for non-"all" chips will be empty. This is expected: the "Mind" chip shows everything, per-dimension chips show only `synthesis_claim` evidences (which usually don't have URLs, so the filter returns 0). To handle gracefully:

- If `selected !== "all"` and `filtered.length === 0` → render a "no sources tagged for this dimension yet" empty state (i18n-aware)

- [ ] **Step 6.3: Fallback for evidence endpoint error**

Ha `evidenceBuckets.isError`:
- `DimensionChips` **nem renderelődik** (a Step 6.2 `{!evidenceBuckets.isError && ...}` guardol)
- A source list a teljes `report.sources` array-ből megy (`selectedDimension` implicit "all")
- Dev: `console.error(evidenceBuckets.error)`; prod: silent

- [ ] **Step 6.4: `tsc --noEmit`**

```bash
corepack pnpm check
```

Expected: 0 error. A `trpc.validation.getEvidenceByDimension` return type-nak léteznie kell (PR #13 auto-export).

- [ ] **Step 6.5: Dev server manual smoke**

```bash
corepack pnpm dev
```

- Nyiss egy új research-et → Források tab click → chipek megjelennek
- Chip click: source list szűkül (vagy empty state-et mutat a non-"all" chipekre, ha a filter 0 találatot ad)
- Network tab: `validation.getEvidenceByDimension` **csak** a Források tab első aktiválásakor fut (lazy load verify)
- Régi research → Források tab → chipek **nem** jelennek meg (NOT_FOUND error), forráslista a régi módon render
- Mobile viewport (375px): chipek wrap-elnek több sorba, nincs horizontal overflow

- [ ] **Step 6.6: Commit dimension chips**

```bash
git add client/src/components/decision/DimensionChips.tsx client/src/pages/ResearchReport.tsx
git commit -m "feat(report): add dimension chip filter to Sources tab"
```

---

## Task 7 — Staging deploy + smoke (Nap 6)

**Cél:** a feat branch merge vagy staging deploy-ra push, staging env-en DoD §6 mind a 7 pont verifikálva.

**Files:**
- No code changes (staging smoke)

- [ ] **Step 7.1: Merge main, resolve conflicts if any**

```bash
git fetch origin main
git merge origin/main
```

Ha conflict van: resolve (a plan minimális surface area miatt valószínűtlen). Re-run `corepack pnpm check` + `corepack pnpm test` a merge után.

- [ ] **Step 7.2: Push and trigger staging deploy**

```bash
git push origin feat/sprint1-demo-quality-product
```

Ha a branch már pushed volt, ez csak új commit-okat kényszerít. Deploy workflow fut automatikusan (main-re nem, csak branch-re? — ha branch-re nincs auto-deploy, akkor **PR nyitás az auto-triggerhez, vagy manual workflow_dispatch**).

Monitor: GitHub Actions → `deploy-staging.yml` zöld.

- [ ] **Step 7.3: Staging smoke — pont 1 (új HU research 4 panellel)**

Browser → staging URL (Cloud Run `*.run.app` domain, IAM-gated, `gcloud auth print-identity-token` header vagy dev-login cookie). 

Jelentkezz be, indíts új research magyar prompt-tal (pl. "Egy niche coaching app ötlete 40+ nők számára, akik fitness után vannak, de még erősíteni akarnak"). Várj, amíg a 4 fázis lefut (~2-3 perc).

Expected:
- 4 panel megjelenik a radar alatt, HU szövegekkel
- Minden panelen valós bullet-ek (nem üres state)
- Verdict + score differenciál (P2 rubric works)

- [ ] **Step 7.4: Staging smoke — pont 2 (új EN research)**

`localStorage.setItem("lang", "en"); location.reload();` vagy language toggle. Új research EN prompt-tal (pl. "SMB SaaS idea: AI-generated onboarding emails for e-commerce stores").

Expected: 4 panel EN szövegekkel, variance > 3 pont a score-okban.

- [ ] **Step 7.5: Staging smoke — pont 3 (régi research)**

Navigálj egy pre-PR #13 research-hez (staging DB-n, ha van — ha nincs, ez a check a local dev-re redukálódik). Expected: 4 panel **nem jelenik meg**, 3 tab változatlan, nincs layout shift, nincs error toast.

Ha a staging DB nem tartalmaz pre-PR #13 research-et → a DoD #4 bizonyítása: lokálisan egy dev DB-n a decision_snapshots tábla `DELETE`-jével szimulálható (egy research-ről).

- [ ] **Step 7.6: Staging smoke — pont 4 (dimension chipek)**

Az egyik új research-en Források tab → 5+1 chip → click végig → source list szűkül (vagy empty state non-"all"-nál). Network tab: csak 1x hívódik `validation.getEvidenceByDimension` amikor először váltasz a Források tab-ra.

- [ ] **Step 7.7: Staging smoke — pont 5 (mobile responsive)**

Chrome DevTools → 375×667 → ugyanaz a research oldal → 4 panel 1 oszlopban, chipek wrap-elnek, forráslista scrollol.

- [ ] **Step 7.8: Staging smoke — pont 6 (backend test suite + tsc)**

```bash
corepack pnpm test
corepack pnpm check
```

Expected: 279 pass (278 meglévő + 1 új rubric test), tsc clean.

- [ ] **Step 7.9: Staging smoke — pont 7 (parallel network calls verify)**

DevTools Network tab egy új research oldal refresh-nél. Filter: "validation". Expected: `getSnapshot` és `getEvidenceByDimension` (ha Források tab aktív) **párhuzamosan** indulnak, nem sorosan (time-waterfall összeillesztés). Ha sorosan mennek, probléma nincs (tRPC batch), de jelezd.

- [ ] **Step 7.10: BUSINESS CHECKPOINT 2 — user smoke review**

STOP. Post to user:
- 2 staging research URL (HU + EN), user maga menjen be, nézze a 4 panelt
- Screenshot a mobile viewport render-ről
- Nyilatkozat: mind a 7 DoD pont zöld vagy piros (pontonként)
- Ha bármi piros → bug fix round, újra Task 7.3+ vonatkozó pont

---

## Task 8 — Closeout + cost report (Nap 7)

**Cél:** closeout doc + cost-jelentés + PR nyitás (ha még nincs).

**Files:**
- Create: `docs/deployment/sprint1-demo-quality-closeout-2026-04-28.md` (vagy aktuális dátum)

- [ ] **Step 8.1: Write closeout doc**

Struktúra (minta: `docs/deployment/cp3-validation-workspace-closeout-2026-04-21.md`):

```markdown
# Sprint 1 Closeout — Demo-Quality Product (2026-04-28)

**Sprint:** Sprint 1 — Demo-Quality Product (spec 2026-04-22)
**Timebox:** 7 munkanap (actual: X nap)
**Executor:** Claude Code (...)
**Business reviewer:** Skillnaut CEO

## 1. Sprint outcome (executive summary)
[1 paragraph]

## 2. Delivered artifacts
[Table: Component | Files | Commits]

## 3. Definition of Done verification
[Table: DoD # | Evidence | Status]

## 4. Scope compliance
[Goals met §2.1 + Prohibitions honored §2.2]

## 5. Business reviewer checkpoint recap
[Checkpoint 1 P2 review + Checkpoint 2 staging smoke]

## 6. Cost report
[AI API cost + Coding cost + Total]

## 7. Post-sprint tickets spawned (if any)
[P3+ if anything surfaces]

## 8. Sprint 2 handoff
[What the next sprint starts with, Validation Workspace UI depends on]

## 9. Retrospective — what I learned
```

- [ ] **Step 8.2: PR create (if not yet pushed as PR)**

```bash
gh pr create --title "feat: Sprint 1 — Demo-Quality Product (Validation Workspace UI + P1/P2)" --body "$(cat <<'EOF'
## Summary

- P1: AI API keys (Gemini/Anthropic/OpenAI) in Secret Manager + bound to staging Cloud Run
- P2: Synthesis scoring rubric (5 dimensions × 3 anchor points) added to the synthesis prompt
- Validation Workspace UI (option a): 4 decision panels (positiveDrivers, negativeDrivers, missingEvidence, nextActions) + dimension chips on the Sources tab
- HU + EN i18n
- Staging smoke §5.3 all 7 DoD points green

Spec: docs/superpowers/specs/2026-04-22-sprint1-demo-quality-product-design.md
Plan: docs/superpowers/plans/2026-04-22-sprint1-demo-quality-product.md
Closeout: docs/deployment/sprint1-demo-quality-closeout-<date>.md

## Test plan

- [ ] `pnpm test` → 279 pass
- [ ] `pnpm check` → 0 error
- [ ] Staging smoke 7 points green (see closeout §3)
- [ ] Pre-PR #13 research still renders classic layout

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 8.3: Commit closeout doc**

```bash
git add docs/deployment/sprint1-demo-quality-closeout-*.md
git commit -m "docs: Sprint 1 closeout — demo-quality product"
git push
```

- [ ] **Step 8.4: BUSINESS CHECKPOINT 3 — final sign-off**

STOP. Post to user:
- PR link
- Closeout doc link
- Cost report numbers
- "Sprint 2 (public-ready shell) kickoff mehet?"

Wait for user approval before merging or starting Sprint 2.

---

## Plan summary

Tasks:
1. Discovery + plan (Nap 1, user gate)
2. P1 Secret Manager + workflow (Nap 2)
3. P2 synthesis rubric + CP2 rerun (Nap 3, user gate Step 3.9)
4. i18n (Nap 4 reggel)
5. Decision panels (Nap 4 délután)
6. Dimension chips (Nap 5)
7. Staging smoke + DoD (Nap 6, user gate Step 7.10)
8. Closeout (Nap 7, user gate Step 8.4)

Commits: ~6-8 commit, egy logical change per commit.

User gates (blocking): Task 1.3 (plan approval), Task 3.9 (P2 variance review), Task 7.10 (staging smoke sign-off), Task 8.4 (final).

Approx AI cost (spec §11 + infra sprint avg): ~$3-5 for Task 3.8 CP2 rerun (2 × ~$1) + Task 7.3-7.4 staging smokes (2 × ~$1). Coding cost (Sonnet 4.6 default): ~$3-5 for the sprint. Total ~$7-10.

---

## References

- Spec: [docs/superpowers/specs/2026-04-22-sprint1-demo-quality-product-design.md](../specs/2026-04-22-sprint1-demo-quality-product-design.md)
- PR #13 closeout (Validation Workspace backend foundation): [docs/deployment/cp3-validation-workspace-closeout-2026-04-21.md](../../deployment/cp3-validation-workspace-closeout-2026-04-21.md)
- Infra sprint spec (DB-first + Secret Manager pattern): [docs/superpowers/specs/2026-04-20-infra-foundation-staging-design.md](../specs/2026-04-20-infra-foundation-staging-design.md)
- Refaktor doksi (post-beta Sprint 4+, DO NOT implement in Sprint 1): `../../Deep Research app refaktor.md`
