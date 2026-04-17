# AI Pipeline Migráció — C1 Sprint Design

**Verzió:** 1.0
**Dátum:** 2026-04-17
**Scope:** C1 sprint (MVP, ~3-5 nap)
**Kontextus:** Deep Research app Manus → natív migráció, első alrendszer

---

## 1. Vezetői összefoglaló

Az AI pipeline-t a Manus platform `invokeLLM` helper (Manus Forge proxy) helyett a **Vercel AI SDK** köré építjük át, közvetlen provider SDK-kra (OpenAI, Anthropic, Google Gemini). A **Gemini Search Grounding** bekerül az 1-3. fázisba (Wide Scan, Gap Detection, Deep Dives) valós webes kutatásért. Az admin felületen konfigurált API kulcsok és fázis→modell hozzárendelések runtime-ban érvényesülnek (DB-first / ENV fallback precedence).

A Synthesis (4. fázis) tisztán LLM-alapú marad (grounding nélkül), de `streamObject` használatával progresszív streaminget kap, hogy ne kelljen a felhasználónak 180 másodpercet várnia az első tokenre.

C1 **nem** tartalmaz: fallback modell logikát, prompt injection sanitizationt, encrypted API key storage-ot — ezek a **C2 sprint** scope-jában lesznek.

---

## 2. Scope & Non-scope

### 2.1 C1 Scope (benne van)

- Manus `invokeLLM` helper leváltása Vercel AI SDK-ra
- Közvetlen provider integráció: OpenAI, Anthropic, Google Gemini
- Gemini Search Grounding fázis 1-3-ra
- `streamObject` Synthesis-hez (progresszív markdown streaming)
- Admin routing tényleges élesítése: `aiConfigs` + `modelRouting` táblák runtime-ba kötve
- DB-first / ENV fallback precedence
- `pnpm db:seed` script (PRD defaultok seedelése)
- Zod sémák fázisonként
- Zod validation retry (1x, error message beágyazva a promptba)
- Per-phase timeout (120s / 180s / 60s)
- `extractOriginalUrl()` helper (Gemini redirect URL parser)
- `classify.ts` domain-alapú sourceType heurisztika
- UI "Dátum ismeretlen" fallback null `publishedAt` esetén

### 2.2 C1 Non-scope (kifejezetten nincs benne — későbbi sprintek)

- **C2**: fallback modell logika (`modelRouting.fallbackModel` mező van, de még nem használt), prompt injection sanitization, AES-256-GCM API key encryption
- **Auth migráció**: Manus OAuth marad élesben (külön sub-project)
- **Infra**: deploy target választás (Docker/Cloud Run/VPS) — külön sub-project
- **Fizetés**: Stripe + Számlázz.hu (külön sub-project)
- **V1 maradék**: PDF/MD export, Synthesis 2.0 (emberi kutatás integráció), DOMPurify, CSV import (külön sub-projects)
- **V2**: dátum extraction HTML fetch-ből, admin-konfigurálható classify domain listák

---

## 3. Architektúra

### 3.1 Magas szintű adat-folyam

```
[Admin UI] ──writes──▶ [aiConfigs, modelRouting tables]
                              │
                              ▼
[research-pipeline.ts] ──reads──▶ [llm-router.ts] ──invokes──▶ [Vercel AI SDK]
                                       │                            │
                                       │                            ├── @ai-sdk/openai
                                       │                            ├── @ai-sdk/anthropic
                                       │                            └── @ai-sdk/google (+Search Grounding)
                                       │
                                       └── per call:
                                           1) phase → provider + model lookup from DB
                                           2) provider → API key lookup (DB or ENV)
                                           3) Vercel SDK invocation with Zod schema
                                           4) validated output + extracted sources[]
```

### 3.2 Új fájlstruktúra

```
server/
├── _core/
│   └── llm.ts                  ← ÁTÍROVA: Manus-specifikus helper eltávolítva (vagy deprecated alias)
└── ai/
    ├── router.ts               ← új: modellválasztás fázis alapján (DB → ENV fallback)
    ├── providers.ts            ← új: Vercel AI SDK provider instantiation
    ├── schemas.ts              ← új: Zod sémák fázisonként
    ├── grounding.ts            ← új: Gemini groundingMetadata → ExtractedSource[] mapping
    ├── classify.ts             ← új: domain → sourceType heurisztika
    ├── seed.ts                 ← új: modelRouting default seedelés (idempotens)
    └── pipeline-phases.ts      ← új: fázisonkénti LLM hívás logika (kiemelve)

server/research-pipeline.ts     ← refaktor: SSE + DB write logika marad, AI hívások átkerülnek
server/routers.ts               ← admin tRPC procedure-k élesítése (ai config, routing, test connection)
client/src/pages/AdminPanel.tsx ← meglévő AI Config tab bekötése élő tRPC procedure-khöz
client/src/pages/ResearchReport.tsx ← "Dátum ismeretlen" fallback null publishedAt esetén
```

