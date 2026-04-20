# Frontend Integration Tier 1 — Design Spec

**Verzió:** 1.0
**Dátum:** 2026-04-20
**Scope:** T1 of Frontend Integration sub-project — `NewResearch.tsx` + `Dashboard.tsx` wire-up to existing tRPC backend.
**Kontextus:** Deep Research app, a Manus → natív migráció következő sub-projektje a **Infra Foundation** sprint után. Az Infra Foundation smoke-test (Task 11) felfedezte, hogy a frontend ~40% mock scaffolding (nem valódi tRPC hívások) — a backend ellenben teljesen wire-upp + verified. Ez a spec a research testing-et unblock-olja 2 oldal minimal wire-up-jával.
**Előzmény:** Infra Foundation sprint merged 2026-04-20 (PR #7-12, staging deploy + C2b live verified + trust proxy fix). Backend tRPC procedures létező és tesztelt: `research.{list,get,create,delete}`, `user.{credits,transactions}`, `survey.*`, `brainstorm.*`, `admin.ai.*`.

---

## 1. Vezetői összefoglaló

A Deep Research frontend két kritikus oldala — `NewResearch.tsx` és `Dashboard.tsx` — jelenleg **prototype mock scaffolding** a kezdeti Manus codebase-ből: hardcoded tömbök, `setTimeout(navigate)` helyett valós backend hívások. Ez a sprint minimális scope-ban (T1) mindkettőt drótozza a már meglévő tRPC procedure-okhoz, hogy a research flow **élesen tesztelhető** legyen a staging-en.

A Infra Foundation sprint-ből felfedezett pozitívum: **backend teljes**, a pipeline + encryption működik (`ENC1:` ciphertext a DB-ben, 220 passing teszt). A gáp a frontend wire-up-ban van. Ez a sprint kitölti ezt a réstek T1 szintjén (T2 Billing+Survey és T3 Profile+Admin-Users későbbi sprintek).

Két kulcs tervezési döntés:

1. **Minimal scope (T1 only).** NewResearch + Dashboard, + test infrastructure setup. Billing/Survey/Profile oldalak MOCK-ban maradnak, külön sprintben drótozzuk. Inkrementális, nem big-bang.

2. **Test infrastructure felállítása (RTL + MSW) most.** 220 passing backend teszt mellett 0 frontend teszt jelenleg. MSW-alapú tRPC mock teszt pattern felállítva itt → T2/T3 sprint tudnak rá építeni, nem kell minden jövőbeli frontend sprintben újraépíteni.

Testing filozófia: a user memóriájában rögzített "integration tests must hit a real database, not mocks" elv itt frontend context-ben MSW mock-ot használ (nem real tRPC server) mert: (a) Playwright E2E significantly nagyobb commitment a scope-hoz képest, (b) a staging smoke-test adja a valós E2E coverage-et, (c) MSW tesztek a komponens-szintű UI logic-ot verify-álják (state management, error handling, routing) — nem a backend contract-ot. Backend contract-ot a 220 passing backend teszt fedi.

---

## 2. Scope & Non-scope

### 2.1 In scope

**Kód módosítások:**
- `client/src/pages/NewResearch.tsx` — `handleStart` refactor `setTimeout(navigate)` helyett `trpc.research.create.useMutation`-re; credits display cserélés `trpc.user.credits.useQuery`-re; error handling (PAYMENT_REQUIRED, network)
- `client/src/pages/Dashboard.tsx` — `mockResearches` tömb cserélés `trpc.research.list.useQuery`-re; hardcoded credits (12) cserélés `trpc.user.credits.useQuery`-re; stats derivation (count, GO verdict count); loading/empty/populated/error state handling

**Új teszt infrastruktúra:**
- Dev deps: `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `msw`, `jsdom`
- `vitest.config.ts` patch: `setupFiles` + test file convention
- `client/src/__tests__/setup.ts` — jest-dom matchers + MSW server hooks
- `client/src/__tests__/mocks/server.ts` — MSW `setupServer`
- `client/src/__tests__/mocks/handlers.ts` — tRPC batch-format handlers + `mockTrpcQuery`/`mockTrpcMutation` helpers

**Új teszt file-ok (~13 teszt):**
- `client/src/pages/NewResearch.test.tsx` — 7 teszt (render, credits display, validation, submit success, error paths)
- `client/src/pages/Dashboard.test.tsx` — 6 teszt (loading/empty/populated, stats, navigation)

**Docs:**
- `docs/deployment/dev-credits-seed.md` — operational SQL UPDATE runbook credits seeding-hez
- Smoke-test success record post-deploy (Task 5)

**i18n kulcsok:** 5-7 új kulcs a `client/src/i18n/{hu,en}.ts`-be (newResearch.created, dashboard.empty.title/subtitle/cta, dashboard.error.title/retry)

### 2.2 Out of scope

| Sub-projekt / feature | Miért külön |
|---|---|
| **Tier 2** `Billing.tsx` + `SurveyPage.tsx` wire-up | Nem blokkolja a research testing-et; follow-up Frontend Integration sprint |
| **Tier 3** `Profile.tsx` + AdminPanel Users/Audit tabs | Backend bővítést is igényel (`user.update`, `admin.users.list`, `admin.audit.list` procedures új); saját sprint |
| `humanResearchEnabled` checkbox automation | Post-research auto-survey creation; future sprint |
| `research.delete` / share UI | `research.delete` backend létezik, frontend UI nincs; T2/T3 scope |
| SSE retry / pipeline fail recovery | `ResearchProgress.tsx` már wire-upp, külön reliability-concern |
| Pagination | `research.list` jelenleg unlimited; YAGNI, future ha >20 research scenario |

### 2.3 Success criteria

1. **Test suite:** 220 passing (jelenlegi baseline) + 13 új frontend teszt = **~233 passing**, tsc clean
2. **Staging deploy:** a sprint-branch merge → `deploy-staging.yml` zöld → új Cloud Run revision Ready
3. **Live smoke:** staging-en a §7 protokoll minden 7 checkpoint-ja ✅
4. **DB evidence:** research flow után `SELECT ... FROM researches` a valós row-t adja vissza (userId, nicheName, strategy, shareToken 32-char), credits deduction sikerült (`users.credits`: 100 → 99 after 1 non-batch research)
5. **Error paths verified:** insufficient credits → toast (nem crash, nem redirect invalid URL-re), network error → toast + button re-enabled

---

## 3. Pre-implementation checklist (Task 0)

Minimal pre-work — jelentős audit már megvolt az Infra Foundation Task 11 smoke-test során (dokumentálva `docs/deployment/smoke-test-c2b-run-2026-04-20.md`). Ez a sprint kiegészíti:

**Task 0.1 — Verify backend procedure shapes:** grep `server/routers.ts` — confirm unchanged:
- `research.create` input: `{ nicheName: string(3-256), description?: string(max 2000), strategy: "gaps"|"predator"|"provisioning", batchMode?: boolean }`, returns `{ id: number, shareToken: string }`, throws `PAYMENT_REQUIRED` on insufficient credits (cost = 1 normal, 3 batchMode)
- `research.list` input: `undefined`, returns `Research[]` (user-scoped)
- `user.credits` input: `undefined`, returns `{ credits: number }`

Bármelyik eltérés → spec update előre, nem implementáció közbeni meglepetés.

**Task 0.2 — Verify client tRPC setup:** `client/src/lib/trpc.ts` létezik + `createTRPCReact<AppRouter>()` wired. Ha nem — Infra Foundation audit already confirmed ezt.

**Task 0.3 — Verify form state in NewResearch.tsx:** jelenlegi form fields: `nicheName`, `description`, `selectedStrategy` (or similar), `batchMode`, `humanResearchEnabled`. Ha `selectedStrategy` mappingje nem közvetlen a backend enum-jához (pl. "Quick"/"Deep"/"Predator" UI labels vs `"gaps"/"predator"/"provisioning"` backend values), külön mapper kell a Task 2-ben.

**Task 0 acceptance:** `docs/deployment/t1-frontend-integration-task-0-audit.md` committed file 3 audit output-szal.

---

## 4. `NewResearch.tsx` wiring

### 4.1 Jelenlegi állapot

`client/src/pages/NewResearch.tsx` lines 55-72:
```typescript
const creditCost = (batchMode ? 3 : 1) + (humanResearchEnabled ? 0 : 0);
const userCredits = 12; // mock

const handleStart = async () => {
  if (!nicheName.trim()) { toast.error("A niche neve kötelező!"); return; }
  if (userCredits < creditCost) { toast.error(t("newResearch.insufficientCredits")); return; }
  setIsLoading(true);
  setTimeout(() => { navigate("/research/demo/progress"); }, 500);
};
```

### 4.2 Target állapot

```typescript
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";

const creditsQuery = trpc.user.credits.useQuery();
const userCredits = creditsQuery.data?.credits ?? 0;
const creditCost = batchMode ? 3 : 1;

const createMutation = trpc.research.create.useMutation({
  onSuccess: ({ id }) => {
    toast.success(t("newResearch.created") || "Kutatás elindítva");
    navigate(`/research/${id}/progress`);
  },
  onError: (err) => {
    if (err instanceof TRPCClientError && err.data?.code === "PAYMENT_REQUIRED") {
      toast.error(t("newResearch.insufficientCredits") || "Nincs elég kredit");
    } else {
      toast.error(t("common.unknownError") || "Hiba történt");
    }
  },
});

const handleStart = () => {
  if (!nicheName.trim()) {
    toast.error(t("newResearch.nicheRequired") || "A niche neve kötelező!");
    return;
  }
  if (userCredits < creditCost) {
    toast.error(t("newResearch.insufficientCredits") || "Nincs elég kredit");
    return;
  }
  createMutation.mutate({
    nicheName: nicheName.trim(),
    description: description.trim() || undefined,
    strategy: selectedStrategy, // UI→backend mapping if needed per Task 0.3 audit
    batchMode,
  });
};
```

### 4.3 Loading state

`createMutation.isPending` cseréli `isLoading` local state-et:
- Button disabled during mutation
- Inline spinner (existing shadcn/ui pattern)
- Form inputs disabled → nem módosíthatók close-mid-mutation

### 4.4 `humanResearchEnabled` kezelése

UI-ban marad, checkbox state csak — NEM küldjük backend-re (nincs research.create input field). Dokumentálva code comment-ben hogy "future sprint: post-research auto-survey trigger". Ez kompatibilitást tart a UI design-nal minimal changes-szel.

### 4.5 Strategy UI→backend enum mapping (confirmed: no mapper needed)

Verified during spec review (2026-04-20): `NewResearch.tsx:44` already stores backend enum values directly (`"gaps" | "predator" | "provisioning"`) in state. UI button labels are translated via `t()` but the underlying state value passed to the mutation is already the correct backend enum.

**No mapper function required.** The `strategy` field passes through as-is:
```typescript
createMutation.mutate({ ..., strategy: selectedStrategy });
```

Task 0.3 reduces to a one-line sanity check (`grep -n 'useState' NewResearch.tsx`) to confirm this hasn't changed by the time the implementation runs.

---

## 5. `Dashboard.tsx` wiring

### 5.1 Jelenlegi állapot

`client/src/pages/Dashboard.tsx` lines 10-70:
```typescript
const mockResearches = [
  { id: 1, nicheName: "AI asszisztensek oktatása", status: "done", verdict: "GO", ... },
  // 3 more
];
// ...
<Stat label="Kutatások" value="4" />
<Stat label="Kreditek" value="12" />
<Stat label="GO verdiktek" value="1" />
```

### 5.2 Target állapot

```typescript
import { trpc } from "@/lib/trpc";

const researchesQuery = trpc.research.list.useQuery();
const creditsQuery = trpc.user.credits.useQuery();

const researches = researchesQuery.data ?? [];
const userCredits = creditsQuery.data?.credits ?? 0;
const goVerdictCount = researches.filter((r) => r.verdict === "GO").length;
const isLoading = researchesQuery.isLoading || creditsQuery.isLoading;
const hasError = researchesQuery.error || creditsQuery.error;
```

### 5.3 Négy visual state

1. **Loading** — skeleton placeholders a list + stats widget-ekben (shadcn/ui `<Skeleton />` ha dep, egyébként CSS placeholder)
2. **Error** — top banner: "Hiba történt, frissítsd az oldalt" + retry button (`researchesQuery.refetch(); creditsQuery.refetch()`)
3. **Empty** — `researches.length === 0 && !isLoading` → "Még nincs kutatásod" message + CTA to `/research/new`
4. **Populated** — list card-okkal, click navigation status alapján:
   - `status === "done"` → `/research/:id` (report view)
   - `status === "running" || "pending"` → `/research/:id/progress` (SSE view)
   - `status === "failed"` → `/research/:id` (report view with error state)

### 5.4 Stats derivation

The current Dashboard renders **4 stat cards** (verified at `Dashboard.tsx:66-70`): Összes kutatás, Befejezett, Kredit egyenleg, GO verdikt. Keep all four, derive from real data:

```typescript
const doneCount = researches.filter((r) => r.status === "done").length;
const goVerdictCount = researches.filter((r) => r.verdict === "GO").length;

const stats = [
  { key: "total",       label: "Összes kutatás",   value: researches.length, icon: BarChart3,     color: "text-blue-500" },
  { key: "done",        label: "Befejezett",       value: doneCount,         icon: CheckCircle2,  color: "text-green-500" },
  { key: "credits",     label: "Kredit egyenleg",  value: userCredits,       icon: Zap,           color: "text-yellow-500" },
  { key: "goVerdicts",  label: "GO verdikt",       value: goVerdictCount,    icon: ChevronRight,  color: "text-primary" },
];

// Render: add data-testid on each Card for test-stability (avoid ambiguous regex
// matches like /^0$/ which collide across multiple "0" counts during loading).
stats.map((stat) => (
  <Card key={stat.key} data-testid={`stat-${stat.key}`} className="border-border">
    {/* existing structure */}
  </Card>
));
```

Sem loading állapot dedikált logic — a `??` fallback adja `0` / `0` / `0` / `0` amíg a query-k pending-ek. Ha a vizuális tapasztalat a loading alatti `0`-kat zavarónak találja (pl. "Kredit egyenleg: 0" → "Kredit egyenleg: 100" jump), a jövőbeli iteráció skeleton-os `<Stat>` loading mode-ot kaphat (T2 scope).

Labels i18n-izálhatók (`t("dashboard.stats.total")` stb.), de backward-compat a jelenlegi magyar hardcoded strings-szel — a meglévő `i18n/en.ts` / `hu.ts` ellenőrzi, vannak-e ezek a kulcsok (Task 3 közben).

---

## 6. Test infrastructure (vitest jsdom + RTL + MSW)

### 6.1 Dev dependencies

```bash
corepack pnpm add -D @testing-library/react @testing-library/jest-dom @testing-library/user-event msw jsdom
```

### 6.2 `vitest.config.ts` patch

The current config at `vitest.config.ts` scopes test discovery to `server/**` only. Must extend to include frontend tests AND add `setupFiles` for RTL+MSW bootstrap:

```typescript
// vitest.config.ts — current state (verified 2026-04-20):
// test: { environment: "node", include: ["server/**/*.test.ts", "server/**/*.spec.ts"] }

// Target patch:
export default defineConfig({
  // root + resolve.alias unchanged
  test: {
    environment: "node",  // default for backend tests (unchanged)
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "client/src/**/*.test.tsx",  // NEW — frontend tests
    ],
    setupFiles: ["./client/src/__tests__/setup.ts"],  // NEW — RTL + MSW bootstrap
    // environment per-file via /** @vitest-environment jsdom */ pragma
    // — backend tests stay in node env, frontend .test.tsx files opt into jsdom.
  },
});
```

**Critical:** without the `include` extension, `.test.tsx` files are ignored and 0 frontend tests run despite being written. Task 1 acceptance must verify `pnpm test` output includes the new test file paths.

### 6.3 Test file convention

- **Backend tests** (unchanged): `server/**/*.test.ts`, node environment default
- **Frontend tests** (new): `client/src/**/*.test.tsx`, first line:
  ```typescript
  /** @vitest-environment jsdom */
  ```

Convention rögzítve `client/src/__tests__/README.md`-ben. Optional CI lint: `grep -L "@vitest-environment jsdom" client/src/**/*.test.tsx` — ha match, missing pragma.

### 6.4 `client/src/__tests__/setup.ts`

```typescript
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll, afterAll } from "vitest";
import { server } from "./mocks/server";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); cleanup(); });
afterAll(() => server.close());
```

### 6.5 `client/src/__tests__/mocks/server.ts`

```typescript
import { setupServer } from "msw/node";
import { handlers } from "./handlers";
export const server = setupServer(...handlers);
```

### 6.6 `client/src/__tests__/mocks/handlers.ts` — tRPC batch handlers

tRPC HTTP batch format:
- Query: `GET /api/trpc/<procedure>?batch=1&input=<url-encoded JSON>`
- Mutation: `POST /api/trpc/<procedure>?batch=1` with JSON body
- Response: `[{ result: { data: { json: <payload> } } }]` wrapper

Helpers:
```typescript
import { http, HttpResponse } from "msw";

