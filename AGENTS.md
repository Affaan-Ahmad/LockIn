# AGENTS.md

Operating instructions for AI agents working in this repository.

**Codex is the orchestrator. Claude Opus 5 is the implementation worker.**

```
User → Codex (understand, decompose, delegate)
         → Claude Opus 5 (investigate, implement, test)
       Codex (verify diff, decide)
     → User
```

Codex behaves like an engineering manager: it understands the request, decides
what needs doing, delegates the expensive work, checks the result, and answers
the user. Claude behaves like the engineer: it reads the code, writes it, and
runs the checks.

The point of this split is **Codex token economy**. Repository reading, code
writing, debugging and test running are the token-heavy activities, and they
belong to Claude.

---

## 1. The ten rules that matter most

1. Codex orchestrates. Claude Opus 5 does substantial implementation.
2. Codex minimises its own file reading. Claude has the same repository.
3. Claude investigates for itself. Codex does not pre-read files to explain them.
4. Codex verifies via `git diff`, not by re-reading whole files.
5. Neither agent commits, pushes, or rewrites history unless the user says so.
6. Pre-existing uncommitted changes are never discarded. Not every diff is yours.
7. Follow the conventions already in the file you are editing.
8. Never print secrets or `.env` values. Names are fine; values are not.
9. Run the smallest verification that actually proves the change.
10. An explicit user instruction overrides every default here.

---

## 2. Verified Claude worker invocation

The CLI and identifier below were verified against the local installation
(`claude --version` → `2.1.261`; `claude -p --model claude-opus-5` returns
normally). **Use the full identifier, not the `opus` alias** — the alias tracks
"latest Opus" and can silently move to a different model.

```bash
claude -p --model claude-opus-5 --permission-mode acceptEdits "<prompt>"
```

- `-p` runs non-interactively and prints the result.
- `--model claude-opus-5` pins Opus 5 explicitly.
- `--permission-mode acceptEdits` lets the worker edit working-tree files
  without prompting. Use it for implementation tasks.
- Omit `--permission-mode` (or use `plan`) for read-only investigation.
- `--add-dir <path>` if a task genuinely needs a directory outside this repo.

### Standard implementation worker

```bash
claude -p --model claude-opus-5 --permission-mode acceptEdits "
You are the implementation worker for this task.
Work directly in the current repository.

TASK: <one clear objective>

CONSTRAINTS: <constraints, or NONE>
STARTING POINTS: <files or symbols if known, else 'find them yourself'>

Investigate the relevant files yourself.
Follow existing project architecture and conventions.
Implement the requested change completely.
Do not make unrelated modifications.
Do not commit or push anything.
Run appropriate targeted tests, type checking, linting, or build validation.
Keep the final response concise. Do not paste whole files back.

Return exactly:
STATUS: DONE | PARTIAL | BLOCKED
FILES_CHANGED: <paths>
SUMMARY: <max 5 bullets>
TESTS: <commands run and PASS/FAIL/NOT RUN>
CONCERNS: <unresolved concerns, or NONE>
"
```

### Investigation-only worker

For diagnosing before deciding what to build. This worker must not edit files.

```bash
claude -p --model claude-opus-5 "
You are an investigation worker. Do not modify any files.

QUESTION: <what Codex needs to know>

Investigate the repository yourself and answer concisely.

Return exactly:
STATUS: ANSWERED | INCONCLUSIVE
ROOT_CAUSE: <or findings>
RELEVANT_FILES: <path:line references>
RECOMMENDED_FIX: <approach, not a full implementation>
RISKS: <or NONE>
"
```

### Correction worker

When Codex finds a real problem in Claude's output, send it back — do not take
over the implementation.

```bash
claude -p --model claude-opus-5 --permission-mode acceptEdits "
You previously changed: <files>
PROBLEM FOUND: <precise description, with file:line>
EXPECTED: <what correct looks like>

Fix only this. Do not undo your valid existing work.
Do not make unrelated modifications. Do not commit or push.
Re-run: <specific validation>

Return: STATUS / FILES_CHANGED / SUMMARY / TESTS / CONCERNS
"
```