### 3.3 DB séma változások

**Nincsenek.** A `modelRouting`, `aiConfigs`, `sources` táblák már léteznek a schema-ban és megfelelőek. Csak a `sources.publishedAt` nullable szemantika kell hogy helyesen kezelődjön a UI-n (már nullable a sémában).

### 3.4 Új függőségek

```json
{
  "dependencies": {
    "ai": "^5.x",
    "@ai-sdk/openai": "^1.x",
    "@ai-sdk/anthropic": "^1.x",
    "@ai-sdk/google": "^1.x"
  }
}
```

A `zod` már jelen van (`^4.1.12`).

---

## 4. Routing precedence

Minden LLM hívás **3 lépéses lookup**-ot futtat:

### 4.1 Modellválasztás fázis alapján

```typescript
lookupModel(phase) =
  db.select().from(modelRouting).where(eq(phase, X)).primaryModel
  ?? ENV[`DEFAULT_MODEL_${phase.toUpperCase()}`]
  ?? HARDCODED_DEFAULT[phase]
```

### 4.2 Provider detekció modellnévből (prefix-alapú)

```typescript
function detectProvider(modelName: string): "openai" | "anthropic" | "google" {
  if (modelName.startsWith("gemini-"))                       return "google";
  if (modelName.startsWith("gpt-") || modelName.startsWith("o3-") || modelName.startsWith("o4-")) return "openai";
  if (modelName.startsWith("claude-"))                       return "anthropic";
  throw new Error(`Unknown provider for model: ${modelName}`);
}
```

**Miért prefix-alapú, nem DB oszlop**: rugalmasabb — új modell automatikusan felismerve, séma-módosítás nélkül. A kockázat (új provider új prefix-szel) kezelhető: ekkor frissül a `detectProvider` és egy új `@ai-sdk/...` csomag kerül be.

### 4.3 API kulcs feloldás

```typescript
lookupApiKey(provider) =
  db.select().from(aiConfigs).where(and(eq(provider, X), eq(isActive, true))).apiKey
  ?? ENV[`${provider.toUpperCase()}_API_KEY`]
  ?? throw new Error(`No API key configured for ${provider}`)
```

**Elv: DB-first, ENV fallback.** Indoklás:
- Admin UI runtime cseréje lehetővé teszi, hogy adminok kódmódosítás nélkül váltsanak kulcsot
- ENV fallback garantálja, hogy első deploy / lokál fejlesztés `.env` állományból is működik
- C1-ben a DB-ben tárolt kulcs **plain text**; C2-ben AES-256-GCM envelope encryption (master key Secret Manager-ben tárolva). A séma nem változik, csak az írási/olvasási réteg kap crypto wrappert.

---

## 5. Fázisonkénti modell-hozzárendelés (seedelés)

A `server/ai/seed.ts` idempotens script — `pnpm db:seed` parancsból fut (külön a `db:push`-tól, hogy CI-ban is triggerelhető legyen kontrolláltan).

### 5.1 Seed default értékek

| Fázis | Primary Model | Indoklás |
|---|---|---|
| `wide_scan` | `gemini-2.5-flash` (grounded) | olcsó, gyors, Google Search Grounding első osztályú |
| `gap_detection` | `gemini-2.5-flash` (grounded) | ugyanaz |
| `deep_dives` | `gemini-2.5-flash` (grounded) | ugyanaz (B opció: grounding kiterjesztve 1-3-ra) |
| `synthesis` | `claude-sonnet-4-6` | erős szintézis, hosszú kontextus |
| `polling` | `gpt-4.1-mini` | egyszerű kérdőívgenerálás, olcsó |
| `brainstorm` | `gpt-4.1-mini` | ötletgenerálás, olcsó |

### 5.2 Seed logika