export function mockTrpcQuery<T>(procedure: string, data: T) {
  return http.get(`*/api/trpc/${procedure}`, () =>
    HttpResponse.json([{ result: { data: { json: data } } }])
  );
}

export function mockTrpcMutation<T>(procedure: string, data: T) {
  return http.post(`*/api/trpc/${procedure}`, () =>
    HttpResponse.json([{ result: { data: { json: data } } }])
  );
}

export function mockTrpcError(procedure: string, code: string, message: string, method: "get" | "post" = "post") {
  const handler = method === "post" ? http.post : http.get;
  return handler(`*/api/trpc/${procedure}`, () =>
    HttpResponse.json([{ error: { data: { code, httpStatus: 400 }, message } }])
  );
}

// Default handlers — happy-path queries that tests can override via server.use()
export const handlers = [
  mockTrpcQuery("auth.me", { id: 1, openId: "dev-admin-staging", role: "admin", email: "dev@staging.local", name: "Dev" }),
  mockTrpcQuery("user.credits", { credits: 100 }),
  mockTrpcQuery("research.list", []),
];
```

Tesztek `server.use(mockTrpcMutation(...))` hívással felülírják a default-okat.

### 6.7 Render helper

**Routing library: `wouter`** (verified — `client/src/App.tsx:4 import { Route, Switch } from "wouter"`, Dashboard + NewResearch both use wouter). NOT react-router-dom.

```typescript
// client/src/__tests__/test-utils.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { httpLink } from "@trpc/client";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { render, type RenderOptions } from "@testing-library/react";
import { type ReactElement } from "react";