**Retry rule.** First real problem → correction worker. Second failure on the
same point → correction worker with a sharper, narrower instruction. Third
failure → stop retrying: Codex investigates directly and either fixes it or
changes the decomposition. Never loop the same feedback more than twice.

### Optional final-review worker

For high-risk changes only (see §9). Reviewer does not edit.

```bash
claude -p --model claude-opus-5 "
Review the current uncommitted diff for correctness, regressions, security
flaws, race conditions, broken edge cases, architectural violations, missing
validation and incorrect assumptions. Do not modify files.

Reply either 'APPROVED' or 'FINDINGS:' followed by a numbered list.
"
```

Do not review trivial changes. It wastes worker budget for no signal.

---

## 3. What Codex delegates

**Delegate by default:** feature work, bug fixes, debugging, repository
exploration, refactoring, frontend and backend changes, API and database work,
schema and migration work, auth and integration work, writing or fixing tests,
investigating failing tests, build/type/lint errors, dependency questions,
security and performance review, large code review, repetitive edits, and
documentation that accompanies implementation.

**Codex does directly:** answering from what it already knows, a one-line
obvious edit, reading a single short file to settle a specific question, running
a single verification command, and the final user-facing summary.

The test is cost, not category. If explaining the task costs more than doing it,
do it. Otherwise delegate.

---

## 4. Codex token discipline

- Do not read files in order to describe them to Claude. Name the file and let
  Claude open it.
- Do not re-investigate what Claude just investigated.
- Do not ask for long explanations, file dumps, or narrated reasoning.
- Verify with `git diff --stat`, then read only the hunks that matter.
- Prefer targeted tests over the full suite.
- Do not pass large source files between agents.
- Do not run two workers on the same problem hoping for a better answer.
- Do not stage a debate between agents.

---

## 5. Verification loop

After a worker reports:

1. Read the concise result.
2. `git diff --stat` — check the shape and scope.
3. Read only the relevant hunks.
4. Confirm it addresses what the user asked.
5. Run targeted validation if the worker did not, or if the claim needs proof.
6. Check for unrelated modifications and for changes to files the task never
   mentioned.
7. Apply extra scrutiny to the caution areas in §12.
8. Send substantial corrections back to Claude.
9. Report to the user.

Do not re-read the repository wholesale after every task.

---

## 6. Git safety

Without an explicit user instruction, **no agent may**: commit, push, force
push, merge, rebase, reset, delete branches, open pull requests, rewrite
history, or discard working-tree changes.

Claude **may** freely edit working-tree files for a delegated task.

Never run `git reset --hard`, `git clean -fd`, or `git checkout -- .` unless the
user explicitly asks and the consequences are understood.

This working tree frequently contains the user's own in-progress edits, and
edits from other agents. **Assume any diff you did not create belongs to
someone else.** Before touching a file, check whether it is already modified.

---

## 7. Scope discipline

Make the smallest change that fully solves the task. Do not refactor unrelated
code, rename unrelated files, reformat the repository, upgrade dependencies
opportunistically, or perform speculative cleanup. Prefer the existing utility
over a new parallel one. Respect the current architecture unless changing it is
the task.

---

## 8. Secrets

Never print, log, echo, commit or paste: `.env` file contents, OAuth access or
refresh tokens, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`GOOGLE_TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`, or Authorization headers.

Reading environment variable **names** to understand configuration is fine.
Reading `.env.example` is fine — it is the committed template and holds no real
values. When a value must be compared, compare a hash or a boolean, never the
value. `src/shared/crypto.ts` exports `keyFingerprint()` for exactly this.

`src/shared/logger.ts` redacts any field whose key contains `token`, `secret`,
`password`, `authorization`, `apikey`, `credential`, `cookie`, `session`, `jwt`,
`bearer` or `signature`. Do not defeat it by renaming a field to slip a secret
through — and be aware that a field legitimately named e.g. `tokenFingerprint`
will be redacted, so name such fields around the filter.

---

## 9. Risk tiers

**Low risk** — copy, styling, isolated components, additive tests, docs.
Implement, run targeted checks, done.

**High risk** — authentication, OAuth, token storage and encryption, RLS
policies, database migrations, the sync engine's concurrency and leases, the
rate limiter, the CSP, legal/privacy text, and anything touching
`src/infrastructure/` or `supabase/migrations/`.
Investigate first, verify broadly (`npm run verify`), consider a review worker,
check edge cases explicitly.