```typescript
// server/ai/seed.ts
export async function seedModelRouting() {
  const existing = await db.select().from(modelRouting);
  if (existing.length > 0) return;  // idempotens — csak ha üres

  await db.insert(modelRouting).values([
    { phase: "wide_scan",     primaryModel: "gemini-2.5-flash" },
    { phase: "gap_detection", primaryModel: "gemini-2.5-flash" },
    { phase: "deep_dives",    primaryModel: "gemini-2.5-flash" },
    { phase: "synthesis",     primaryModel: "claude-sonnet-4-6" },
    { phase: "polling",       primaryModel: "gpt-4.1-mini" },
    { phase: "brainstorm",    primaryModel: "gpt-4.1-mini" },
  ]);
}
```

Minden seed érték admin UI-ból átírható — ezek csak első deploy default-ok.

---

## 6. Gemini Search Grounding integráció

### 6.1 Grounded fázisok

Fázis 1 (Wide Scan), Fázis 2 (Gap Detection), Fázis 3 (Deep Dives) mindegyike a `googleSearch` tool-t használja a Vercel AI SDK `@ai-sdk/google` csomagjából.

### 6.2 Vercel AI SDK hívás shape

```typescript
const result = await generateObject({
  model: google("gemini-2.5-flash"),
  tools: { googleSearch: google.tools.googleSearch() },
  schema: WideScanSchema,
  messages,
});

// result.providerMetadata.google.groundingMetadata tartalmazza a raw Gemini shape-et
```

### 6.3 Raw Gemini groundingMetadata shape

```typescript
interface GroundingMetadata {
  groundingChunks: Array<{ web: { uri: string; title: string } }>;
  groundingSupports: Array<{
    segment: { text: string; startIndex: number; endIndex: number };
    groundingChunkIndices: number[];
  }>;
  webSearchQueries: string[];
}
```

### 6.4 Extraction algoritmus (grounding.ts)

```typescript
interface ExtractedSource {
  url: string;
  title: string;
  snippet: string;
  sourceType: "academic" | "industry" | "news" | "blog" | "community";
  publishedAt: null; // C1-ben mindig null (lásd 6.6)
}

export function extractSources(metadata: GroundingMetadata): ExtractedSource[] {
  return metadata.groundingChunks.map((chunk, idx) => ({
    url: extractOriginalUrl(chunk.web.uri),
    title: chunk.web.title,
    snippet: metadata.groundingSupports
      .filter(s => s.groundingChunkIndices.includes(idx))
      .map(s => s.segment.text)
      .join(" … "),
    sourceType: classifyDomain(chunk.web.uri),
    publishedAt: null,
  }));
}
```

### 6.5 Redirect URL parsing (extractOriginalUrl)

A Gemini a `groundingChunks[i].web.uri` mezőben **nem** mindig az eredeti URL-t adja vissza, hanem egy `grounding-api-redirect/<payload>` formátumú redirectet. A payload gyakran base64-kódolt eredeti URL, de néha signed token (Google változtatja a formátumot).

```typescript
export function extractOriginalUrl(redirectUrl: string): string {
  const match = redirectUrl.match(/grounding-api-redirect\/(.+)/);
  if (match) {
    try {
      const decoded = Buffer.from(match[1], "base64").toString("utf-8");
      // sanity check: valid URL?
      if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
        return decoded;
      }
    } catch { /* base64 decode failed — signed token, fallback */ }
  }
  return redirectUrl; // fallback: nyers redirect URL tárolás
}
```

**Ismert limitáció**: a sikerarány gyakorlatban ~60-70%, Google frissítései csökkenthetik. A fallback (raw tárolás) garantálja, hogy ne törjön el semmi. Követőteszt: valós Gemini response-okkal.

### 6.6 publishedAt — C1 null

A groundingMetadata **nem** adja vissza a forrás publikálási dátumát. Opciók voltak:
- (a) C1-ben null — **választott**
- (b) külön LLM hívás classify-olja a dátumot a snippetből (drága, hibra hajlamos)
- (c) HTML fetch + meta tag parsing (scope-en kívül, hálózati overhead)

**UI konzekvencia**: `ResearchReport.tsx` forráskönyvtár "Dátum ismeretlen" label-t mutat, amikor `publishedAt IS NULL`. I18n kulcs: `report.sources.unknownDate` (HU: "Dátum ismeretlen", EN: "Unknown date").

### 6.7 classify.ts — domain heurisztika

