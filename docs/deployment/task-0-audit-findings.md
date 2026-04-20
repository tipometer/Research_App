# Task 0 — Pre-implementation Audit Findings
Date: 2026-04-20

## 0.1 Auth topology

```bash
$ grep -n "authenticateRequest\|createSessionToken\|verifySession\|COOKIE_NAME" \
    server/_core/sdk.ts server/_core/context.ts server/_core/index.ts shared/const.ts
```

```text
server/_core/sdk.ts:1:import { AXIOS_TIMEOUT_MS, COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
server/_core/sdk.ts:165:   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
server/_core/sdk.ts:167:  async createSessionToken(
server/_core/sdk.ts:200:  async verifySession(
server/_core/sdk.ts:259:  async authenticateRequest(req: Request): Promise<User> {
server/_core/sdk.ts:262:    const sessionCookie = cookies.get(COOKIE_NAME);
server/_core/sdk.ts:263:    const session = await this.verifySession(sessionCookie);
server/_core/context.ts:17:    user = await sdk.authenticateRequest(opts.req);
server/_core/index.ts:85:      try { user = await sdk.authenticateRequest(req); } catch { user = null; }
shared/const.ts:1:export const COOKIE_NAME = "app_session_id";
```

Additional verification — jose/HS256/cookieSecret usage in `server/_core/sdk.ts`:

```bash
$ grep -n "jose\|HS256\|JWT_SECRET\|cookieSecret\|ENV\." server/_core/sdk.ts | head -30
```

```text
server/_core/sdk.ts:6:import { SignJWT, jwtVerify } from "jose";
server/_core/sdk.ts:158:    const secret = ENV.cookieSecret;
server/_core/sdk.ts:195:        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
server/_core/sdk.ts:211:        algorithms: ["HS256"],
```

No `manusAuthMiddleware` export found anywhere in `server/_core/sdk.ts`, `context.ts`, `index.ts`, or `oauth.ts`.

Confirmed: SDK-based auth, `sdk.authenticateRequest` is the entry point. No `manusAuthMiddleware` export.

Line-number notes vs. spec expectations (all within spec's "around" range):
- `authenticateRequest` → line 259 (spec said "around line 259") ✓ exact match
- `createSessionToken` → line 167 (spec said "around line 167") ✓ exact match
- `verifySession` → line 200 (spec said "around line 200") ✓ exact match
- SSE handler `sdk.authenticateRequest(req)` → line 85 (spec said "81–88") ✓ within range
- `context.ts` user assignment → line 17 (spec said "16–17") ✓ within range
- `jose` uses `HS256` + `ENV.cookieSecret` (mapped to `JWT_SECRET`) ✓

## 0.2 Users schema

```bash
$ grep -A 15 "export const users = mysqlTable" drizzle/schema.ts
```

```text
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  credits: int("credits").default(0).notNull(),
  language: mysqlEnum("language", ["hu", "en"]).default("hu").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
```

Confirmed: `openId` NOT NULL UNIQUE, `role` mysqlEnum with `"admin"` as valid value.

All expected columns present: `openId varchar(64).notNull().unique()`, `name text`, `email varchar(320)`, `loginMethod varchar(64)`, `role mysqlEnum(["user","admin"]).default("user").notNull()`.

Extra columns present beyond spec's minimum set: `credits`, `language`, `createdAt`, `updatedAt`, `lastSignedIn` — no impact on auth/IAM tasks.

## 0.3 packageManager

```bash
$ node -e "const p = require('./package.json'); console.log(p.packageManager || 'MISSING')"
```

```text
pnpm@10.4.1+sha512.c753b6c3ad7afa13af388fa6d808035a008e30ea9993f58c6663e2bc5ff21679aa834db094987129aa4d488b86df57f7b634981b2f827cdcacc698cc0cfb88af
```

Value: `pnpm@10.4.1+sha512.c753b6c3ad7afa13af388fa6d808035a008e30ea9993f58c6663e2bc5ff21679aa834db094987129aa4d488b86df57f7b634981b2f827cdcacc698cc0cfb88af`

Field already present — no `package.json` modification required.
