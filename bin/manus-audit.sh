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