```typescript
const ACADEMIC_TLDS = [".edu", ".ac.uk", ".ac.hu"];
const ACADEMIC_DOMAINS = ["scholar.google.com", "pubmed.ncbi.nlm.nih.gov", "arxiv.org", "researchgate.net"];

const NEWS_DOMAINS = ["bbc.com", "reuters.com", "techcrunch.com", "forbes.com", "bloomberg.com", "wsj.com", "ft.com"];

const COMMUNITY_DOMAINS = ["reddit.com", "quora.com", "stackoverflow.com", "producthunt.com", "news.ycombinator.com"];

const INDUSTRY_DOMAINS = ["gartner.com", "mckinsey.com", "statista.com", "crunchbase.com", "pitchbook.com"];

export function classifyDomain(url: string): SourceType {
  const host = safeParseHost(url);
  if (!host) return "blog";

  if (ACADEMIC_TLDS.some(tld => host.endsWith(tld))) return "academic";
  if (ACADEMIC_DOMAINS.some(d => host.includes(d)))  return "academic";
  if (NEWS_DOMAINS.some(d => host.endsWith(d)))      return "news";
  if (COMMUNITY_DOMAINS.some(d => host.endsWith(d))) return "community";
  if (INDUSTRY_DOMAINS.some(d => host.endsWith(d)))  return "industry";
  return "blog";
}
```

A listák bővíthetők; V2-ben admin UI-n kezelhetővé tehetők.

---

## 7. Zod sémák fázisonként

**Fontos elv**: a grounded fázisokban (1-3) a `sources` **NEM** része a schema-nak. Csak a `groundingMetadata`-ból származó források kerülnek DB-be. Ez megakadályozza, hogy a modell halluzinált forrásokat írjon.

### 7.1 WideScanSchema (Phase 1)

```typescript
export const WideScanSchema = z.object({
  keywords: z.array(z.string()).min(3).max(7),
  summary: z.string().min(50).max(500),
});
```

### 7.2 GapDetectionSchema (Phase 2)

```typescript
export const GapDetectionSchema = z.object({
  gaps: z.array(z.object({
    title: z.string(),
    description: z.string(),
  })).min(2).max(5),
  competitors: z.array(z.object({
    name: z.string(),
    weakness: z.string(),
  })).min(2).max(5),
  summary: z.string().min(50).max(500),
});
```

### 7.3 DeepDivesSchema (Phase 3)

```typescript
export const DeepDivesSchema = z.object({
  monetizationModels: z.array(z.object({
    name: z.string(),
    description: z.string(),
    revenueEstimate: z.string().optional(),
  })).min(2).max(5),
  technicalChallenges: z.array(z.object({
    title: z.string(),
    severity: z.enum(["low", "medium", "high"]),
  })).min(2).max(5),
  summary: z.string().min(50).max(500),
});
```

### 7.4 SynthesisSchema (Phase 4)

```typescript
export const SynthesisSchema = z.object({
  verdict: z.enum(["GO", "KILL", "CONDITIONAL"]),
  synthesisScore: z.number().min(0).max(10),
  scores: z.object({
    marketSize:   z.number().min(0).max(10),
    competition:  z.number().min(0).max(10),
    feasibility:  z.number().min(0).max(10),
    monetization: z.number().min(0).max(10),
    timeliness:   z.number().min(0).max(10),
  }),
  reportMarkdown: z.string().min(800),
  verdictReason: z.string().min(50).max(500),
});
```

Közvetlenül mappelhető Recharts `RadarChart` adatformátumra:
```typescript
const radarData = Object.entries(research.scores).map(([axis, value]) => ({ axis, value }));
```

### 7.5 PollingSchema (survey question generation)

```typescript
export const PollingSchema = z.object({
  questions: z.array(z.object({
    id: z.string(),
    type: z.enum(["single_choice", "multiple_choice", "likert", "short_text"]),
    text: z.string(),
    options: z.array(z.string()).optional(),
  })).min(3).max(5),
});
```

### 7.6 BrainstormSchema

```typescript
export const BrainstormSchema = z.object({
  ideas: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().max(300),
  })).length(10),
});
```

---

## 8. Streaming — Synthesis (streamObject)

A Synthesis fázis **nem** használ `generateObject`-et (blocking 180s), hanem `streamObject`-et. Ez progresszívan streameli a Zod-validated partial object-eket, ahogy a modell generálja a tokeneket.

### 8.1 Pattern