Codex is the final decision-maker either way.

---

## 10. Honesty about results

Never claim a test, build, migration or deployment succeeded without having run
it and seen the result. State results as **PASS**, **FAIL**, **NOT RUN**, or
**BLOCKED**. "Should work" is not a result. If you did not verify something,
say so plainly.

---

## 11. Worker unavailability

If the Claude CLI fails — authentication, model access, permissions, sandbox,
network, missing executable — **report the actual error to the user**. Do not
silently absorb a large implementation into Codex; that defeats the entire point
of this arrangement. For a genuinely small task, proceed directly and say that
you did.

---

## Repository-Specific Instructions

### Stack (verified)

| | |
|---|---|
| Framework | Next.js 15 (App Router), React 19 |
| Language | TypeScript, ESM (`"type": "module"`) |
| Styling | Tailwind CSS v4, configured **in CSS**, not a JS config |
| Package manager | **npm** (`package-lock.json`), Node `>= 20.11` |
| Tests | Vitest, two projects: `unit` and `integration` |
| Database | Supabase / Postgres, SQL migrations, Supabase CLI |
| Hosting | Vercel, deployed by pushing to `main` |
| CI | `.github/workflows/ci.yml` — typecheck, lint, unit tests, build |

### Commands

```bash
npm run typecheck                                   # tsc --noEmit
npm run lint                                        # eslint .
npm run test:unit                                   # unit suite (hermetic)
npx vitest run --project unit tests/unit/<file>     # ONE test file — prefer this
npm run test:integration                            # needs live Supabase creds
npm run verify:build                                # build into .next-verify
npm run verify                                      # typecheck + lint + unit + build
npm run dev                                         # dev server on :3000
```

**Default verification for an ordinary change:** `npm run typecheck`,
`npm run lint`, and the single relevant test file. Run `npm run test:unit` when
the change is cross-cutting, and `npm run verify` for high-risk work.

**Always use `npm run verify:build`, never bare `next build`.** It writes to
`.next-verify` so a verification build cannot corrupt a running dev server.

**Do not run `npm run test:integration` without asking.** It requires real
Supabase credentials from `.env.local` and writes to whatever project they point
at — which may be production.

### Architecture

Layered, and the direction of dependency is enforced by convention:

```
src/domain/          pure logic, no I/O, no framework      ← depends on nothing
src/application/     services + ports (interfaces)         ← depends on domain
src/infrastructure/  Supabase, Google, composition root    ← implements ports
src/app/             routes and pages (thin)
src/features/        feature UI
src/components/      shared UI
src/config/          env validation, runtime constants
src/shared/          crypto, logger, errors, retry
src/lib/             server-side read queries for RSC
```

- Business rules live in `domain` or `application`, never in `route.ts`.
- `src/infrastructure/composition.ts` is the only place dependencies are wired.
- Services take collaborators as constructor arguments so they can be faked;
  `tests/helpers/fakes.ts` holds the in-memory doubles.
- API routes: authenticate → delegate to a service → translate the result.

### TypeScript strictness

`strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noPropertyAccessFromIndexSignature`, `noImplicitOverride`, `noImplicitReturns`,
`noFallthroughCasesInSwitch`, `isolatedModules`, `verbatimModuleSyntax`.

Consequences worth knowing: index access yields `T | undefined`; optional
properties reject explicit `undefined`; `process.env.FOO` needs bracket access
unless the key is declared (see `src/types/environment.d.ts`); type-only imports
must use `import type`.

### Database and migrations

- Migrations are `supabase/migrations/NNNN_name.sql`, applied with
  `npx supabase db push`.
- **Never edit an applied migration.** Add a new numbered one.
- Adding an enum value and *using* it must be **two separate migrations** —
  Postgres will not let a new label be used in the transaction that added it.
  See `0011_sync_state_values.sql` then `0012_durable_sync.sql`.
- **Migrations must be applied before deploying code that calls them.** The app
  calls `app_*` functions that will not exist otherwise.
- `src/infrastructure/supabase/database.types.ts` is **hand-written on purpose**,
  not generated. Update it alongside any migration that changes a shape.
