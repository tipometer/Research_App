# C2b Sprint — API Key AES-256-GCM Envelope Encryption Design

**Verzió:** 1.0
**Dátum:** 2026-04-18
**Scope:** C2b sprint (security hardening — DB persistence layer)
**Kontextus:** Deep Research app, C2 sprint sub-project split into C2a (runtime pipeline hardening, merged) and C2b (API key encryption, this sprint)
**Előzmény:** C1 sprint merged 2026-04-17 (PR #1 + #2). C2a sprint merged 2026-04-18 (PR #3 + #4). C2b builds on the `server/ai/` module and `aiConfigs` DB table.

---

## 1. Vezetői összefoglaló

Az `aiConfigs.apiKey` oszlop jelenleg **plaintext formában** tárolja a provider API kulcsokat (OpenAI, Anthropic, Google). Ez DB-dump / log-leak / insider threat esetén azonnali kulcsszivárgást jelent, miközben az API kulcsok pénzügyi és adatvédelmi kockázatot hordoznak (rate-limit abuse, költségterhelés, potenciális PII exposure).

A C2b sprint **envelope encryption**-t vezet be AES-256-GCM-mel: minden DB-be írt API kulcs egy master key-jel titkosítva kerül tárolásra, a master key pedig **környezeti változóban** (`MASTER_ENCRYPTION_KEY`) érkezik a deploy platform secret manager-jéből (Google Secret Manager / Vercel Env / similar). Ez megfelel a **12-factor app** alapelveknek: a secret nem a kódban és nem a DB-ben van.

Két kulcs tervezési döntés:
1. **Lazy migráció** — meglévő plaintext kulcsok nem kerülnek azonnali batch-migrálásra. A read path detektálja a formátumot (`ENC1:` prefix), és plaintext kulcsot passthrough-val ad vissza; következő admin save-kor a kulcs automatikusan encrypted formában mentődik.
2. **Env-only singleton master key** — nincs KMS integráció, nincs key rotation támogatás MVP-ben. A deploy platform Secret Manager-je kezeli a master key-t, az alkalmazás csak env-változóból olvassa. KMS / rotation C3 scope.

A fallback layer (C2a-ban bevezetve) kiegészül: `DecryptionError` **permanent error**-ként viselkedik (analog a 401-gyel), tehát **nem triggerel fallback-et** — egy dekódolhatatlan kulcs config hiba, amit admin-nak látnia kell, nem csendesen maszkolni kell.

Az admin UI egy olvasható encryption-status badge-et kap provider-enként (🔒 Encrypted / ⚠ Plaintext legacy), ami migráció-átláthatóságot ad anélkül, hogy a kulcsot vagy annak részleteit exponálná.

---

## 2. Scope & Non-scope

### 2.1 C2b Scope (benne van)

**Crypto modul:**
- `server/ai/crypto.ts` új modul:
  - `encrypt(plaintext, masterKey, aad): string` — AES-256-GCM, random 12-byte IV, 16-byte tag
  - `decrypt(stored, masterKey, aad): string` — format guard + version guard + auth verification
  - `getMasterKey(): Buffer` — env-only singleton, base64-decoded 32 byte
  - `DecryptionError extends Error` — distinguishable failure mode
  - `__resetMasterKeyForTesting()` — test-only singleton reset (NODE_ENV guard)

**Ciphertext format:**
- String-encoded 4-segment: `ENC1:<iv_b64>:<ct_b64>:<tag_b64>` (`:` delimiter)
- Version prefix `ENC1` fix — future version support lazy dispatch-tel

**AAD (Additional Authenticated Data):**
- Érték: `aiConfig:<provider.toLowerCase()>` (pl. `aiConfig:openai`)
- Binding: egy provider ciphertextje nem dekódolható másik provider AAD-jével → context swap támadás ellen védelem

**Master key management:**
- Env var: `MASTER_ENCRYPTION_KEY` (base64-encoded 32 byte)
- Startup validation: `server/_core/index.ts` bootoláskor hívja `getMasterKey()`-t → fast-fail ha hiányzik vagy rossz hosszú
- Singleton cache modul-scope-ban (első call után memóizálva)
- Test helper: `__resetMasterKeyForTesting()` — csak ha `NODE_ENV !== "production"`, throws egyébként

**Router integráció (lazy migration):**
- `server/ai/router.ts`: új privát helper `decryptIfNeeded(stored, masterKey, aad): string`
  - `stored.startsWith("ENC1:")` → `decrypt(...)` hívás
  - Egyébként → plaintext passthrough + `console.warn` dev/staging környezetben (`NODE_ENV !== "production"`), **prod-ban csendes** (nem akarjuk a log-okat szennyezni a migrációs időszakban)
- `lookupApiKey` módosítás: DB read után `decryptIfNeeded` hívás, `null` apiKey továbbra is ENV-re fall through (C1 viselkedés megőrizve local dev workflow kedvéért)

**Admin save flow (encryption at write):**
- `admin.ai.setProviderKey` mutation (vagy megfelelő endpoint): minden DB write előtt `encrypt(...)` hívás
- Nincs admin opt-out / plaintext mentési lehetőség — új save-ek mindig encrypted formában landolnak

**Fallback integráció:**
- `server/ai/fallback.ts` `isFallbackEligible`: `DecryptionError` instance check → `false` (permanent, mint 401)
- WARN log **nem** tartalmaz sensitive AAD context-et (pl. nem logol provider név + error message egyben, csak generic "decryption failed for API key lookup")

**Admin UI (status visibility):**
- `admin.ai.getProviders` (vagy megfelelő list endpoint) response shape bővítés: `{ provider, hasKey, isEncrypted, maskedKey }`
- `isEncrypted: boolean` detektálás backend-en: `storedKey.startsWith("ENC1:")` — **decrypt nélkül**, olcsó és biztonságos
- Badge komponens: 🔒 "Encrypted" (success variant) vs ⚠ "Plaintext (legacy)" (warning variant)
- Scope: csak `adminProcedure`, soha `publicProcedure` response-ba nem kerül

**Deployment / env:**
- `MASTER_ENCRYPTION_KEY` Secret Manager-be → env-be injection (platform-specifikus, deploy-layer concern)
- Dokumentáció: generálási utasítás (`openssl rand -base64 32`), kezelési policy
- `.env.example` frissítés: `MASTER_ENCRYPTION_KEY=<base64 32 bytes>` placeholder + instrukció

**Testing:**
- `server/ai/crypto.test.ts`: round-trip, tamper-detection (modified IV/ct/tag → DecryptionError), AAD mismatch → DecryptionError, format guard (nem 4-szegmens → DecryptionError), version guard (nem `ENC1` prefix → DecryptionError), missing master key → throw, invalid key length → throw
- `server/ai/router.test.ts` (integration): encrypted key lookup round-trip, plaintext key passthrough (lazy migration), null apiKey fall-through ENV-re, DecryptionError propagation
- `server/ai/fallback.test.ts`: `DecryptionError` → `isFallbackEligible === false` (distinguishing test a transient 500-tól)

### 2.2 C2b Non-scope (kifejezetten nincs benne — későbbi sprint)

**C3 scope (később):**
- **Key rotation támogatás**: dual-key decrypt (old + new master key párhuzamosan), re-encryption migration script, rotation policy doc
- **KMS integráció**: Google Cloud KMS / AWS KMS / Vercel KMS — a master key maga KMS-ben él, csak a DEK (data encryption key) kerül env-be, vagy envelope KMS call minden decrypt-nél
- **Audit log bővítés encryption-specifikus event-ekkel**: encrypt/decrypt events (success/failure), key rotation events, admin re-encrypt action log
- **Automated re-encryption script**: batch migráció meglévő plaintext kulcsokra admin interaction nélkül (jelenleg lazy — csak save triggereli)
- **Admin "Re-encrypt all legacy keys now" action**: proaktív migráció gomb az admin UI-n (a lazy migration következő save-kor eleve ugyanezt éri el, ezért YAGNI MVP-re)

**Explicit nem-scope:**
- Per-tenant / per-user master key (jelenleg organization-level tenant izoláció nincs ebben a projektben — V2 scope)
- Hardware Security Module (HSM) integration
- FIPS compliance certification
- Key escrow / break-glass recovery procedure

### 2.3 Known limitations (MVP korlátok, explicit rögzítve)

**1. Master key rotation nem támogatott.**
Ha a `MASTER_ENCRYPTION_KEY` env változó megváltozik, **az összes meglévő ciphertext dekódolhatatlanná válik** (AAD és auth tag mismatch). Megoldás: admin-nak **kézzel újra kell menteni minden provider kulcsot** az új master key-jel. Automatizált dual-key decrypt és re-encryption batch script C3 scope. Ez megakadályozza, hogy egy jövőbeli fejlesztő „naivan" rotálja a master key-t éles rendszerben adatvesztés kockázatával.

**2. Audit log nem tartalmaz encryption-specifikus event-eket.**
A C1 `auditLogs` tábla (PRD §2.5) már létezik, és az `admin.ai.setProviderKey` mutation auditálása C1-ben élesítve van. C2b után egy ilyen audit log entry **implicit jelzi**, hogy „ez a kulcs mostantól encrypted formában van tárolva" (mert C2b óta minden save encrypt-elődik). Explicit `key.encrypted` / `key.decrypted` event-ek bevezetése C3 scope.

**3. Lazy migráció soha nem fejeződik be automatikusan.**
Egy olyan `aiConfigs` sor, amit a C2b merge után soha nem mentenek újra, örökre plaintext marad a DB-ben. Az admin UI badge (⚠ Plaintext legacy) teszi láthatóvá ezeket. A tényleges migrációt admin triggereli (egyszerű re-save az admin UI-ban).

---

## 3. Architektúra

### 3.1 Magas szintű adat-folyam

```
Write path (admin save):
[Admin UI] ──submit(plaintext)──▶ [admin.ai.setProviderKey]
                                         │
                                         ▼
                                    encrypt(plaintext, masterKey, aad)
                                         │
                                         ▼
                                    "ENC1:iv:ct:tag" ──▶ [aiConfigs.apiKey]

Read path (pipeline execution):
[research-pipeline] ──▶ [router.lookupApiKey(provider)]
                               │
                               ▼
                          DB read → stored: string
                               │
                               ▼
                          decryptIfNeeded(stored, masterKey, aad)
                               │       │
                        ┌──────┘       └──────┐
                  "ENC1:" prefix?       no prefix?
                        │                     │
                   decrypt(...)         return stored
                        │              (+ WARN log in dev/staging)
                        ▼                     ▼
                   plaintext ──────────────────
                               │
                               ▼
                          [Vercel AI SDK invocation]

Status visibility (admin list):
[Admin UI] ──▶ [admin.ai.getProviders]
                      │
                      ▼
                 DB read → stored: string
                      │
                      ▼
                 isEncrypted: stored.startsWith("ENC1:")
                      │
                      ▼
                 response: { provider, hasKey, isEncrypted, maskedKey }
                      │
                      ▼
                 [Admin UI badge render]
```

### 3.2 Új / módosított fájlok

```
server/
├── _core/
│   └── index.ts                ← módosított: startup call getMasterKey() (fast-fail)
└── ai/
    ├── crypto.ts               ← ÚJ: AES-256-GCM primitives + master key singleton
    ├── crypto.test.ts          ← ÚJ: unit tests (round-trip, tamper, format, version, AAD)
    ├── router.ts               ← módosított: decryptIfNeeded helper, lookupApiKey integráció
    ├── router.test.ts          ← módosított: encrypted + plaintext + null lookup cases
    ├── fallback.ts             ← módosított: isFallbackEligible DecryptionError case
    └── fallback.test.ts        ← módosított: DecryptionError distinguishing test

server/admin/
└── ai-routes.ts                ← módosított: setProviderKey encrypt at write;
                                             getProviders isEncrypted mező

client/src/features/admin/
└── ApiKeysPanel.tsx (vagy hasonló) ← módosított: isEncrypted badge render

.env.example                    ← módosított: MASTER_ENCRYPTION_KEY placeholder
docs/
└── deployment.md (vagy CONFIG.md) ← módosított: master key generation + management doc
```

**Megjegyzés:** a pontos admin route fájl és admin UI komponens elérési útját az implementation plan fogja véglegesíteni a codebase aktuális állapota alapján. A spec interface-eket rögzíti, nem konkrét fájlneveket a már létező UI-hoz.

---

## 4. Crypto modul részletes design (`server/ai/crypto.ts`)

### 4.1 Constants

```typescript
const VERSION = "ENC1";
const IV_LENGTH = 12;    // 96 bits — GCM standard (NIST SP 800-38D)
const TAG_LENGTH = 16;   // 128 bits — GCM standard
const KEY_LENGTH = 32;   // 256 bits — AES-256
```

### 4.2 Master key singleton

```typescript
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

export function __resetMasterKeyForTesting(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("__resetMasterKeyForTesting must not be called in production");
  }
  cachedMasterKey = null;
}
```

### 4.3 Encrypt

```typescript
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
```

### 4.4 Decrypt

```typescript
export function decrypt(stored: string, masterKey: Buffer, aad: string): string {
  const parts = stored.split(":");

  // Format guard: 4 segments required (ENC1 : iv : ct : tag)
  // This guard also protects against plaintext inputs that happen to contain ':' chars
  // (e.g., `sk-ant-api03-...` secrets — never fed here, but defensive).
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
    // Node's crypto throws generic Error for auth failure, wrap it
    throw new DecryptionError("Decryption failed (auth tag mismatch or corrupted ciphertext)", err);
  }
}
```

### 4.5 DecryptionError class

```typescript
export class DecryptionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "DecryptionError";
  }
}
```

**Rationale:** külön class az `instanceof` detektáláshoz a fallback layer-ben (nem lehet stringly-typed error message matching) és a consumer kódban.

---

## 5. Router integráció (`server/ai/router.ts`)

### 5.1 `decryptIfNeeded` helper (új privát függvény)

```typescript
function decryptIfNeeded(stored: string, masterKey: Buffer, aad: string): string {
  if (!stored.startsWith("ENC1:")) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[crypto] Plaintext API key detected for ${aad} — ` +
        `will encrypt on next admin save (lazy migration)`
      );
    }
    return stored;  // lazy migration — plaintext passthrough
  }
  return decrypt(stored, masterKey, aad);
}
```

**Design rationale:** egyetlen központi hely ahol a format detection + migration policy él. Ha a jövőben policy változik (pl. "plaintext rejected after 2026-07-01"), csak ezt a függvényt kell módosítani.

### 5.2 `lookupApiKey` módosítás

Jelenlegi (C1/C2a) viselkedés: DB lookup → ha van sor → `stored` visszaadva; egyébként ENV fallback.

Új (C2b) viselkedés: DB lookup → ha van sor → `decryptIfNeeded(stored, getMasterKey(), aad)` → visszaadott plaintext; egyébként ENV fallback **változatlan**.

Az `aad` érték: `aiConfig:${provider.toLowerCase()}` — a `.toLowerCase()` védelem az admin UI case-sensitivity inkonzisztencia ellen (pl. "OpenAI" vs "openai").

**Null apiKey viselkedés:** továbbra is ENV-re fall through (C1 kontrakt megőrizve) — local dev workflow-ban fontos, hogy ne kelljen DB-t seedelni minden dev környezetben.

---

## 6. Fallback integráció (`server/ai/fallback.ts`)

### 6.1 `isFallbackEligible` bővítés

Jelenlegi classifier (C2a): transient errors (5xx, 429, timeout, network, ZodError retry-exhausted) → eligible; permanent errors (401, 400, 403, 404) → not eligible.

Új ág (C2b):

```typescript
if (err instanceof DecryptionError) {
  console.warn(
    `[fallback] Decryption error — config issue, not a transient fault`
  );
  // NOTE: intentionally no AAD/provider in log message to avoid sensitive context leak
  return false;  // analogous to 401 permanent error
}
```

**Rationale:** `DecryptionError` az alábbi forrásokból jöhet:
- Master key változott (rotation attempt without migration)
- Ciphertext korruptált (DB restore from incompatible snapshot)
- AAD mismatch (config adatintegritási hiba)
- Format guard failure (malformed DB entry)

Mindegyik **config / operational hiba**, nem transient network/provider issue. A fallback modell ugyanazt a kulcsot nem tudja dekódolni → fallback retry értelmetlen. Admin beavatkozás kell.

### 6.2 Logging diszciplína

A WARN log **nem** tartalmazhat:
- AAD tartalmat (`aiConfig:openai` → provider info indirect leak)
- DecryptionError részletes `cause` message-et (Node crypto error detail)
- Ciphertext bármilyen részletét

Tartalmazhat:
- Generic üzenet ("decryption error — config issue")
- Hívás contextje (phase name, attempt number)

Az error maga `throw`-olódik az API response-ban ahol a caller struktúráltabban (admin-facing) kezelheti.

---

## 7. Admin UI (encryption status visibility)

### 7.1 Backend — `admin.ai.getProviders` response shape

```typescript
// Előtte (C1/C2a):
{
  provider: "openai",
  hasKey: true,
  maskedKey: "sk-...••••••••",
}