```typescript
const { partialObjectStream, object } = streamObject({
  model: anthropic("claude-sonnet-4-6"),
  schema: SynthesisSchema,
  messages,
});

for await (const partial of partialObjectStream) {
  // partial: rekurzívan Partial<z.infer<typeof SynthesisSchema>>
  // a reportMarkdown string field token-onként nő
  sendEvent(res, { type: "synthesis_progress", partial });
}

const final = await object; // teljes validált eredmény
```

### 8.2 SSE event shape

```typescript
| { type: "synthesis_progress"; partial: DeepPartial<SynthesisOutput> }
| { type: "synthesis_complete"; final: SynthesisOutput }
```

### 8.3 Kliens oldal (ResearchProgress.tsx)

Minden `synthesis_progress` event a UI `reportMarkdown` state-et frissíti. A user valós időben látja a riport épülni. A verdict + radardiagram csak a `synthesis_complete` eseménykor rajzolódik ki (mert a partial object közben invalid lehet).

### 8.4 Konzisztencia-garancia

Mivel egy modell-generáció adja mind a markdown-t mind a struktúrát (egy hívás, egy kontextus), a riport szöveges tartalma és a scoring / verdict **nem divergálhat** (szemben a két-hívásos `streamText` + `generateObject` megoldással).

---

## 9. Error handling

### 9.1 Általános elv (C1)

**Nincs fallback modell** — ez C2 scope. Ha primary modell hibázik, a kutatás `failed` státuszba kerül, a kredit visszatérítésre, a felhasználó értesítést kap.

### 9.2 Hibakategóriák

| Típus | Trigger | Viselkedés |
|---|---|---|
| **Provider API error** | auth, rate limit, 5xx, network fail | SSE `pipeline_error` event + `researches.status=failed` + credit refund + audit log |
| **Zod validation error** | LLM output nem matchel a sémára | **1x retry** ugyanarra a modellre, Zod error message beágyazva a promptba. Ha az is fail → provider error ág |
| **Timeout** | `AbortController` lejár | ugyanaz mint provider error |

### 9.3 Zod retry pattern

```typescript
export async function invokeWithRetry<T extends z.ZodSchema>(
  model: LanguageModelV1,
  schema: T,
  messages: ModelMessage[],
): Promise<z.infer<T>> {
  try {
    const { object } = await generateObject({ model, schema, messages });
    return object;
  } catch (err) {
    if (err instanceof NoObjectGeneratedError || err instanceof z.ZodError) {
      const errorDetails = err instanceof z.ZodError
        ? err.errors.map(e => `${e.path.join(".")}: ${e.message}`).join("; ")
        : err.message;

      const { object } = await generateObject({
        model,
        schema,
        messages: [
          ...messages,
          { role: "user", content:
            `Your previous response failed validation with these errors: ${errorDetails}. ` +
            `Return a valid JSON object matching the exact schema. Do not add extra fields.`
          },
        ],
      });
      return object;
    }
    throw err;
  }
}
```

A konkrét Zod error message beágyazása drasztikusan növeli a retry sikerességét, mert a modell pontosan tudja, mi volt a probléma (pl. "synthesisScore: expected number, received string").

### 9.4 Per-phase timeout

| Fázis | Timeout |
|---|---|
| Wide Scan | 120s |
| Gap Detection | 120s |
| Deep Dives | 120s |
| Synthesis | 180s (streamObject, de abort ha elakad) |
| Polling | 60s |
| Brainstorm | 60s |

Implementáció `AbortController`-ral, Vercel SDK `abortSignal` paramétere.

### 9.5 Kliens oldali error state

`ResearchProgress.tsx` már kezel error state-et (`pipeline_error` event). Csak a új event shape-re kell frissíteni:

```typescript
if (event.type === "pipeline_error") {
  setError({
    phase: event.phase,
    message: event.message,
    retriable: event.retriable ?? false,
  });
}
```

---

## 10. Testing stratégia

### 10.1 Unit tests (mockolt provider)

- `router.test.ts` — DB-first / ENV fallback lookup, provider detekció prefix alapján, ismeretlen modell → throw
- `grounding.test.ts` — fixture groundingMetadata JSON → ExtractedSource[] extract, `extractOriginalUrl()` base64 és fallback ág, groundingSupports → snippet mapping
- `classify.test.ts` — 30+ minta URL mind az 5 kategóriára (academic, industry, news, community, blog default)
- `schemas.test.ts` — valid/invalid input mindegyik schema-ra, határértékek (min/max)
- Mockolás: `vi.mock("ai")` a Vercel SDK-t lemockolja; a router logika igazi, a `generateObject`/`streamObject` fake response