- Row-level security is on for every user table. `google_connections` has RLS
  enabled with **no policies**, so only the service-role client can read it.
- Two Supabase clients, and the difference matters:
  `createUserScopedClient()` (RLS applies — use this) and
  `createServiceRoleClient()` (bypasses RLS — token service, OAuth callback and
  the background sync worker only).
- Never modify production data, never reset the database, never delete a
  migration.

### Areas requiring special caution

These have each caused a production incident in this repository:

- **PostgREST composite nulls.** A plpgsql function returning `NULL` for a
  composite type arrives as an object whose every column is `null` — truthy, and
  it passes `!== null`. Unwrap arrays first, then check `.id`. See `firstRow` in
  `sync-run.repository.ts`.
- **Tailwind v4 cascade layers.** Unlayered CSS outranks `@layer utilities`, so
  a bare `button { color: inherit }` silently beats every `text-*` class. Element
  resets belong in `@layer base`.
- **The brand palette has two roles.** `--brand` is a *fill*; `--brand-ink` is
  *text*. The lime measures 1.2:1 as text on the light ground. Every fill must
  pass two checks — label-on-fill ≥ 4.5:1 **and** fill-on-page ≥ 3:1 — enforced
  by `tests/unit/palette-contrast.test.ts`.
- **The CSP pins the theme-boot script by SHA-256.** Editing
  `src/shared/theme-boot.ts` requires regenerating `THEME_BOOT_SHA256`, or the
  script is blocked outright. A test recomputes and compares it.
- **`maxDuration` on the sync routes must equal `PLATFORM_MAX_DURATION_SECONDS`**
  in `src/config/sync-runtime.ts`. Next requires a literal, so a test asserts
  they agree.
- **Sync rate limits are shared** between the manual button and automatic
  background sync. Anything that can trigger a sync on mount must respect the
  cooldown in `src/features/sync/auto-sync.ts`.
- **Legal text must be provable from the code.** `src/app/legal/**` states what
  the implementation actually does. Changing what is stored, retained, exported
  or deleted means updating those pages in the same change. Do not add claims
  the code cannot support.
- **Credential faults are three distinct things** and must not be merged:
  `invalid_client` (our misconfiguration — never destroys tokens),
  `CREDENTIAL_DECRYPTION_FAILED` (wrong encryption key — never mutates stored
  credentials), and a genuinely revoked grant (the only one that marks the user
  for reconnection).

### Generated / derived files — do not hand-edit

`node_modules/`, `.next/`, `.next-verify/`, `package-lock.json` (change it via
npm), `next-env.d.ts` (Next regenerates it; it churns between dist dirs), and
`.hallmark/` (design-tool metadata, gitignored).

`database.types.ts` is **not** generated — see above.

### Dependencies

Prefer what is installed. This project deliberately avoids libraries for small
jobs — icons are hand-drawn SVG rather than an icon package, precisely to avoid
the dependency and the bundle cost. Before adding one, check whether the current
stack already covers it, and state in the worker summary why it is necessary and
what it costs in bundle size. Do not upgrade dependencies opportunistically, and
do not let `package-lock.json` drift without intent.

### Security and API conventions

- Routes use `requireUser()` (which calls `getUser()`, validating the JWT —
  never `getSession()`, which trusts a cookie).
- Request bodies are validated with Zod before use.
- Errors go through the taxonomy in `src/shared/errors.ts`. Only codes in
  `CLIENT_SAFE_CODES` return their real message; everything else is genericised.
  A run that fails inside a 200 response body must be filtered the same way —
  use `clientSafeMessage()`.
- Google tokens are AES-256-GCM encrypted at rest with the user id as AAD.
- `src/config/env.ts` is the only place `process.env` is read (plus
  `middleware.ts`, which cannot import `server-only`). Validation fails fast at
  startup via `src/instrumentation.ts`.
- Rate limiting is database-backed and fails **open** deliberately — it protects
  quota, not authorisation.

### Parallel delegation

Decompose only when scopes do not overlap — for example, one worker on
`src/features/`, another on `supabase/migrations/`. Run sequentially when one
task depends on another's output. Two workers editing the same file will produce
conflicting edits. Do not spawn workers for the sake of parallelism.
