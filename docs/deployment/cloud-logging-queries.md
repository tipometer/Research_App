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