### 10.2 Integration tests (valódi provider hívások)

- Új pattern: `*.integration.test.ts`, alapból `test.skip`-pel
- Opt-in: `RUN_INTEGRATION_TESTS=1 pnpm test:integration`
- Dedikált dev API kulcsok (alacsony quota, Secret Manager / Vault külön namespace)
- CI: **nem** fut PR-onként. Nightly cron + manual dispatch csak.
- Min. 1 teszt fázisonként: real Gemini grounded call, real Claude synthesis stream

### 10.3 Existing 17 vitest teszt

Smoke test — el kell hogy menjen a refaktor után is. A mock-okat frissíteni kell, ha a pipeline signature-je változik (ma az `invokeLLM`-re hivatkoznak; új: `llmRouter.invoke` vagy `invokeWithRetry`).

---

## 11. Migration plan (5 nap becsült)

| Nap | Lépés | Output |
|---|---|---|
| 1 | Deps install (`ai`, `@ai-sdk/*`) + `server/ai/` scaffold + `schemas.ts` + `classify.ts` | Zöld unit tesztek sémákra + classify-ra |
| 1 | `grounding.ts` + `extractOriginalUrl()` + fixture tesztek | Zöld `grounding.test.ts` |
| 2 | `providers.ts` + `router.ts` (DB→ENV lookup) + mock tesztek | Zöld `router.test.ts` |
| 2 | `seed.ts` + `pnpm db:seed` script + lokál első futtatás | `modelRouting` feltöltve PRD defaultokkal |
| 3 | `pipeline-phases.ts` — fázis 1-3 `generateObject` + grounding, fázis 4 `streamObject` progresszív streaminggel | Refaktorált `research-pipeline.ts`, SSE event shape változatlan kifelé |
| 3 | `research-pipeline.ts` SSE wrapper — új `synthesis_progress` event, Zod retry pattern, timeout handling | Pipeline end-to-end fut új SDK-val |
| 4 | Admin tRPC procedures: `admin.ai.listConfigs`, `admin.ai.setProviderKey`, `admin.ai.testProvider`, `admin.ai.updateRouting` | `AdminPanel` AI Config tab ténylegesen ír a DB-be |
| 4 | UI: `ResearchReport.tsx` "Dátum ismeretlen" fallback + i18n key (`report.sources.unknownDate`) | Riport nem törik el null `publishedAt`-tal |
| 4 | Integration tesztek min. 1 fázisonként, `test.skip` alap | `pnpm test:integration` fut manuálisan |
| 5 | Dokumentumok (PRD/UI spec/Handoff → v3.2) + changelog | Batch commit a 3 doc update-tel |
| 5 | Full E2E smoke (dog mascot → verdict → report) lokál + staging | Sprint DoD teljesítve |

### 11.1 DoD (Definition of Done)

- [ ] `pnpm check` 0 TypeScript hiba
- [ ] `pnpm test` minden unit teszt zöld (~17 meglévő + ~50 új)
- [ ] `pnpm test:integration` manuálisan zöld mind a 6 fázisra
- [ ] Manus `invokeLLM` hivatkozás sehol a `server/` alatt (kivéve deprecated alias, ha meghagyjuk)
- [ ] Admin UI-n beállított API kulcs + modelRouting változás tényleg hatással van a következő kutatás indításakor
- [ ] E2E: új kutatás → SSE streamel → Synthesis progresszívan megjelenik → verdict + radar kirajzolódik
- [ ] "Dátum ismeretlen" label megjelenik a forráskönyvtárban, ha null `publishedAt`

---

## 12. Doc update summary (C1 sprint végén, v3.2 batch)

### 12.1 PRD v3.2 (in-place update, changelog a tetején)

- **§2.3**: Grounding fázis 1-3-ra kiterjesztve (PRD v3.1: 1-2-re). `streamObject` Synthesis-re. Konkrét modellnevek (`gemini-2.5-flash`, `claude-sonnet-4-6`, `gpt-4.1-mini`).
- **§2.5**: Admin routing precedence pontosítva (DB→ENV fallback). `aiConfigs` és `modelRouting` táblák runtime-szemantikája.
- **§3.1**: API kulcs plain-text C1-ben, AES-256-GCM C2-ben (megjegyzés).
- **§4 Tech stack**: Vercel AI SDK (`ai` csomag + `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`) hozzáadva.

