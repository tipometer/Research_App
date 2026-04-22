# Sprint 1 — Demo-Quality Product Design

**Verzió:** 1.0
**Dátum:** 2026-04-22
**Scope:** Launch runway első sprint — a Validation Workspace backend foundation (PR #13-#14) láthatóvá tétele a frontenden + két tartalmi blocker (P1 API keys, P2 radar score kalibráció) fix, hogy a termék **belső demóra kész** legyen.
**Kontextus:** Deep Research app, A-út (narrow niche app) launch-ready döntés megtörtént; beta feedback informálja a post-beta pivot-ot. Jelen sprint a 3-sprint launch runway első eleme (Sprint 2: public-ready shell — auth/legal/observability; Sprint 3: payment + production + Számlázz.hu).
**Előzmény:** Validation Workspace backend foundation sprint zárva 2026-04-21 (PR #13, #14). `evidence` + `decision_snapshots` táblák, `SynthesisSchema` bővítés, `validation.*` tRPC router, graceful-degraded pipeline hook mind aktív és staging-en igazolt.

---

## 1. Vezetői összefoglaló

A backend már strukturáltan tárolja az evidence-eket és a decision snapshot-okat (positiveDrivers, negativeDrivers, missingEvidence, nextActions + synthesisClaims), de a frontend még a klasszikus riport-nézetet mutatja — ez parkoló tőke. Sprint 1 célja, hogy a user **láthatóvá tegye** a "validation engine" pozicionálást, **minimum risk** mellett: 3-4 új panel a `ResearchReport.tsx` meglévő oldalára (nem új navigáció), dimenzió-csoportosított forráskártyák a meglévő Források tab-on, továbbá két megkerülhetetlen content blocker (P1 API keys staging-en, P2 uniform 10/10 radar score) fix.

**Három kulcs tervezési döntés:**

1. **UI option (a), nem (b/c).** A radar alatt, a tabok felett egy "Decision context" blokk (4 panel), **nem új tab vagy IA refaktor**. A (b) Workspace tab és (c) teljes IA átalakítás pre-beta spekuláció — a beta feedback mondja meg, érdemes-e. A (a) value delta a user felé megegyezik (radar alatti panelek egyből kommunikálják a "validation engine" érzést), de a kockázat és a munkaigény töredéke.
2. **P2 prompt-only rubric, nem DecisionEngine.** A score kalibrációt a synthesis prompt-ba tett 5 dimenziós rubric anchor-okkal oldjuk meg. Determinisztikus policy layer (`VerdictPolicy`, `DecisionEngine`) **out-of-scope** — a refaktor doksi Sprint 4-re tervezett anyaga. LLM marad a verdict forrása.
3. **Verifikáció a meglévő 2 fixture-rel, fine-tune real user data-val.** A P2 benchmark a PR #13-ban landolt 2 CP2 fixture (random niche-ok). Pre-launch smoke: variance > 3 pont legalább az egyiken. Fine-tune post-beta real user run-okkal — nem költünk extra AI-t szintetikus test niche-okra.

A sprint végén a termék **belső demóra kész**, de **nem public**: az auth még `dev-login` (Sprint 2 hozza a Google OAuth-ot), payment még stub (Sprint 3), legal még placeholder (Sprint 2). A Sprint 1 DoD teljesülésével a Sprint 2 public-ready shell munka elindítható.

---

## 2. Scope & Non-scope

### 2.1 Scope

- P1: AI API keys (Gemini, Anthropic, OpenAI) Secret Manager-be és a staging Cloud Run workflow-ba
- P2: synthesis prompt scoring rubric bővítés 5 dimenzióra anchor-okkal
- 4 új decision panel a `ResearchReport.tsx`-en (positiveDrivers, negativeDrivers, missingEvidence, nextActions)
- Dimenzió-chip filter a meglévő Források tab-on
- HU + EN i18n új kulcsok
- Frontend unit/integration tesztek + manuális staging smoke

### 2.2 Non-scope (explicit NE)

- Új navigáció / tab struktúra átalakítás (option b/c)
- `DecisionEngine` / `VerdictPolicy` / `ScoreCalculator` osztályok (refaktor doksi Sprint 4)
- Survey → evidence ingestion, `validation.recompute` endpoint (post-beta)
- Decision delta / snapshot diff view UI (post-beta)
- Google / Facebook / LinkedIn OAuth (Sprint 2)
- Stripe Checkout + webhook + Számlázz.hu (Sprint 3)
- Legal oldalak (ÁSZF, adatkezelési tájékoztató, cookie consent) (Sprint 2)
- Sentry / analytics / transactional email (Sprint 2)
- Production Cloud Run env + custom domain + SSL (Sprint 3)
- GDPR account delete + data export endpoint (Sprint 2)
- SSE progress UI átdolgozás (post-beta)
- Meglévő synthesis pipeline architektúra módosítás (csak prompt additív bővítés)
- Régi research-eken visszamenőleges snapshot generálás (pre-PR #13 research-ek változatlanul működnek)

---

## 3. Komponensek

### 3.1 P1 — AI API keys staging Secret Manager-ben

**Feladat:**
- `gcloud secrets create gemini-api-key`, `anthropic-api-key`, `openai-api-key` létrehozás (Google Secret Manager)
- Staging runtime service account (`cloud-run-runtime-sa`) kap `secretAccessor` role-t mindhárom secret-re
- `.github/workflows/deploy-staging.yml` `--set-secrets` bővítés 3 új bejegyzéssel (mintaminta: `GEMINI_API_KEY=gemini-api-key:latest`)
- `.env.local.example` frissítés (dokumentáció, nincs érték)

**Architektúra kontextus:**
A C1 óta érvényes DB-first, ENV fallback minta változatlan: a provider kulcsok elsődlegesen a TiDB `aiConfigs` táblából jönnek (`ENC1:` ciphertext). A Secret Manager-beli ENV változatok **fallback**-ként működnek, amikor a DB-ben még nincs admin által feltöltött kulcs — ez a staging/prod bootstrap forgatókönyv. Az infra-foundation spec §2 és §3 dönt erről. Jelen sprint csak a fallback eddig hiányzó oldalát pótolja.

**Out-of-scope:**
- Prod secret-ek létrehozása (Sprint 3 `deploy-prod.yml`-lel együtt)
- DB-beli `aiConfigs` rekordok seed-je (admin feladat)

### 3.2 P2 — Synthesis scoring rubric

**Feladat:**
- `server/ai/pipeline-phases.ts` `runPhase4Stream` synthesis user prompt additív bővítés: **5 dimenziós scoring rubric blokk**, dimenziónként **3 anchor point**-tal (pl. 9-10 / 5-6 / 1-2 leírások)
- Meglévő prompt szerkezet **változatlan**, csak egy új blokk appendelődik (mintaminta: PR #13 "positiveDrivers/negativeDrivers" bővítés módszertana)
- A meglévő `clampSynthesisOutput` + `clamp10()` **változatlan** — elégséges guardrail a post-parse-nál

**Rubric példa (market_size dimenzió):**
- 9-10: $1B+ global TAM, triangulált forrásokkal (min. 2 független piacvizsgálat)
- 5-6: plauzibilis niche, de a számok hand-wavy vagy LLM-becslés
- 1-2: nincs piaci evidence, csak anekdota vagy spekuláció

Minden dimenzió kap hasonló 3-anchor skálát; a prompt szöveg magyar vagy angol ugyanazt a rubric-et tartalmazza (a meglévő synthesis prompt nyelvi sémáját követve).

**Verifikáció:**
- 2 meglévő CP2 fixture (`synthesis-output-beer-dumbbell-coach.json`, `synthesis-output-b2b-contract-reviewer-hu.json`) rerun: az új prompt-tal a score-ok **variance > 3 pont** legalább egyikükön. Ha mindkettő uniform → prompt-iterálás, nem release-elhető.
- Lokális smoke script (`server/ai/__scripts__/smoke-synthesis.ts` bővítés): rerun + assert variance

**Out-of-scope:**
- Determinisztikus policy layer (refaktor doksi §5, Sprint 4)
- Dimension weight tuning (egyelőre minden dimenzió egyforma súllyal)
- Score delta / diff logic (post-beta)

### 3.3 Decision context blokk — 4 új panel

**Helye:** `client/src/pages/ResearchReport.tsx`, a meglévő radar `CardContent` alatt és a `Tabs` component felett (kb. line 278-300 között új `section` vagy `div` elem).

**Layout:** 2×2 CSS Grid (`grid-cols-2 md:gap-4`), `≤768px` alatt `grid-cols-1`. Minden panel egy `Card` komponens (shadcn/ui mintára, már importálva a fájlban).

**4 panel — adatkötés `snapshot`-ra:**

| Panel ID | i18n címke | Adatforrás | Cardinalitás | Icon | Badge szín |
|---|---|---|---|---|---|
| `positive-drivers` | `report.decision.positiveDrivers` ("Mi húzta fel a score-t" / "What boosted the score") | `snapshot.positiveDrivers[]` | 2-5 | `CheckCircle2` | zöld |
| `negative-drivers` | `report.decision.negativeDrivers` ("Mi húzta le" / "What weakened it") | `snapshot.negativeDrivers[]` | 2-5 | `AlertTriangle` | piros |
| `missing-evidence` | `report.decision.missingEvidence` ("Mi hiányzik még" / "Missing evidence") | `snapshot.missingEvidence[]` | 0-7 | `HelpCircle` | sárga |
| `next-actions` | `report.decision.nextActions` ("Következő lépések" / "Next actions") | `snapshot.nextActions[]` | 3-5 | `ArrowRight` | kék |

**Fallback:** ha `validation.getSnapshot` `NOT_FOUND`-ot dob (régi research, pre-PR #13), a teljes blokk **nem renderelődik** (conditional render, nincs placeholder, nincs skeleton, nincs error toast). A régi oldal layout pixel-identikusan marad.

**Empty state:** új research, ahol a snapshot van, de pl. `missingEvidence.length === 0` → az adott panel egy "Nincs azonosított hiányosság" szöveggel jelenik meg (i18n-aware), a többi 3 panel normálisan renderelődik. Ha `positiveDrivers.length === 0` (ami a schema min. 2 miatt nem fordulhat elő valid output-ban), akkor is render-el az üres állapot — ezzel védhető a malformed edge case.

### 3.4 Dimenzió-csoportosított forráskártyák

**Helye:** `client/src/pages/ResearchReport.tsx`, a meglévő `TabsContent value="sources"` tartalmának **felső szekcióba** új row: dimension chip row (5 chip + "Mind").

**Adatkötés:** `trpc.validation.getEvidenceByDimension.useQuery({ researchId })` → `Record<Dimension, Evidence[]>`. Lazy-loaded: csak akkor hívódik, amikor a "Források" tab aktívvá válik (`useEffect` a tab switch-en vagy `enabled: activeTab === "sources"`).

**Chip viselkedés:** client-side filter state. Alapértelmezett: "Mind" (teljes lista). Chip click → csak a chosen dimension `Evidence[]` array-e látszik. Több chip nem kombinálódik (single-select).

**Mind chip tartalom:** a **meglévő `research.sources` array** (ami most is működik) — nem csak a `validation.*` endpoint eredménye. A `web_source` evidence-ek `dimensions=[]` (closeout doc §8), ezért a chipekre nem jelennek meg, de a "Mind" nézet az már működő sources array-ből mehet. Ez kompatibilitási biztosíték.

**Error fallback:** ha `validation.getEvidenceByDimension` hibát dob → a chipek **nem jelennek meg**, a Források tab a meglévő `research.sources` array-vel rendereli magát (mintaminta: a backend mapper graceful degradation mintáját tükrözi a frontend oldalon).

### 3.5 i18n bővítés

**Új kulcsok (HU + EN):**
- `report.decision.blockTitle` — blokk fejléc (opcionális, lehet nincs is cím)
- `report.decision.positiveDrivers.title` + `.empty`
- `report.decision.negativeDrivers.title` + `.empty`
- `report.decision.missingEvidence.title` + `.empty`
- `report.decision.nextActions.title` + `.empty`
- `report.sources.dimensionChips.all`
- `report.sources.dimensionChips.marketSize|competition|feasibility|monetization|timeliness`

**Helye:** a projektben meglévő i18n mechanizmus szerint (react-i18next, a `useTranslation` hook mintázata látszik a `ResearchReport.tsx`-en). Valószínűleg `client/src/i18n/hu.ts` + `en.ts` vagy hasonló — a `file-reader` subagent a Nap 1 discovery-ben megállapítja.

---

## 4. Data flow + error handling

### 4.1 Happy path (új research, post-PR #13)

```
ResearchReport mount (researchId in URL)
  │
  ├─ trpc.research.get({id})                          [meglévő, ~200ms]
  │     └─ radar, verdict, sources array, reportMarkdown
  │
  ├─ trpc.validation.getSnapshot({id})                [új, párhuzamos, ~100ms]
  │     └─ positiveDrivers, negativeDrivers, missingEvidence, nextActions
  │     └─ snapshot loaded → 4 új panel render
  │
  └─ trpc.validation.getEvidenceByDimension({id})     [új, lazy, csak Források tab aktív]
        └─ Record<Dimension, Evidence[]>
        └─ dimension chipek enabled, filter működik
```

Minden három query **független**, párhuzamosan futnak, independent loading state-ek.

### 4.2 Fallback 1: régi research, nincs snapshot

```
research.get({id})              → success (classic report data)
validation.getSnapshot({id})    → NOT_FOUND (no decision_snapshots row)
```

→ 4 panel blokk **nem renderelődik** (conditional render). Régi layout pixel-identikus. Nincs skeleton, nincs error toast, nincs console.error prod-on.

### 4.3 Fallback 2: snapshot exists, evidence endpoint error

```
research.get({id})                        → success
validation.getSnapshot({id})              → success
validation.getEvidenceByDimension({id})   → INTERNAL_ERROR vagy timeout
```

→ 4 panel normálisan renderelődik (snapshot van). Dimension chipek **nem jelennek meg** a Források tab-on, a forráslista a meglévő `research.sources` array-ből megy (ami már most is működő állapot). Structured log (client-side: csak dev-ben console.error, prod-on silently).

### 4.4 Loading state-ek

- **`research.get` loading**: meglévő skeleton-ok maradnak, változatlan viselkedés
- **`validation.getSnapshot` loading**: 4 panel helyén `Skeleton` komponens (shadcn), 2×2 grid layout megőrzése; a radar és tabok már interaktívak
- **`validation.getEvidenceByDimension` loading**: dimension chipek **disabled** state + skeleton a forráslistán

### 4.5 Error / authz

- **FORBIDDEN (IDOR)** a `validation.*`-on: ugyanaz a middleware, mint a `research.get`-en — user ugyanaz az "Access denied" oldalra kerül. Nincs új error path.
- **UNAUTHORIZED**: auth redirect, meglévő viselkedés.
- **Validation endpoint INTERNAL_ERROR**: silent fallback (4.2, 4.3).

### 4.6 P2 rubric output parsing

A synthesis output változatlan schema-val validálódik (`SynthesisSchema`). A `clampSynthesisOutput` + `clamp10()` minden score-t 0-10 közé kényszerít, ha a rubric után valami kilógna — **nincs új validation logic** szükséges, a meglévő post-parse clamp elég.

### 4.7 SSE progress UI

**Változatlan.** A live run progress pipeline-ban már most is történik snapshot persist a completion hook-ban (PR #13 Step A2). A ResearchReport csak a már kész snapshot-ot kéri le — nincs új SSE esemény-típus, nincs új progress UI.

---

## 5. Testing

### 5.1 Backend unit tesztek (új)

**`server/ai/pipeline-phases.test.ts`** (meglévő fájl bővítése):
- `synthesis prompt includes scoring rubric block with 5 dimensions and 3 anchor points each` — snapshot/substring match a promptban
- (integration, manuálisan futtatva, nem CI-ben, `RUN_LIVE_AI=1` gated):
  - `CP2 fixture rerun — beer-dumbbell-coach — score variance > 3 points`
  - `CP2 fixture rerun — b2b-contract-reviewer-hu — score variance > 3 points`

### 5.2 Frontend tesztek — OUT OF SCOPE

**Döntés:** a projekt jelenleg nem rendelkezik React Testing Library / jsdom infrastruktúrával (a `vitest.config.ts` csak `server/**/*.test.ts`-re szűkített, `package.json`-ben nincs RTL dep). Frontend unit/integration tesztek ezért **Sprint 1-ben out-of-scope**. Backlog ticket nyílik (RTL + jsdom + vitest config bővítés) post-beta időszakra.

A validáció Sprint 1-ben:
- **TypeScript strict + `tsc --noEmit`** fogja a compile-time hibákat (meglévő)
- **Manuális staging smoke §5.3** fogja a runtime viselkedést (happy path, fallback, mobile)
- A meglévő 278 backend tesztnek **változatlanul** zöldnek kell maradnia

Ez a Sprint 1 launch-first filozófiájával konzisztens: a frontend viselkedés UX-heavy, a kicsi scope (3-4 panel + chip filter) manuális smoke-kal megbízhatóan validálható, a frontend teszt-infra felépítése post-beta real user feedback után relevánsabb.

### 5.3 Manuális staging smoke

Checkpoint 3 gate (§7.3) előtt:
1. 1 új research HU prompt-on → 4 panel megjelenik HU szövegekkel
2. 1 új research EN prompt-on → 4 panel megjelenik EN szövegekkel
3. 1 régi research (pre-PR #13, pl. researchId=1 vagy 2 staging DB-n) → 4 panel **nem** jelenik meg
4. Dimension chip toggle: 5 chip egyenként → sourceList szűkül; "Mind" → teljes lista
5. Mobile viewport (375px Chrome DevTools): 2×2 grid → 1 oszlop, forráslista scrollol
6. Browser DevTools Network tab: `validation.getSnapshot` + `validation.getEvidenceByDimension` párhuzamosan indulnak (nem sorosan)

### 5.4 Regression coverage

- `pnpm test` → 278 meglévő backend teszt + új frontend tesztek → mind zöld
- `pnpm check` (`tsc --noEmit`) → 0 error
- Meglévő `validation.router.test.ts` 14 teszt → változatlanul zöld
- Meglévő `synthesis-to-evidence-mapper.test.ts` 20 teszt → változatlanul zöld

---

## 6. Definition of Done

Sprint 1 akkor tekinthető késznek, ha **mind a 7 feltétel** teljesül:

1. **P1 staging secrets zöld**: 3 API key Secret Manager-ben, bekötve `deploy-staging.yml`-be, és **1 end-to-end staging research** Phase 1-3-on sikeresen átmegy (nem hal el `No API key configured for provider: gemini` vagy hasonló errorral)

2. **P2 rubric deployolva és differenciál**: 2 CP2 fixture rerun-nál a score variance **> 3 pont** legalább az egyiken. Ha mindkettő uniform → prompt-iterálás, nem release-elhető

3. **4 decision panel új research-en zöld**: staging env-ben frissen futott research-re a `ResearchReport.tsx` mind a 4 panelt rendereli, HU + EN i18n-aware szövegekkel; adatok a `validation.getSnapshot` válaszából kötődnek

4. **Régi research változatlan**: pre-PR #13 research megnyitása pixel-identikus viselkedést mutat (4 panel **nem** jelenik meg, 3 tab változatlan, layout shift nincs, console error prod-on nincs)

5. **Dimension-grouped sources működik**: a Források tab-on 5 dimenzió chip + "Mind", filter kliens-oldalon szűr, `validation.getEvidenceByDimension` error esetén graceful fallback (meglévő `research.sources` array)

6. **Tesztek zöldek**: meglévő 278 backend teszt változatlanul zöld, `server/ai/pipeline-phases.test.ts` bővített (min. 1 új teszt a rubric prompt substring-re), `tsc --noEmit` clean. Frontend unit tesztek out-of-scope (lásd §5.2)

7. **Mobile-responsive**: ≤768px viewport → 4 panel 1 oszlopba rendeződik, dimension chipek wrap-elnek vagy horizontal scroll, nincs overflow

---

## 7. Sprint task-bontás (5-7 munkanap becslés)

### Nap 1 — Discovery + Plan
- `file-reader` subagent (Haiku) → `ResearchReport.tsx`, `client/src/i18n/` struktúra feltárás, meglévő tab/card minta
- 1 oldalas plan írás: mit csinálsz milyen sorrendben
- **STOP: user plan review + jóváhagyás**

### Nap 2 — P1 (Secret Manager + workflow)
- `gcloud secrets create` × 3
- `deploy-staging.yml` `--set-secrets` bővítés
- Staging deploy + smoke test (csak a key-ek elérhetőségét ellenőrzi, nem teljes research run)
- Commit + PR

### Nap 3 — P2 (synthesis rubric + verifikáció)
- `pipeline-phases.ts` rubric bővítés (5 dim × 3 anchor)
- `smoke-synthesis.ts` CP2 fixture rerun script (ha még nincs)
- **Checkpoint 1 (user): 2 fixture output variance review** — ha uniform, prompt-iterálás
- Commit

### Nap 4 — Decision panel komponensek + i18n
- 4 új panel komponens (`client/src/components/decision/` új mappa vagy inline)
- i18n kulcsok HU + EN
- Snapshot fetch integrate `ResearchReport.tsx`-be
- Fallback 1 & 2 verifikáció (lokális dev env, régi research ID-n)
- `tsc --noEmit` + manuális browser smoke

### Nap 5 — Dimension-grouped sources
- Dimension chip komponens + filter state
- `validation.getEvidenceByDimension` integrate, lazy load
- Fallback 3 verifikáció (endpoint kommentelve → graceful fallback)
- `tsc --noEmit` + manuális browser smoke

### Nap 6 — Staging smoke + Definition of Done
- Merge master, deploy staging
- Manuális smoke §5.3 minden pont
- **Checkpoint 2 (user): staging smoke eredmények review**
- DoD 7 pont ellenőrzés

### Nap 7 — Buffer + closeout
- Bug fixek ha kellenek
- Closeout doc `docs/deployment/sprint1-demo-quality-closeout-2026-04-29.md` (vagy aktuális dátum)
- Cost report (Opus/Sonnet/Haiku token-használat)
- Sprint 2 kickoff handoff

**Becslés konzervatívan 7 nap, reálisan 5-6 nap. Ha a P2 prompt-iterálás 2 körnél tovább tart → Checkpoint 1-nél üzleti kérdés a user-nek.**

---

## 8. Business reviewer checkpoint-ok

### Checkpoint 1 (Nap 3 vége): P2 rubric output review
**Mit nézz:** 2 fixture (beer-dumbbell-coach, b2b-contract-reviewer-hu) új scoring output-ja.
**Mit értékelj:** a score-ok **differenciálnak-e** (nem uniform 10/10)? A `positiveDrivers` és `negativeDrivers` kötődnek-e a score-hoz logikusan?
**Döntés:** ha igen → tovább; ha uniform marad → prompt-iterálás, Claude Code autonóm módon tovább próbál.

### Checkpoint 2 (Nap 6 vége): Staging smoke review
**Mit nézz:** Claude Code végigfuttat staging-en 1 új research-et HU, 1-et EN-en, és megmutatja neked a ResearchReport oldalt.
**Mit értékelj:**
- A 4 panel **érthető mondatokat** tartalmaz, nem szótárfordítás?
- A dimension chip click tényleg szűkíti a forráslistát?
- Régi research úgy néz ki, mint eddig?
**Döntés:** ha igen → DoD signed off; ha nem → bug fix round.

### Checkpoint 3 (Nap 7 vége): Sprint closeout
**Mit nézz:** closeout doc + cost report.
**Döntés:** Sprint 2 kickoff mehet, ha minden DoD zöld.

---

## 9. Constraints (változatlanul érvényesek)

- Server-only AI execution (C1 minta)
- Drizzle ORM only, no raw SQL
- Zod validation minden új client/server határon
- IDOR-check minden új query-re (a `validation.*` endpointok már jók, csak a frontend használja őket)
- Audit log nem szükséges read-only frontend query-khez (a backend már loggol snapshot creation-t)
- Meglévő auth/billing/AI routing/fallback érintetlen (PR #13-#14 óta érvényes tiltások)
- No új dependency — a shadcn/ui, lucide-react, recharts, Tabs mind már megvan

---

## 10. Függőségek a Sprint 2-3-ra

- **Legal (Sprint 2) előfeltétele a FB/LinkedIn OAuth review submission-nek** — a Privacy Policy URL-nek publikusan elérhetőnek kell lennie a review indulásához. Ez miatt legal Sprint 2 elején indul.
- **Custom domain (Sprint 3 Day 1 indítva) → DNS propagáció és SSL cert ~1-2 nap** — Sprint 3 kritikus úton.
- **Számlázz.hu API integráció (Sprint 3)**: Stripe webhook → credit ledger update → Számlázz.hu API invoice create → email küldés. A transactional email (Sprint 2) függősége.

Sprint 1 semmilyen külső review-re nem vár, teljes egészében belső work.

---

## 11. Kockázatok

| Kockázat | Valószínűség | Impact | Mitigation |
|---|---|---|---|
| P2 prompt-iterálás több kör → Nap 3 csúszik | közepes | közepes | Checkpoint 1 user decision gate; ha 2 kör után sem megy, business gate arra, hogy post-beta fine-tune (ship uniform-ot vagy ship kisebb variance-t) |
| `validation.getEvidenceByDimension` backend bug → dimenzió chipek soha nem jelennek meg | alacsony | alacsony | Fallback 3 (graceful degradation) a frontend oldalon |
| i18n új kulcsok lemaradnak EN-ből → user-facing magyar szöveg angol UI-on | alacsony | közepes | i18n snapshot teszt (§5.2), manuális smoke mindkét nyelven |
| 2×2 grid mobile layout-ja összeomlik → nem olvasható | alacsony | közepes | Manuális mobile viewport smoke §5.3 pont 5 |
| Új research staging-en nem fut le a P1 utáni első próbán (pl. egyik AI provider key rossz formátumú) | közepes | magas | Per-provider smoke a P1-ben: `gcloud secrets create` után egyesével curl-lel ellenőrizni (nem mind egyszerre, hogy a hiba izolálható legyen) |

---

## 12. Implementációs hivatkozások

- Meglévő synthesis schema + pipeline: `server/ai/schemas.ts`, `server/ai/pipeline-phases.ts`
- Backend `validation.*` router: `server/validation.router.ts` (endpoints: `getSnapshot`, `listEvidence`, `getEvidenceByDimension`)
- Backend mapper: `server/synthesis-to-evidence-mapper.ts`
- Backend pipeline hook (Step A2): `server/research-pipeline.ts`
- Frontend report page: `client/src/pages/ResearchReport.tsx` (542 sor, 3 tab: Riport / Források / Emberi Kutatás)
- tRPC auto-type export: `AppRouter` — a frontend már rendelkezik a `validation.*` procedure type-okkal (closeout doc §8)
- PR #13 zárás: `docs/deployment/cp3-validation-workspace-closeout-2026-04-21.md`
- Infra staging (DB-first, ENV fallback minta): `docs/superpowers/specs/2026-04-20-infra-foundation-staging-design.md`
- Refaktor doksi (Sprint 4+ anyag, NE implementáld ebben): `../../Deep Research app refaktor.md`
