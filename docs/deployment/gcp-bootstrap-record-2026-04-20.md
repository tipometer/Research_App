# GCP Bootstrap Record — 2026-04-20

**Executed by:** balint@skillnaut.co (local `gcloud` CLI).
**Branch:** `feat/infra-foundation-staging`.
**Plan reference:** Task 5 of `docs/superpowers/plans/2026-04-20-infra-foundation-staging.md`.

## Artifacts created

| Resource | Identifier | Notes |
|---|---|---|
| GCP Project | `deep-research-staging-20260420` | display name "Deep Research Staging", billing linked |
| Project Number | `827965293984` | shared via GitHub secret `GCP_PROJECT_NUMBER` |
| Billing account | `01EE30-739181-6AC3E2` ("My Billing Account") | linked, enabled |
| Enabled APIs | `run`, `artifactregistry`, `secretmanager`, `iamcredentials`, `sts`, `cloudbuild` | all `.googleapis.com` |
| Service account | `deploy-sa@deep-research-staging-20260420.iam.gserviceaccount.com` | roles: `run.admin`, `iam.serviceAccountUser`, `artifactregistry.writer`, `iam.workloadIdentityUser` (via principalSet) — **NO** Secret Manager role |
| Service account | `cloud-run-runtime-sa@deep-research-staging-20260420.iam.gserviceaccount.com` | impersonable by deploy-sa; per-secret `secretAccessor` added in Task 6 |
| WIF Pool | `github-pool` (global) | for GitHub Actions OIDC |
| WIF Provider | `github-provider` (OIDC) | issuer `https://token.actions.githubusercontent.com`, attribute-condition `assertion.repository=='tipometer/Research_App'` — repo-scoped guard |
| deploy-sa WIF principal | `principalSet://iam.googleapis.com/projects/827965293984/locations/global/workloadIdentityPools/github-pool/attribute.repository/tipometer/Research_App` | bound with `roles/iam.workloadIdentityUser` |
| Artifact Registry | `research-app-staging` (europe-west3, docker) | target for CI-built images |
| GitHub secret | `GCP_PROJECT_NUMBER=827965293984` (repo: `tipometer/Research_App`) | used by deploy-staging.yml WIF provider path |
| GitHub secret | `GCP_PROJECT_ID=deep-research-staging-20260420` | used by deploy-staging.yml env block |

## Strict least-privilege verification

`deploy-sa` project-level roles (verified via `gcloud projects get-iam-policy`):
- `roles/artifactregistry.writer`
- `roles/iam.serviceAccountUser`
- `roles/run.admin`

**NO `roles/secretmanager.*`** — intentional. Secret values are resolved by Cloud Run runtime SA at container start, not at deploy time.

## Transient IAM propagation note

During bootstrap, the fourth binding command (`deploy-sa` workloadIdentityUser on the repo-scoped principalSet) hit a transient `PERMISSION_DENIED` on `iam.serviceAccounts.setIamPolicy` despite Balint being the project owner. A `sleep 5` + retry succeeded. This is a known gcloud CLI quirk when IAM API calls race with recent SA creation; documented here so a future operator does not treat it as a config error.

## Deferred to later tasks

- **Task 6:** TiDB Serverless cluster + 4 Secret Manager secrets + per-secret IAM bindings for runtime SA and Balint user.
- **Task 10 (post-first-deploy):** grant `balint@skillnaut.co` `roles/run.invoker` on the Cloud Run service (cannot be done until the service exists).

## Re-runnability

All bootstrap commands are idempotent where possible (`projects create` / `services enable` / `iam create` / `add-iam-policy-binding` with same args). If re-run on an existing project, gcloud reports "already exists" and skips. The only state not re-runnable is the project *creation* itself (project ID is globally unique and, once created, cannot be recreated).

**Re-execution from scratch:** see spec §5.4 for the full command sequence with copy-paste-ready blocks.