### 12.2 UI/UX spec v3.2

- **§3.6 Report View**: "Dátum ismeretlen" fallback null `publishedAt` esetén. Új SSE error state megjelenítés. Synthesis progresszív markdown streaming UX.

### 12.3 Handoff v3.2 — új szekciók

- **§11 Gemini Search Grounding integration** — groundingMetadata shape, extraction algoritmus, redirect URL kezelés, publishedAt limitáció
- **§12 LLM router architecture** — precedence, seeding, provider detekció
- **§13 Retry strategy** — Zod-error-aware retry pattern
- **§14 Streaming Synthesis** — `streamObject` partial pattern + SSE wrapper
- **§15 Decisions log** — a lenti 14 pont

---

## 13. Decisions log (C1 sprint döntések)

1. **C1/C2 bontás**: C1 = MVP (SDK csere + grounding + admin routing), C2 = enterprise hardening (fallback + encryption + prompt injection sanitization)
2. **Grounding scope**: fázis 1-3 (B opció); fázis 4 tisztán LLM
3. **Default modellek**: `gemini-2.5-flash` (1-3), `claude-sonnet-4-6` (4), `gpt-4.1-mini` (polling + brainstorm)
4. **Provider abstrakció**: Vercel AI SDK
5. **Routing precedence**: DB-first, ENV fallback
6. **Seeding**: `pnpm db:seed` külön idempotens parancs (nem automata `db:push`-ba épített)
7. **Provider detekció**: prefix-alapú modellnévből (nem explicit DB oszlop)
8. **Redirect URL**: `extractOriginalUrl()` try-atob → fallback raw; nincs network follow C1-ben
9. **`publishedAt`**: C1-ben null; UI "Dátum ismeretlen" fallback
10. **`classify.ts`**: seed domain listák, V2-ben admin-konfigurálható
11. **Sources forrás**: csak `groundingMetadata`-ból grounded fázisokban (LLM nem hallucinálhat forrásokat)
12. **Zod retry**: 1x, Zod error message beágyazva a retry promptba
13. **Timeout**: 120s (fázis 1-3) / 180s (synthesis) / 60s (polling + brainstorm)
14. **Synthesis streaming**: `streamObject` egy hívással (C opció), progresszív partial stream SSE-n keresztül

---

## 14. Kockázatok és mitigáció

| Kockázat | Valószínűség | Hatás | Mitigáció |
|---|---|---|---|
| Gemini redirect URL formátum változás | Közepes | Közepes (source URL pontatlan) | `try/catch` fallback raw tárolás + integrationtest follow-up |
| Vercel AI SDK breaking change | Alacsony | Magas | Lock pontos verzióra package.json-ban; V2 feature branch upgrade-hez |
| Modellnév prefix-ütközés (új provider) | Alacsony | Közepes | `detectProvider` throw-ol, explicit hibaüzenet; egy sor módosítás az új provider-hez |
| LLM output nagyon gyakran invalid (retry se elég) | Alacsony | Magas | Zod retry + error prompt 95%+ sikeres; ha nem, szigorúbb prompt engineering + példák a system promptban |
| Plain-text API kulcs DB-ben szivárog | Alacsony (csak admin DB hozzáférés) | Magas | C2 scope: AES-256-GCM envelope encryption; addig erős DB access control + backup encryption at rest |

---

## 15. Sikerkritérium (C1 sprint DoD)

A sprint **akkor kész**, ha:

1. Egy új Research indítása valódi Gemini (grounded fázis 1-3) és Claude Sonnet (fázis 4) hívásokat eredményez — **nem** Manus Forge proxy
2. Az admin felületen beállított új API kulcs / új modell a **következő** kutatás indulásakor élesedik
3. A forráskönyvtárban a Gemini Search által visszaadott valódi webes URL-ek jelennek meg (nem LLM-hallucinált)
4. A Synthesis fázisban a riport markdown progresszívan, SSE-n keresztül jelenik meg (nem 180s vakvárakozás)
5. Zod validation error esetén 1x retry után a pipeline sikerrel zárul (90%+ ráta a valós használatban)
6. A 17 meglévő vitest teszt + ~50 új unit teszt mind zöld
7. A 3 doc update (PRD/UI spec/Handoff → v3.2) committálva
