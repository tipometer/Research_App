# Manus scaffold dead-code audit — 2026-04-20

**Run:** `./bin/manus-audit.sh` from the repo root (branch `feat/infra-foundation-staging`).
**Purpose:** evidence record for §7 pre-containerization cleanup decisions.

**Finding:** 5 of 6 scaffold files have 0 live imports (storage, map, voiceTranscription, imageGeneration, dataApi). `notification.ts` is LIVE (systemRouter.ts:2 → routers.ts:50 → appRouter). See Task 2 ERRATA in `docs/superpowers/plans/2026-04-20-infra-foundation-staging.md`.

**Client-side Manus artifacts (out of scope):** `client/src/const.ts` + `client/public/__manus__/debug-collector.js` contain Manus references. Client-side artifacts unrelated to the server-side Infra Foundation sprint; decommission tracked under the future Manus-decommission / Auth migration sprint.

---

═══════════════════════════════════════════════════════
1. Manus env var references
═══════════════════════════════════════════════════════
./.env.local.example:53:# VITE_APP_ID=...
./.env.local.example:54:# OAUTH_SERVER_URL=...
./.env.local.example:55:# OWNER_OPEN_ID=...
./server/_core/dataApi.ts:21:    throw new Error("BUILT_IN_FORGE_API_URL is not configured");
./server/_core/dataApi.ts:24:    throw new Error("BUILT_IN_FORGE_API_KEY is not configured");
./server/_core/map.ts:27:      "Google Maps proxy credentials missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY"
./server/_core/sdk.ts:36:        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
./server/_core/env.ts:2:  appId: process.env.VITE_APP_ID ?? "",
./server/_core/env.ts:5:  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
./server/_core/env.ts:6:  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
./server/_core/env.ts:8:  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
./server/_core/env.ts:9:  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
./server/_core/imageGeneration.ts:38:    throw new Error("BUILT_IN_FORGE_API_URL is not configured");
./server/_core/imageGeneration.ts:41:    throw new Error("BUILT_IN_FORGE_API_KEY is not configured");
./server/_core/voiceTranscription.ts:82:        details: "BUILT_IN_FORGE_API_URL is not set"
./server/_core/voiceTranscription.ts:89:        details: "BUILT_IN_FORGE_API_KEY is not set"
./server/storage.ts:14:      "Storage proxy credentials missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY"
./client/public/__manus__/debug-collector.js:16:  if (window.__MANUS_DEBUG_COLLECTOR__) return;
./client/public/__manus__/debug-collector.js:814:  window.__MANUS_DEBUG_COLLECTOR__ = {
./client/src/const.ts:6:  const appId = import.meta.env.VITE_APP_ID;

═══════════════════════════════════════════════════════
2. AWS SDK references
═══════════════════════════════════════════════════════
./package.json:21:    "@aws-sdk/client-s3": "^3.693.0",
./package.json:22:    "@aws-sdk/s3-request-presigner": "^3.693.0",

═══════════════════════════════════════════════════════
3. Scaffold file import graph
═══════════════════════════════════════════════════════
--- imports of storage ---
./server/_core/imageGeneration.ts:18:import { storagePut } from "server/storage";
--- imports of map ---
  (no imports — safe to delete)
--- imports of voiceTranscription ---
./server/_core/voiceTranscription.ts:249: * import { transcribeAudio } from "./_core/voiceTranscription";
--- imports of imageGeneration ---
  (no imports — safe to delete)
--- imports of dataApi ---
  (no imports — safe to delete)
--- imports of notification ---
./server/_core/systemRouter.ts:2:import { notifyOwner } from "./notification";

═══════════════════════════════════════════════════════
4. Manus OAuth (HAGYD BÉKÉN — Auth sprint scope)
═══════════════════════════════════════════════════════
./server/_core/oauth.ts:12:export function registerOAuthRoutes(app: Express) {
./server/_core/index.ts:12:import { registerOAuthRoutes } from "./oauth";
./server/_core/index.ts:95:  registerOAuthRoutes(app);
  ↑ ha van match: HAGYD BÉKÉN. Auth migration sprint kezeli.