export function renderWithProviders(
  ui: ReactElement,
  options?: RenderOptions & { initialPath?: string }
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // httpLink (NOT httpBatchLink) — with batching, URLs become
  // /api/trpc/user.credits,research.list which doesn't match the
  // single-procedure MSW wildcard */api/trpc/${procedure}. Without
  // batching, each procedure gets its own URL and matches cleanly.
  const trpcClient = trpc.createClient({
    links: [httpLink({ url: "/api/trpc" })],
  });
  // memoryLocation (wouter 3.x) returns OBJECT (not tuple) with { hook,
  // navigate, history, reset }. The `record: true` option enables
  // .history tracking — without it memLoc.history is undefined and
  // .at(-1) throws. Required for test assertions.
  const memLoc = memoryLocation({
    path: options?.initialPath ?? "/",
    record: true,
  });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <Router hook={memLoc.hook}>{children}</Router>
        </QueryClientProvider>
      </trpc.Provider>
    );
  }

  const result = render(ui, { wrapper: Wrapper, ...options });
  // Expose memLoc so tests can inspect memLoc.history.at(-1) or memLoc.navigate().
  return { ...result, memoryLocation: memLoc };
}
```

**API contract (verified against wouter 3.7.1 source):**
- `memoryLocation({ path, record })` returns `{ hook, navigate, history, reset }` — OBJECT, not tuple
- Pass `record: true` to populate `history` (array of visited paths)
- `<Router hook={memLoc.hook}>` — pass the `hook` property to the `Router`
- Tests: `memLoc.history.at(-1)` = last navigated path; `memLoc.history.length` = total nav count
- For production runtime: the app still uses wouter's default browser-history hook (no change to production code)

**Navigation assertions in tests** use `memLoc.history.at(-1)`, not `window.location.pathname`:
```typescript
const { memoryLocation: memLoc } = renderWithProviders(<NewResearch />);
// ... user interaction ...
await waitFor(() => expect(memLoc.history.at(-1)).toBe("/research/42/progress"));
```

---

## 7. Test cases (~13 tests)

### 7.1 `client/src/pages/NewResearch.test.tsx` (7 tests)

```typescript
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { server } from "../__tests__/mocks/server";
import { mockTrpcQuery, mockTrpcMutation, mockTrpcError } from "../__tests__/mocks/handlers";
import { renderWithProviders } from "../__tests__/test-utils";
import NewResearch from "./NewResearch";

