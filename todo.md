# Deep Research App — TODO

## Foundation
- [x] Database schema: users, researches, phases, sources, surveys, survey_responses, credits, transactions, ai_configs, audit_logs
- [x] i18n setup (react-i18next, HU + EN)
- [x] Dark/light mode toggle (switchable ThemeProvider)
- [x] Base layout: AppLayout with sidebar nav, theme toggle, language switcher
- [x] Public layout for landing + survey pages
- [x] Security middleware: Helmet, CSP, rate limiting

## Landing Page
- [x] Hero section with animated dog mascot (SVG)
- [x] Feature highlights (pipeline phases, radar chart, polling)
- [x] Pricing / credit packages section
- [x] CTA buttons (Login)
- [x] Language toggle (HU/EN)
- [x] Dark/light mode toggle

## Authentication
- [x] Manus OAuth (base auth system)
- [ ] Email + password login/register (V2 — Google/Facebook SSO)
- [ ] Google SSO
- [ ] Facebook SSO
- [ ] Password strength meter
- [x] Rate limiting on login (brute-force protection via express-rate-limit)
- [ ] Session expiry with notification

## Dashboard
- [x] Research history list (status badges: Running, Done, Failed)
- [x] Credit balance widget
- [x] Quick action: New Research, Brainstorm
- [x] Empty state with CTA

## New Research
- [x] Niche name input
- [x] Description textarea
- [x] Strategy selector: Find Unmet Market Gaps / Competitive Predator / Provisioning
- [x] Batch mode toggle (UI placeholder)
- [x] Credit cost preview
- [x] Validation (Zod, inline errors)
- [x] Start Research button

## Research Pipeline Progress View
- [x] Animated sniffing dog mascot (SVG loop animation)
- [x] Live SSE feed: current phase, action log, sources found, keywords
- [x] Phase progress cards (Wide Scan, Gap Detection, Deep Dives, Synthesis)
- [x] Per-phase duration timer
- [x] Collapsible phase summary cards on completion
- [x] Auto credit refund on failure + error state UI

## Report View
- [x] GO / KILL / CONDITIONAL verdict badge
- [x] 5-axis radar chart (Market Size, Competition, Feasibility, Monetization, Timeliness)
- [x] Full Markdown report rendered with Streamdown
- [x] Source library with type icons (Academic, Industry, News, Blog, Community) + date
- [ ] PDF export (server-side) — pending
- [ ] Markdown export — pending
- [x] Public shareable link (/share/:token)
- [x] Synthesis 2.0 panel (polling results integration UI)

## Primer Research / Polling
- [x] AI-generated survey questions (3-5 questions)
- [x] Public survey page (/survey/:token) — mobile-first, GDPR consent
- [x] Survey response counter
- [ ] CSV import modal — pending
- [ ] Synthesis 2.0: re-analyze with human data, update verdict + radar — pending

## Brainstorm
- [x] Context input (industry, audience, constraints)
- [x] Generate 10 niche ideas via AI
- [x] Iterative refinement (re-generate with feedback)
- [x] Save / favorite ideas
- [x] Send idea to New Research (one click)

## Billing
- [x] Credit packages display
- [ ] Stripe checkout integration — pending (requires Stripe setup)
- [x] Transaction history
- [ ] Számlázz.hu invoice generation on purchase — pending
- [ ] Invoice email delivery — pending
- [x] Auto credit refund on pipeline failure (server-side)

## Admin Panel
- [x] User management table (search, filter, role change, credit adjustment)
- [x] Research overview table
- [x] AI Provider config (API keys, test connection)
- [x] Model routing per phase (primary + fallback)
- [x] System prompt editor
- [x] Audit log viewer (filter by action, user, IP, date)

## Security & GDPR
- [x] Server-side-only AI execution (no browser→AI calls)
- [x] CSP header blocking direct AI API calls from browser
- [x] Helmet.js security headers
- [x] ORM-only DB queries (no raw SQL — Drizzle ORM)
- [ ] DOMPurify on AI-generated HTML/Markdown output — pending
- [x] Rate limiting: login, register, research start
- [x] IDOR checks on all /api/research/:id and /api/survey/:id endpoints
- [x] CSRF protection (SameSite cookies via Helmet)
- [x] GDPR: data export (JSON) in user profile
- [x] GDPR: account hard delete with confirmation

## Public Pages
- [x] Public report view (/share/:token)
- [x] Public survey page (/survey/:token)
- [x] Thank you page after survey submission

## Testing
- [x] 17 vitest tests passing (auth, research, credits, admin, survey, brainstorm, security, GDPR)