// Utána (C2b):
{
  provider: "openai",
  hasKey: true,
  isEncrypted: boolean,  // ÚJ mező
  maskedKey: "sk-...••••••••",
}
```

**`isEncrypted` detektálás:**
```typescript
isEncrypted: storedKey.startsWith("ENC1:")
```

Nincs `decrypt()` hívás — csak prefix string check. Biztonságos (nem exponál semmit), olcsó (O(1)).

**Scope-kötés:** ez a mező **csak** `adminProcedure` válaszában jelenhet meg. A `publicProcedure` endpointok (ha bármikor API kulcs-relatív infót visszaadnak) **soha** nem tartalmazhatják. A spec ezt explicit rögzíti a plan-be átadáshoz — az implementation plan code-review checkpoint-jának verifikálnia kell.

### 7.2 Frontend — badge komponens

```tsx
// Simplified render — tényleges tervezés az ApiKeysPanel meglévő stílus-rendszerében
{provider.hasKey && provider.isEncrypted && (
  <Badge variant="success">🔒 Encrypted</Badge>
)}
{provider.hasKey && !provider.isEncrypted && (
  <Badge variant="warning">⚠ Plaintext (legacy)</Badge>
)}
```

Nincs `hasKey === false` esetén badge (nincs kulcs → nincs encryption status).

**Nincs action gomb** — a migrálás implicit: admin egyszerűen újra menti a kulcsot a meglévő save flow-val, és az új entry encrypted lesz.

---

## 8. Startup validation (`server/_core/index.ts`)

Az alkalmazás boot fázisában — minden más init előtt, ami API kulcsokat érinthet — meg kell hívni:

```typescript
import { getMasterKey } from "../ai/crypto";