describe("NewResearch", () => {
  it("renders form fields", async () => {
    renderWithProviders(<NewResearch />, { initialPath: "/research/new" });
    expect(await screen.findByLabelText(/niche/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /(start|indítás)/i })).toBeInTheDocument();
  });

  it("displays credits from user.credits query", async () => {
    server.use(mockTrpcQuery("user.credits", { credits: 42 }));
    renderWithProviders(<NewResearch />);
    expect(await screen.findByText(/42/)).toBeInTheDocument();
  });

  it("shows error toast when nicheName empty on submit", async () => {
    renderWithProviders(<NewResearch />);
    const submit = await screen.findByRole("button", { name: /(start|indítás)/i });
    await userEvent.click(submit);
    expect(await screen.findByText(/niche.*kötelező/i)).toBeInTheDocument();
  });

  it("shows error toast when credits insufficient (client-side guard)", async () => {
    server.use(mockTrpcQuery("user.credits", { credits: 0 }));
    renderWithProviders(<NewResearch />);
    await userEvent.type(await screen.findByLabelText(/niche/i), "Test Niche");
    await userEvent.click(screen.getByRole("button", { name: /(start|indítás)/i }));
    expect(await screen.findByText(/nincs elég kredit/i)).toBeInTheDocument();
  });

  it("successful submit navigates to /research/:id/progress", async () => {
    server.use(mockTrpcMutation("research.create", { id: 42, shareToken: "abc123" }));
    const { memoryLocation: memLoc } = renderWithProviders(<NewResearch />);
    await userEvent.type(await screen.findByLabelText(/niche/i), "Test Niche");
    await userEvent.click(screen.getByRole("button", { name: /(start|indítás)/i }));
    await waitFor(() => {
      expect(memLoc.history.at(-1)).toBe("/research/42/progress");
    });
  });

  it("shows insufficient-credits toast on backend PAYMENT_REQUIRED error", async () => {
    server.use(mockTrpcError("research.create", "PAYMENT_REQUIRED", "Insufficient credits"));
    renderWithProviders(<NewResearch />);
    await userEvent.type(await screen.findByLabelText(/niche/i), "Test Niche");
    await userEvent.click(screen.getByRole("button", { name: /(start|indítás)/i }));
    expect(await screen.findByText(/nincs elég kredit/i)).toBeInTheDocument();
  });

  it("generic error toast + button re-enabled on network error", async () => {
    server.use(mockTrpcError("research.create", "INTERNAL_SERVER_ERROR", "oops"));
    renderWithProviders(<NewResearch />);
    const button = await screen.findByRole("button", { name: /(start|indítás)/i });
    await userEvent.type(await screen.findByLabelText(/niche/i), "Test Niche");
    await userEvent.click(button);
    expect(await screen.findByText(/hiba történt/i)).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });
});
```

### 7.2 `client/src/pages/Dashboard.test.tsx` (6 tests)

```typescript
/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { server } from "../__tests__/mocks/server";
import { mockTrpcQuery } from "../__tests__/mocks/handlers";
import { renderWithProviders } from "../__tests__/test-utils";
import Dashboard from "./Dashboard";

