# First Deploy Record — 2026-04-20

**Plan reference:** Task 10 of `docs/superpowers/plans/2026-04-20-infra-foundation-staging.md`.
**Triggered by:** squash-merge of PR #7 (feat/infra-foundation-staging → main, merge commit `f49a6e9`) + automatic `push: main` trigger of `deploy-staging.yml`.

## Deploy outcome

| Metric | Value |
|---|---|
| GitHub Actions run | `24664959009` — https://github.com/tipometer/Research_App/actions/runs/24664959009 |
| Duration (build + push + deploy) | 2m 12s |
| Container image | `europe-west3-docker.pkg.dev/deep-research-staging-20260420/research-app-staging/app:f49a6e9...` |
| Cloud Run revision | `research-app-staging-00001-x4v` |
| Cloud Run URL (IAM-gated) | `https://research-app-staging-dk3zukidya-ey.a.run.app` |
| Revision state | `Ready True` |

## Post-deploy IAM grant

```
gcloud run services add-iam-policy-binding research-app-staging \
  --member="user:balint@skillnaut.co" \
  --role="roles/run.invoker" \
  --region=europe-west3 --project=deep-research-staging-20260420
```

Scope: single service `research-app-staging`, NOT project-wide. Only one member.

## Auth-gate verification

```
curl -s -o /dev/null -w "%{http_code}" https://research-app-staging-dk3zukidya-ey.a.run.app/
# 403  ← unauthenticated request rejected by Cloud Run IAM

curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  https://research-app-staging-dk3zukidya-ey.a.run.app/
# 200  ← balint@skillnaut.co authenticated via roles/run.invoker
```

## Startup-complete log marker

```
resource.type="cloud_run_revision"
resource.labels.service_name="research-app-staging"
jsonPayload.event="startup_complete"
```

Single INFO entry at `2026-04-20T11:54:39Z` — no DB smoke-query retries, no errors. TiDB was awake; cold-start budget well under the 650 ms ceiling from spec §5.1.

## Known warning (non-blocking)

GitHub Actions annotated the deploy run with a Node.js 20 deprecation notice (for `actions/checkout@v4`, `google-github-actions/auth@v2`, `google-github-actions/setup-gcloud@v2`). Node 20 will be removed from GA runners on 2026-09-16. Tracked for follow-up: either bump to newer action versions that support Node 24, or set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` in the workflow. Non-blocking for this sprint.

## Next steps

- **Task 11:** Task 8 C2b E2E smoke-test (dev-login → admin key save → `ENC1:` DB verify → research pipeline roundtrip) — see `docs/deployment/smoke-test-c2b.md` (to be committed in Task 11).