// Fast-fail: crashes startup ha MASTER_ENCRYPTION_KEY hiányzik vagy malformed
getMasterKey();
```

**Rationale:** jobb startup-kor crash-elni error message-dzsel, mint első admin save vagy első pipeline execution közben dobni hibát. DevOps / platform team azonnal látja a deploy health check-ben.

**Nem dobunk warningot** nem-produkciós környezetekben — ha a key hiányzik, az egy konfigurációs hiba minden környezetben, nem csak prod-ban. A lazy plaintext migráció önmaga viszont csak dev/staging-ben logol (§5.1).

---

## 9. Testing plan

### 9.1 `server/ai/crypto.test.ts` (unit)

- **Round-trip**: `decrypt(encrypt(x, k, a), k, a) === x` — alapvető correctness
- **Different IV per call**: `encrypt(x, k, a) !== encrypt(x, k, a)` — non-deterministic
- **Tamper detection — ciphertext**: módosított ct byte → `DecryptionError`
- **Tamper detection — tag**: módosított tag byte → `DecryptionError`
- **Tamper detection — IV**: módosított IV byte → `DecryptionError`
- **AAD mismatch**: `decrypt(encrypt(x, k, "a1"), k, "a2")` → `DecryptionError`
- **Format guard — wrong segment count**: `"ENC1:onlytwo"` → `DecryptionError`
- **Format guard — plaintext with colons**: `"sk-ant-api03-xyz:abc"` → `DecryptionError` (expected 4 segments, got 2)
- **Version guard**: `"ENC2:..."` → `DecryptionError`
- **Invalid base64 in segment**: `"ENC1:!!!:ct:tag"` → `DecryptionError`
- **Master key — missing env**: `delete env, getMasterKey()` → throws
- **Master key — wrong length**: 16-byte key → throws
- **Master key — singleton**: two calls return same Buffer reference
- **`__resetMasterKeyForTesting` — production guard**: `NODE_ENV=production` → throws

### 9.2 `server/ai/router.test.ts` (integration)

- **Encrypted DB row**: `lookupApiKey` round-trip encrypted value → plaintext returned
- **Plaintext DB row (lazy migration)**: `lookupApiKey` returns plaintext passthrough + WARN log
- **Plaintext DB row — production silence**: `NODE_ENV=production` + plaintext row → no WARN log
- **Null DB row**: `lookupApiKey` falls through to ENV var (C1 contract preserved)
- **Malformed DB row**: `"ENC1:garbage"` → `DecryptionError` propagates

### 9.3 `server/ai/fallback.test.ts` (distinguishing)

- **`DecryptionError` → not eligible**: `isFallbackEligible(new DecryptionError(...))` === `false`
- **Generic 500 → eligible**: existing transient case still passes
- **401 → not eligible**: existing permanent case still passes
- **Log content — DecryptionError**: verify log message does NOT contain AAD or provider name

### 9.4 E2E / manual verification

- Pipeline execution with encrypted DB config → sikeres lookup + pipeline futás
- Admin save flow → DB-ben az új entry `ENC1:` prefixszel
- Admin list endpoint → `isEncrypted: true` az új sorokra
- Lazy migration path → meglévő plaintext sor → admin re-save → következő lookup encrypted

---

## 10. Deployment / ops

### 10.1 Master key generálás

```bash
openssl rand -base64 32
```

Kimenet egy `MASTER_ENCRYPTION_KEY=<base64>` env változóba kerül a deploy platform secret manager-ében.

### 10.2 Secret manager injection

A deploy platform (Google Cloud Run + Secret Manager, Vercel + Env Secrets, vagy hasonló) felelőssége a secret → runtime env injection. Az alkalmazás csak `process.env.MASTER_ENCRYPTION_KEY`-t olvas. 12-factor compliant.

### 10.3 Env-changes in deployment docs

`docs/deployment.md` (vagy megfelelő doc) frissítése:
- Master key generálás utasítás
- Secret manager konfiguráció példa
- "Don't commit master key to git" figyelmeztetés
- Rotation policy placeholder ("currently manual re-save required; automated rotation — C3 scope")

### 10.4 `.env.example` frissítés

```bash
# AES-256-GCM master key for aiConfigs.apiKey encryption
# Generate with: openssl rand -base64 32
# Must be base64-encoded 32 bytes
MASTER_ENCRYPTION_KEY=
```

### 10.5 Initial deployment after C2b merge

1. DevOps generálja a master key-t, felveszi a secret manager-be
2. Alkalmazás deploy → startup validation OK
3. Meglévő DB kulcsok **plaintext marad**nak a DB-ben, de működnek (lazy migration)
4. Admin UI a ⚠ Plaintext (legacy) badge-et mutatja a még nem migrált kulcsokra
5. Admin ad-hoc újra menti a kulcsokat → következő menéssel encrypted formában landol
6. Idővel minden provider sor migrálódik; a badge 🔒 Encrypted-re vált

---

## 11. Security audit checklist

Ezt a checklist-et az implementation plan code-review fázisában a reviewer subagent verifikálja:

- [ ] Master key soha nem logolódik (még dev-ben sem)
- [ ] DecryptionError log nem tartalmaz AAD / provider / ciphertext detail-t
- [ ] `isEncrypted` mező csak `adminProcedure` response-ban
- [ ] `encrypt` minden hívásnál új random IV-t használ (nem determinisztikus)
- [ ] `decrypt` hibát dob ha master key hibás (nem csendesen) — de ez a fallback-ben non-eligible
- [ ] `__resetMasterKeyForTesting` NODE_ENV=production esetén throw-ol
- [ ] `.env.example`-ben csak placeholder, nem valódi key
- [ ] Admin save flow minden path-en encrypt hívást végez (nincs bypass)
- [ ] AAD normalizálva (`toLowerCase()`) → nincs case-mismatch attack vektor
- [ ] Format guard védelem: plaintext inputok (amik `:` karaktert tartalmaznak, pl. egyes API kulcs formátumok) DecryptionError-t dobnak, nem null pointer crash-t

---

## 12. Rollback plan

Ha a C2b deployment problémás:

**Teljes rollback (C2a-ra):**
1. Revert merge commit
2. Redeploy
3. Meglévő encrypted DB sorok visszamaradnak `ENC1:` prefixszel, de a C2a lookup plaintext-ként kezeli őket → Vercel SDK 401 / invalid API key error
4. Admin újra menti a kulcsokat plaintext formában — `aiConfigs.apiKey` újra plaintext
5. Pipeline működik

**Részleges rollback (master key elvesztése esetén):**
1. Minden `aiConfigs.apiKey` ami `ENC1:` prefixszel kezdődik → dekódolhatatlan
2. Admin újra menti minden provider kulcsot (új master key-jel, ha már van új, vagy régi nélkül)
3. Lazy migration: első új save után encrypted, a többi továbbra is plaintext amíg save nem történik

**Ezt a scenario-t a "Known limitation #1" (§2.3) dokumentálja; a rollback plan itt csak az operational lépéseket írja le.**

---

## 13. Connection to C1 / C2a architecture

**C1 összetevők érintve:**
- `aiConfigs` tábla `apiKey` oszlop — írás formátuma változik, olvasás policy változik (lazy migration)
- `server/ai/router.ts` `lookupApiKey` — új helper hívás, de DB-first / ENV fallback precedence megőrizve
- `admin.ai.setProviderKey` / `admin.ai.getProviders` endpoints — encrypt-at-write + status mező

**C2a összetevők érintve:**
- `server/ai/fallback.ts` `isFallbackEligible` — új non-eligible ág (`DecryptionError`)
- Minden más C2a komponens (sanitize.ts, executeWithFallback, runPhase4Stream) — **érintetlen**

**Új függőségek:**
- `node:crypto` beépített modul (semmi új npm package)

**Breaking changes C1 / C2a kontraktusokhoz:**
- **Egy** (kényszerű): `lookupApiKey` most kérheti `getMasterKey()`-t, ami throws ha env nincs beállítva. Ez **startup-kor** kiderül (§8), tehát a változás tested path-on landol, nem runtime meglepetés.

---

## 14. Migration timeline

**T0 (merge):** C2b deploy
- Új save-ek: encrypted
- Régi sorok: plaintext (badge ⚠ jelzi)
- Pipeline működik mindkét formátummal

**T0+N nap (admin ad-hoc):** admin fokozatosan re-save-eli a kulcsokat
- Minden re-save: plaintext → encrypted átalakulás
- Badge 🔒-re vált

**T0+∞ (nem minden kulcsot mentenek újra):** maradnak plaintext sorok
- Elfogadott állapot — a lazy migration ezt designolta
- C3-ban az "Admin re-encrypt all" action vagy automated script fejezheti be

---

## Összefoglalás

A C2b sprint egy fókuszált security hardening: AES-256-GCM envelope encryption az `aiConfigs.apiKey`-re, env-only master key management, lazy migration policy, fallback layer integration (DecryptionError non-eligible), admin UI status visibility (isEncrypted badge). Nincs KMS, nincs rotation, nincs encryption-audit-log — ezek C3 scope. A known limitations szekció explicit rögzíti, hogy a master key rotálása adatvesztést okozhat — ez dokumentált korlát, nem bug.

A C1 és C2a architektúra változása minimális: egy új modul (`crypto.ts`), egy új helper (`decryptIfNeeded` a router-ben), egy új non-eligible branch a fallback classifier-ben, egy új mező az admin endpoint response-ban. A tesztelés rétegzett (unit + integration + distinguishing fallback test + E2E manual), a deployment standard 12-factor env injection.