describe("Dashboard", () => {
  it("shows loading skeleton while queries pending", async () => {
    // Without MSW handler, the query stays in loading state
    renderWithProviders(<Dashboard />);
    expect(screen.getByTestId("dashboard-loading") || screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows empty state when no researches", async () => {
    server.use(mockTrpcQuery("research.list", []), mockTrpcQuery("user.credits", { credits: 50 }));
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText(/még nincs kutatásod/i)).toBeInTheDocument();
  });

  it("renders research cards in populated state", async () => {
    const researches = [
      { id: 1, nicheName: "Napelem HU", status: "done", verdict: "GO", createdAt: "2026-04-01T10:00:00Z" },
      { id: 2, nicheName: "AI education", status: "done", verdict: "KILL", createdAt: "2026-04-02T10:00:00Z" },
      { id: 3, nicheName: "EV charging", status: "running", verdict: null, createdAt: "2026-04-20T10:00:00Z" },
    ];
    server.use(mockTrpcQuery("research.list", researches), mockTrpcQuery("user.credits", { credits: 25 }));
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText(/napelem hu/i)).toBeInTheDocument();
    expect(screen.getByText(/ai education/i)).toBeInTheDocument();
    expect(screen.getByText(/ev charging/i)).toBeInTheDocument();
  });

  it("derives stats correctly (3 researches, 2 done, 25 credits, 1 GO)", async () => {
    const researches = [
      { id: 1, nicheName: "Napelem HU", status: "done", verdict: "GO", createdAt: "2026-04-01T10:00:00Z" },
      { id: 2, nicheName: "AI education", status: "done", verdict: "KILL", createdAt: "2026-04-02T10:00:00Z" },
      { id: 3, nicheName: "EV charging", status: "running", verdict: null, createdAt: "2026-04-20T10:00:00Z" },
    ];
    server.use(mockTrpcQuery("research.list", researches), mockTrpcQuery("user.credits", { credits: 25 }));
    renderWithProviders(<Dashboard />);
    await screen.findByText(/napelem/i);
    // Scoped assertions via data-testid (no ambiguous regex against raw numbers)
    expect(screen.getByTestId("stat-total")).toHaveTextContent("3");
    expect(screen.getByTestId("stat-done")).toHaveTextContent("2");
    expect(screen.getByTestId("stat-credits")).toHaveTextContent("25");
    expect(screen.getByTestId("stat-goVerdicts")).toHaveTextContent("1");
  });

  it("done research card navigates to /research/:id (report)", async () => {
    server.use(
      mockTrpcQuery("research.list", [{ id: 42, nicheName: "Foo", status: "done", verdict: "GO", createdAt: "" }]),
      mockTrpcQuery("user.credits", { credits: 1 })
    );
    const { memoryLocation: memLoc } = renderWithProviders(<Dashboard />);
    const card = await screen.findByText(/foo/i);
    await userEvent.click(card);
    await waitFor(() => expect(memLoc.history.at(-1)).toBe("/research/42"));
  });

  it("running research card navigates to /research/:id/progress (SSE)", async () => {
    server.use(
      mockTrpcQuery("research.list", [{ id: 43, nicheName: "Bar", status: "running", verdict: null, createdAt: "" }]),
      mockTrpcQuery("user.credits", { credits: 1 })
    );
    const { memoryLocation: memLoc } = renderWithProviders(<Dashboard />);
    const card = await screen.findByText(/bar/i);
    await userEvent.click(card);
    await waitFor(() => expect(memLoc.history.at(-1)).toBe("/research/43/progress"));
  });
});
```

---

## 8. Credits seeding (operational, no code change)

See **`docs/deployment/dev-credits-seed.md`** (new, committed as part of this sprint). Summary:

```bash
DB_URL=$(gcloud secrets versions access latest --secret=database-url --project=deep-research-staging-20260420)
cd /Users/balintkovacs/Work/ClaudeCode/Research_App/repo-c1-ai-pipeline
DATABASE_URL="$DB_URL" corepack pnpm exec node -e "
const mysql = require('mysql2/promise');
(async () => {
  const pool = mysql.createPool({ uri: process.env.DATABASE_URL, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } });
  const [r] = await pool.execute(\"UPDATE users SET credits=100 WHERE openId='dev-admin-staging'\");
  console.log('affected rows:', r.affectedRows);
  await pool.end();
})();
"
unset DB_URL
```

**Pure operational, no code change.** Nem része a test suite-nak. Task 5 első lépése, manual execution. Prod safety guaranteed by targeting openId='dev-admin-staging' which prod users never have.

---

## 9. Staging smoke-test protocol (Task 5, manual)

After PR merge → deploy-staging.yml green → new revision Ready:

1. **Credits seed** per §8. Verify: `affected rows: 1`.
2. **Proxy + dev login:** `gcloud run services proxy` + browser URL-encoded `/dev/login?key=...`
3. **Dashboard smoke** `/dashboard`: credits=100, 0 kutatás, empty state CTA visible
4. **NewResearch submit** `/research/new`: form fill → submit → redirect `/research/<ID>/progress` with numeric ID
5. **DB verify:** `SELECT ... FROM researches ORDER BY createdAt DESC LIMIT 1` → 1 row, nicheName matches
6. **Dashboard refresh:** credits=99, 1 research card visible
7. **Insufficient credits test:** `UPDATE users SET credits=0 ...`, submit form → toast "Nincs elég kredit", no crash, re-seed credits
8. **Success record commit:** `docs/deployment/t1-smoke-test-run-YYYY-MM-DD.md`

---

## 10. Risks, deferred, follow-ups

### 10.1 Known risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | MSW batch-format tRPC handlers törékenyebbek új tRPC major esetén | Test flakiness upgrade-kor | Helper-ek DRY központi update |
| R2 | `/** @vitest-environment jsdom */` pragma elfelejthető új test file-nál | Tesztek node env-ben futnak, window-API-k undef | README conv. + optional CI lint |
| R3 | `user.credits` túl sok refresh | Apró extra DB load | tRPC React Query default caching elég (staleTime ~30s) |
| R4 | Playwright helyett manual smoke (most) | Manual friction re-deploy-nál | Scope tradeoff; future Prod launch sprint considers Playwright |
| R5 | Strategy UI→backend enum mapping mismatch Task 0.3 auditon derül ki | Runtime validator error TRPCClientError-ként | Task 0.3 kötelező audit; ha mismatch, a wiring task-ban mapper-t adunk |
| R6 | wouter `memoryLocation` API verify — `record: true` option + object return shape critical | If missed, `memLoc.history.at(-1)` throws at test runtime | §6.7 test-utils reference code is verified against wouter 3.7.1; Task 1 acceptance gate runs a trivial navigation smoke test to confirm `memLoc.history` populated correctly |

### 10.2 Explicit deferred

- **Tier 2:** `Billing.tsx` + `SurveyPage.tsx` wiring → follow-up Frontend Integration sprint
- **Tier 3:** `Profile.tsx` + AdminPanel Users/Audit tabok + backend procedures (`user.update`, `admin.users.list`, `admin.audit.list`) → dedikált sprint
- **Auth migráció off Manus OAuth** → külön sub-projekt (dev stub marad addig)
- **Prod launch** → custom domain, WAF, Sentry, min-instances=1, uptime check
- **Storage / Payment / C3 KMS** → korábban dokumentált V1 remainder

### 10.3 Follow-up minor improvements

- i18n `hu.ts` ↔ `en.ts` parity check — egyes kulcsok valószínűleg csak HU-ban léteznek
- Dashboard pagination — `research.list` jelenleg unlimited, future ha >20 scenario
- Date formatting localized (Hungarian "2 órával ezelőtt" format)
- `useAuth` hook localStorage key `"manus-runtime-user-info"` → `"app-user-info"` rename (Manus-era, non-blocking)

### 10.4 Success-verification checkpoints (sprint közben)

1. Task 0 (audit) után → `docs/deployment/t1-frontend-integration-task-0-audit.md` committed
2. Task 1 (test infra) után → 1 smoke test (`<div>Hello</div>`) pass → jsdom + RTL + MSW works
3. Task 2 (NewResearch wire) után → 7 tests pass, tsc clean
4. Task 3 (Dashboard wire) után → 6 tests pass, tsc clean
5. Task 4 (credits seed docs) után → docs committed
6. Task 5 (deploy + smoke) után → §9 8 checkpoint + success record

---

## 11. Appendix

### 11.1 Relevant file paths

| File | Role |
|---|---|
| `client/src/pages/NewResearch.tsx` | Modify — wire research.create + user.credits |
| `client/src/pages/Dashboard.tsx` | Modify — wire research.list + user.credits, stats, empty/loading/error states |
| `client/src/i18n/hu.ts` + `en.ts` | Modify — add 5-7 keys |
| `client/src/__tests__/setup.ts` | Create — vitest setup for jsdom+MSW |
| `client/src/__tests__/mocks/server.ts` | Create — MSW setupServer |
| `client/src/__tests__/mocks/handlers.ts` | Create — tRPC mock handlers + helpers |
| `client/src/__tests__/test-utils.tsx` | Create — renderWithProviders |
| `client/src/__tests__/README.md` | Create — test file convention docs |
| `client/src/pages/NewResearch.test.tsx` | Create — 7 tests |
| `client/src/pages/Dashboard.test.tsx` | Create — 6 tests |
| `vitest.config.ts` | Modify — add `setupFiles` |
| `package.json` + `pnpm-lock.yaml` | Modify — add 5 dev deps |
| `docs/deployment/dev-credits-seed.md` | Create — operational runbook |
| `docs/deployment/t1-frontend-integration-task-0-audit.md` | Create — Task 0 audit output |
| `docs/deployment/t1-smoke-test-run-YYYY-MM-DD.md` | Create — Task 5 smoke-test record |

### 11.2 Backend tRPC contract (verify Task 0.1)

```typescript
research.create = protectedProcedure
  .input(z.object({
    nicheName: z.string().min(3).max(256),
    description: z.string().max(2000).optional(),
    strategy: z.enum(["gaps", "predator", "provisioning"]),
    batchMode: z.boolean().optional(),
  }))
  .mutation(...) // returns { id: number, shareToken: string }, throws PAYMENT_REQUIRED

research.list = protectedProcedure.query(async ({ ctx }) => await getResearches(ctx.user.id))
// returns Research[] — fields include id, userId, nicheName, status, verdict, createdAt

user.credits = protectedProcedure.query(async ({ ctx }) => ({ credits: await getUserCredits(ctx.user.id) }))
```

### 11.3 References

- Infra Foundation spec: `docs/superpowers/specs/2026-04-20-infra-foundation-staging-design.md`
- Infra Foundation plan: `docs/superpowers/plans/2026-04-20-infra-foundation-staging.md`
- Infra Foundation smoke-test (Frontend mock discovery): `docs/deployment/smoke-test-c2b-run-2026-04-20.md`

---

*End of design document.*
