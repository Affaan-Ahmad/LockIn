# Production readiness

**Status: NOT READY FOR PUBLIC LAUNCH.** This document is the release gate. It is maintained during
development, not written at the end.

Nothing here claims the software is free of vulnerabilities or legal risk — no engineer can
truthfully claim that. The goal is narrower and achievable: identify foreseeable risks, reduce them
as far as is practical, follow the law and platform policy, document what remains, and name the
external professional reviews that code cannot substitute for.

---

## How this document is used

When the operator says *"prepare the application for production"* or *"we are ready to launch"*, the
answer is **not** a deployment. It is a full launch audit producing a blocking checklist with a
verdict per line:

| Verdict | Meaning |
| --- | --- |
| **PASS** | Verified, with evidence recorded |
| **FAIL** | Does not meet the requirement |
| **NOT VERIFIED** | Plausibly fine, but nobody has checked |
| **N/A** | Genuinely does not apply, with a reason |

**CRITICAL and HIGH findings block launch.** MEDIUM findings are remediated or explicitly
risk-accepted with written justification. A finding is never downgraded in order to permit a launch.

Severity: `CRITICAL` / `HIGH` / `MEDIUM` / `LOW` / `INFORMATIONAL`.

---

## Current state — honest assessment

Verified against the codebase on 2026-08-30. This is a development snapshot, not an audit.

### Controls already built in

These were designed in rather than retrofitted, and are the reason a later launch is feasible at
all. Every one is implemented and covered by the 555 passing unit tests. As of 2026-08-31 the
database-enforced ones were verified against a live Postgres by 27 passing integration tests; the
suite has since grown to 48 cases, and **the 21 added since — including the `0013` fencing
regressions — have NOT been run against a database.**

| Control | Where |
| --- | --- |
| RLS enabled on all 14 tables; identical `user_id = auth.uid()` predicate, `USING` **and** `WITH CHECK` | `0003_rls.sql`, `0004` |
| `google_connections` denies every client role — RLS on, zero policies, `FORCE` | `0003_rls.sql` |
| Google tokens encrypted at rest, AES-256-GCM, user id as AAD | `shared/crypto.ts` |
| Refresh tokens reachable only through `GoogleCredentialProvider.getAccessToken(userId)`; no `getRefreshToken` exists anywhere | `ports/google-credentials.ts` |
| Granted scopes read from Google's `tokeninfo` at consent rather than assumed from the request; a partial grant is stored truthfully and non-ACTIVE in the same write | `services/google-connection.service.ts`, `google/oauth.ts` |
| A grant missing a required scope cannot start a sync and cannot obtain an access token | `api/sync/route.ts`, `services/google-token.service.ts` |
| Service-role client confined to three call sites, all server-only: the token service, the OAuth callback, and the background sync worker | `infrastructure/composition.ts`, `supabase/clients.ts` |
| Sync started in a request runs as the signed-in user, so RLS applies to its every statement | `composition.ts` |
| Every repository method filters on an explicit `user_id`, so the service-role worker path never relies on RLS alone | all repositories |
| The continuation endpoint authenticates callers with an HMAC derived from the service-role key, compared in constant time, and acts only on that user's own resumable run | `config/sync-runtime.ts`, `api/sync/continue/route.ts` |
| Sync-run **coordination** mutations — claim, renew, release, fail, finalise, and the work queue those touch — are fenced by the run's lease owner, so a worker cannot advance a run it does not hold. Ordinary data writes are guarded by the explicit `user_id` filter above, not by a lease | `0012_durable_sync.sql`, `0013_fail_run_fencing.sql` |
| Unconditional log redaction by key substring, at any depth, plus binary | `shared/logger.ts` |
| Route errors return a whitelist of codes; everything else is generic | `app/api/_lib/handler.ts` |
| All external input validated with Zod at the trust boundary | `google/classroom.schemas.ts`, all routes |
| Parameterised queries only; no string-concatenated SQL | all repositories |
| `requireUser()` uses `getUser()` (server-validated) not `getSession()` (cookie-trusting) | `handler.ts` |
| Least-privilege OAuth: four read-only scopes, no roster, no profile, no write | `domain/google/scopes.ts` |
| Bounded concurrency + page ceilings + timeouts on all outbound calls | `shared/concurrency.ts`, `classroom.client.ts` |
| Freshness surfaced with every read, so stale data cannot present as current | `domain/sync/freshness.ts` |
| Secrets never in source control; `.env*.local` gitignored, verified before first commit | `.gitignore` |

### Known gaps — all block launch

| # | Gap | Severity | Notes |
| --- | --- | --- | --- |
| 1 | ~~No account deletion.~~ **RESOLVED 2026-08-31.** `DELETE /api/account` revokes Google, then deletes the auth user; every user-owned table cascades from it. Requires a typed confirmation. | ~~CRITICAL~~ CLOSED | End-to-end deletion against a live database is still NOT VERIFIED — unit tested only, since the only real account is the operator's. |
| 2 | ~~No Google disconnect.~~ **RESOLVED 2026-08-31.** `DELETE /api/connection` revokes at Google then clears local credentials. Imported coursework is deliberately kept, and the response says so. | ~~CRITICAL~~ CLOSED | `revoke()` is no longer dead code. |
| 3 | ~~No inbound rate limiting.~~ **RESOLVED 2026-08-31.** Database-backed fixed-window limiter on both Google-facing endpoints, with `Retry-After` on the 429. | ~~HIGH~~ CLOSED | Verified against the live database. Fails open by design if the limiter itself is unreachable — it guards a quota, not authorisation. |
| 4 | ~~No security headers / CSP.~~ **RESOLVED 2026-08-31.** Nonce-based CSP set per request in middleware; static headers in `next.config.mjs`. Verified on a live response. | ~~HIGH~~ CLOSED | One documented relaxation: `style-src 'unsafe-inline'`, because Next.js injects inline styles that cannot yet carry a nonce. Revisit once the UI exists. |
| 5 | **No CI.** ~~None existed.~~ **ADDRESSED 2026-08-31.** `.github/workflows/ci.yml` runs typecheck, lint, unit tests and a production build on every push and pull request, plus a runtime dependency audit. **NOT VERIFIED** until it has run green once on GitHub. Integration tests stay out: they need a live service-role key, and putting one in CI trades a testing gap for a credential-exposure risk. | HIGH | |
| 6 | **OAuth callback `state` handling unverified.** `exchangeCodeForSession` is assumed to validate PKCE; not confirmed. | HIGH | Must be read and proven, not assumed. |
| 7 | ~~The entire SQL layer has never been executed.~~ **RESOLVED 2026-08-31.** All four migrations applied to a live Postgres; 27/27 integration tests pass against it. | ~~HIGH~~ CLOSED | RLS isolation, the confidence floor, the ALL_SECTIONS guard, deadline coherence, two-strike reconciliation, single-active-sync and duplicate prevention are now measured rather than argued. |
| 8 | **No data export.** ~~None existed.~~ **RESOLVED 2026-09-01.** `GET /api/account/export` returns everything held about the caller as one downloadable JSON file, including the classification evidence behind each decision. Google tokens are deliberately excluded: they are credentials, not information about the student. **CORRECTED 2026-09-06:** this entry claimed it was "linked from Settings" while no link existed anywhere in the UI — the privacy policy said so too. Settings → Your data now carries a plain download anchor to the route, so the claim and the code agree. | MEDIUM | Required if GDPR/UK GDPR applies. |
| 9 | **No retention policy implemented.** **ADDRESSED IN CODE 2026-09-01**, migration `0010_sync_retention.sql`: 90-day window, dependents cascade, and a daily pg_cron job. The most recent run and most recent successful run per user are preserved regardless of age, because freshness reads both and losing either would report a synced account as never synced. **STILL OPEN: whether the migration has been applied to any environment is UNKNOWN from the repository.** **CORRECTED 2026-09-06:** the previous note here said the privacy policy states a 90-day window and is therefore false until the job runs. It does not. `src/app/legal/privacy/page.tsx` says pruning "is built but is not yet running on a schedule, so this page does not claim a fixed retention period for it", which is accurate whether or not `0010` has been applied. The gap is the absent retention *behaviour*, not a false published claim. | MEDIUM | |
| 10 | **No monitoring or alerting.** | MEDIUM | Nobody would know sync had been failing for a week. |
| 11 | **No backup restore test.** | MEDIUM | Supabase takes backups; an untested restore is not a proven restore. |
| 12 | **No threat model document.** | MEDIUM | |
| 13 | **No legal documents.** ~~None existed.~~ **PARTIALLY ADDRESSED 2026-08-31.** Privacy policy, terms, cookie policy and disclaimer drafted from the schema and scope list, published at `/legal/*`, public in middleware, linked from a footer on both the app shell and the signed-out screen. **UPDATED 2026-08-31:** controller named (Affaan Ahmad, individual, Pakistan) and contact address set to contact@lockinapp.tech. **STILL OPEN:** never reviewed by anyone qualified, and the contact mailbox is NOT VERIFIED as receiving until Cloudflare Email Routing is live. | CRITICAL for launch | Drafting is in scope; legal sufficiency is not. |
| 14 | **Google OAuth app is in Testing mode**, unverified. | CRITICAL for launch | See below. |
| 15 | ~~Dev `service_role` credentials exposed.~~ **RESOLVED 2026-08-30.** Both exposed credentials are dead: the `sb_secret_` key was replaced, and legacy JWT-based API keys were disabled project-wide. | ~~HIGH~~ CLOSED | See the incident log below. |
| 16 | **Granted OAuth scopes were fabricated, not read.** The callback wrote `REQUIRED_CLASSROOM_SCOPES` into `granted_scopes` because that is what the consent URL asked for, so a student who unticked a permission was recorded as having granted it and every "is this account connected?" check said yes. **RESOLVED IN CODE 2026-09-06:** the granted scopes are now read from Google's `tokeninfo` endpoint, stored exactly as reported, and a partial grant is written `NEEDS_RECONNECT` / `INSUFFICIENT_SCOPES` in the same statement as the scopes. A failed verification writes nothing at all rather than assuming a full grant or marking anything revoked. **NOT VERIFIED against a live Google consent flow** — unit tested only. | ~~HIGH~~ CLOSED IN CODE | The live-flow check belongs with Google verification, row 14. |
| 17 | **`app_fail_sync_run` was fenced in name only.** It checked the lease owner on the run row and read the row count immediately afterwards, but never branched on that count — it marked every PENDING and RUNNING work item FAILED regardless and used the count only as its return value. So a stalled worker that came back emptied the queue of the successor that had replaced it. **FIXED IN CODE 2026-09-06** by `0013_fail_run_fencing.sql`, with integration regression coverage for stale owner, reclaimed run, rightful owner and terminal-course preservation. **The migration is NOT APPLIED anywhere as far as this repository can tell, and the new integration tests have NOT been run.** | HIGH until applied | `0013` keeps the function signature, so code deployed against a database still on `0012` does **not** error — it runs and keeps the race. The hazard here is silence, not a loud failure. |
| 18 | **Known postcss advisories reached through Next.** GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp and GHSA-r28c-9q8g-f849, all affecting `<= 8.5.22`. Next pins `postcss` 8.4.31 as an exact dependency, so the root's own 8.5.x did not cover it. **RESOLVED 2026-09-06** with a scoped `next -> postcss: 8.5.26` override in `package.json`, and CI's audit step no longer ends in `\|\| true`. **VERIFIED locally:** `npm ls next postcss --all` exits clean and reports `next@15.5.24` resolving `postcss@8.5.26`, deduped onto the root copy that `npm ls` marks `overridden`; the install's online audit reports **0 vulnerabilities** across all 290 packages, down from one high and one moderate. The override needed the `next -> postcss` edge itself re-resolved to take effect — declaring it alone did nothing, because npm honours an already-resolved lockfile edge over a newly added override and never records an `overrides` key in the lockfile for a later run to notice. **NOT VERIFIED: `npm audit --omit=dev --audit-level=moderate` as a standalone command**, which the sandbox refused to run; and CI has not run green on GitHub (row 5). | ~~MEDIUM~~ CLOSED IN CODE | No major upgrade, no `audit fix --force`, no widened range, and no unrelated package moved; see the note below. |
| 19 | **A consent that returns no refresh token was stored ACTIVE.** Google issues a refresh token on first consent and, with `prompt=consent`, normally afterwards — but not reliably. A grant arriving without one, on an account with none stored, is usable only until its access token expires, and recording it ACTIVE produced an account that read as connected everywhere and stopped working by itself about an hour later with no event to explain it. **RESOLVED IN CODE 2026-09-06:** the connection service asks the repository whether a usable refresh token will survive the write — a boolean, never the credential — and stores a non-renewable grant `NEEDS_RECONNECT` / `NO_REFRESH_TOKEN` instead. Repeat consent onto an existing stored token still stores ACTIVE. **NOT VERIFIED against a live Google consent flow.** | ~~HIGH~~ CLOSED IN CODE | The live-flow check belongs with Google verification, row 14. |
| 20 | **A refresh that came back with a narrower grant discarded what it learned.** The scope check threw before persisting anything, dropping the access token Google had just issued, any rotated refresh token, and the scopes that were the reason for the failure. Losing the rotated token is the expensive part: it is the only one that still works, so the next refresh would fail `invalid_grant` and a fixable permissions problem became a dead connection. **RESOLVED IN CODE 2026-09-06:** one repository write persists credential, rotated token, reported scopes and `NEEDS_RECONNECT` / `INSUFFICIENT_SCOPES` together, before the throw, and outside the `invalid_grant` handler so it can never mark the row REVOKED. **NOT VERIFIED against a live Google refresh.** | ~~HIGH~~ CLOSED IN CODE | |
| 21 | **A complete consent was read as an incomplete one, in production.** Observed 2026-09-06 on `lockinapp.tech`: a student accepted every permission on the Google consent screen and was redirected to `/welcome?connection=insufficient_scopes`, with the connection stored `NEEDS_RECONNECT` / `INSUFFICIENT_SCOPES`. Reconnecting could not help, because a second consent produces the same token and the same verdict. The consent was fine; the comparison was not. Google reports the *permission* it granted rather than the scope string that was asked for, and `classroom.student-submissions.me.readonly` and `classroom.coursework.me.readonly` are one permission to it, so `tokeninfo` names only one of the two back. `missingClassroomScopes` matched Google's answer against the requested list by string identity and called a complete grant one permission short. **FIRST FIX 2026-09-06 WAS WRONG.** It aliased coursework → submissions only, arguing that coursework access subsumes reading one's own submissions but not the reverse — a claim about the APIs, not about what Google reports. A live diagnostic taken on the deployed fix, after a complete consent, returned the *other* name: `granted_scopes` held `courses.readonly`, `student-submissions.me.readonly`, `topics.readonly` and the sign-in scopes, with `coursework.me.readonly` absent, and the connection was stored `NEEDS_RECONNECT` / `INSUFFICIENT_SCOPES` exactly as before. **FIXED IN CODE 2026-09-06:** either name satisfies the requirement and no code branches on which one Google returned. The submissions-named shape above is the only one ever observed; the coursework-named shape the first fix assumed has not been observed and is not ruled out, and depending on the observed name being the one Google always picks would repeat the guess that caused the fault. The cost of accepting either is checkable rather than assumed: the pair is required only for the coursework and submissions calls in `classroom.client.ts`, and its other two calls are covered by the separately required, unaliased `courses.readonly` and `topics.readonly`. The pair is also modelled as **one** required permission, so a grant carrying neither name reports one missing item instead of two bullets for one consent entry. A grant carrying neither name is still refused. The requested scope set is unchanged, and the stored `granted_scopes` remains exactly what Google reported. Regression coverage for both reported shapes, including the live one, at the domain rule, the callback's connection service and the token service's sync gate. **The fix is NOT VERIFIED against a live Google consent flow** — the previous fix was also unit-green, and only a live flow can close this. | ~~HIGH~~ FIXED IN CODE | The first live-flow evidence bearing on row 16, whose closure was explicitly unit-tested only. Row 16's write path was right; its comparison was not — twice. |

## Incident log

Kept because "rotate secrets after accidental exposure" is a standing rule, and a rotation that
nobody wrote down is a rotation nobody can prove happened.

### 2026-08-30 — Supabase development keys exposed in a chat transcript

**What.** The `anon` / publishable and `service_role` / secret keys for the development project
`vkihrrhqduysjmmqggnm` were pasted into a chat transcript, along with a locally generated
`GOOGLE_TOKEN_ENCRYPTION_KEY` that a tool notification echoed back.

**Impact.** None realised. The database was empty, no migrations had run, no user had connected a
Google account, and the project was minutes old. The `service_role` key bypasses RLS entirely, so
the impact would have been total read/write across all users had any existed.

**Triage.** Only two of the four exposed values are actually credentials:

| Exposed value | Action | Why |
| --- | --- | --- |
| `sb_publishable_` key | **None** | Public by design; ships in the browser bundle of every Supabase app. RLS protects the data, not this key's secrecy. |
| `anon` JWT | **None** | Same, older format. |
| `sb_secret_` key | **Rotate** | Bypasses RLS entirely. |
| `service_role` JWT | **Rotate separately** | Same power, issued by a different mechanism. Rotating the `sb_secret_` key does **not** invalidate it. |

That last row is the easy one to get wrong: two independent credentials with identical privilege,
so killing one leaves the other live.

**Response.** The encryption key was rotated immediately — it had encrypted nothing. The
`sb_secret_` value was removed from `.env.local` and replaced with a paste placeholder.

**Resolution — completed 2026-08-30, before the database held any data:**

- [x] Created a replacement `sb_secret_` key and put it in `.env.local`
- [x] Disabled legacy JWT-based API keys project-wide, killing the exposed `service_role` JWT
- [x] Verified both replacement keys against `/auth/v1/settings`, `/rest/v1/` and
      `/auth/v1/admin/users` after disabling — all 200
- [ ] Revoke the superseded `sb_secret_zMnSz…` key if it is still listed
- [ ] Confirm no production project ever reuses this development project's keys

**Verification note.** An initial 401 against `/rest/v1/` using the publishable key was misread as
the new key format being unsupported. It was not: that endpoint deliberately accepts only secret
keys. Checking against `/auth/v1/settings` showed the format works, which removed the reason to keep
legacy keys as a fallback and turned a JWT-secret rotation into a single disable action.

Nothing was exposed for longer than it took to replace it, and no user data existed at any point.

**Lesson.** A credential does not need to be sent to be used. Secrets go into `.env.local` directly
and are never pasted into a chat, a ticket, or a commit.

---

## Verification log

### 2026-08-31 — first execution of the SQL layer

All four migrations applied to the live development project; 27/27 integration tests pass. Two bugs
surfaced that no amount of code review had caught, both of which only a real Postgres could reveal:

**1. Enum literals in `INSERT ... SELECT`.** `column "lifecycle_status" is of type lifecycle_status
but expression is of type text`. Unlike `INSERT ... VALUES`, a SELECT list does not infer the target
column's type, so a bare `'ACTIVE'` stayed text. Affected five functions and three `CASE`
expressions.

**2. `RETURNS TABLE` output columns shadow real columns.** `column reference "source_item_id" is
ambiguous` (42702) in `app_upsert_assignments`: the declared output columns are plpgsql variables
inside the body, so the `ON CONFLICT (user_id, source, source_item_id)` target could not be resolved.
Fixed with `#variable_conflict use_column`.

Both were fixed in the original migrations rather than in follow-ups, since neither definition had
ever run successfully anywhere and there was no history to preserve. The database was reset and the
migrations reapplied from scratch.

Now verified end to end against real Postgres:

- RLS isolation between two genuine signed-in users, across coursework, classifications, overrides,
  sync errors and subject selection
- `google_connections` unreachable by any client role
- Cross-user writes rejected by `app_assert_self`
- Duplicate prevention under repeated sync
- Deadline coherence, the NOT_RELEVANT confidence floor, and the ALL_SECTIONS-cannot-be-hidden guard
- Two-strike disappearance reconciliation
- Single active sync per user, plus stale-lease reclaim as ABANDONED
- Manual overrides surviving a full re-sync and winning in the read model
- Untracked courses excluded from the feed; undated coursework preserved but excluded

---

### 2026-08-31 — pre-frontend security pass

Four findings closed before starting UI work, each chosen because it is cheaper
now than later:

- **CSP first, deliberately.** A strict policy bans inline scripts and styles.
  Introduced after a frontend exists, half of it breaks and the tempting fix is
  `unsafe-inline`, which switches the protection off. Set first, the UI gets
  built inside it at no cost.
- **Deletion and disconnect before the UI**, because the UI has to expose both.
  Building them afterwards means shipping a settings screen with dead buttons.
- **Rate limiting before a visible Sync button**, which is precisely when an
  unthrottled Google call becomes a problem.

Still NOT VERIFIED: end-to-end account deletion against a live database. It is
unit tested, and the cascade is exercised by the integration suite's user
cleanup, but no full deletion has been run — the only real account belongs to
the operator.

---

### 2026-09-06 — local fixes, and what they did not prove

Verified only by `npm run verify` on a development machine: typecheck, lint,
**555 unit tests across 24 files**, and a production build. Nothing below
asserts anything about a deployed environment.

- **The granted-scopes fabrication (row 16).** The most consequential of these,
  because it made the connection record unreliable rather than merely
  incomplete: a half-granted account read as connected everywhere. Scopes now
  come from Google, and the outcomes are kept apart — a complete grant, a real
  partial grant, and *not being able to ask*, which writes nothing at all. The
  last is the one worth naming: an outage, an error status or an unparseable
  body says nothing about consent, so none of them may invent a full grant,
  overwrite a working row, or be reported as a revocation.
- **Credential durability at consent (row 19)** and **at refresh (row 20).** Two
  ways the code could record a connection it could not keep alive. Both now
  write the credential, the scopes and the status they imply in one statement.
- **The fail-run fence (row 17).** A stale worker could close a successor's work
  queue. Fixed in `0013`, which is **not applied**, and which fails silently
  rather than loudly when it is missing.
- **The data export link (row 8).** The route existed and nothing pointed at it,
  while both this document and the privacy policy said Settings did.
- **The postcss override (row 18).** Now actually in effect; see the row for
  what was and was not proven.

A note on the lockfile, because getting the override to apply without collateral
took several attempts. Declaring the override changed nothing on its own: npm
honours an already-resolved lockfile edge over a newly added override, and it
writes no `overrides` key into `package-lock.json`, so no later incremental run
has anything to notice. The obvious escape — deleting the lockfile and
regenerating — does take effect, but it re-resolves every caret range at once,
which moved 33 lockfile entries — `next` 15.5.24 → 15.5.25,
`@supabase/supabase-js` 2.112.4 → 2.115.0, `typescript-eslint` 8.68.0 → 8.69.0
and thirty more. That was reverted in full. Two
further approaches were tried and rejected: regenerating with the lockfile
deleted but `node_modules` present rebuilds from the *installed* tree, which
silently dropped every non-Windows `@rollup/*` optional binary and left entries
without `resolved` or `integrity`; and pinning the registry to a single date
cannot reproduce this lockfile at all, because it was built incrementally
(`framer-motion` 13.2.0 postdates the `ignore` 7.0.6 it sits beside).

What is committed instead re-resolves only Next's own subtree, against the
restored lockfile, with the registry view frozen so `^15.5.4` lands back on the
15.5.24 it already held. The resulting diff moves **no** package version. It
removes the nested `next/node_modules/postcss` 8.4.31 entirely — Next's
overridden edge is satisfied by the root `postcss` 8.5.26 that was already
there — and drops that root copy's `dev: true`, since a production dependency
now uses it and `npm audit --omit=dev` has to see it. `next` stays 15.5.24,
`@supabase/supabase-js` stays 2.112.4, and the lockfile's own `version` field
catches up to the `0.4.3` in `package.json`, where it had been stale at 0.4.0.

One thing that reverting Supabase did **not** fix, found while checking it and
still open: `@supabase/supabase-js` declares `engines.node: ">=22.0.0"`, and it
does so at **2.112.4** — the version this repository was already pinned to
before any of today's work. `package.json` declares `>=20.11` and CI provisions
Node 20.11, so the runtime contract is violated by the dependency the project
has been shipping all along, not by anything changed here. Nothing fails loudly
today: there is no `.npmrc`, so `engine-strict` is off and npm only warns
`EBADENGINE`, and the local verify run passes on Node 26. Whether 2.112.4
actually calls a Node 22+ API on the paths this app uses is **UNKNOWN** and was
not tested on Node 20.11. Closing it means either raising the declared floor or
moving Supabase, and both are out of scope for a change whose whole purpose was
to stop unrelated dependency movement.

Deliberately **not** changed, and still open: everything under Google
verification below, whether any migration has been applied to any environment,
whether the retention job in `0010` is running anywhere, and whether the CI
pipeline has ever run green. None of those are knowable from the repository, and
this document says UNKNOWN rather than guessing.

---

## OAuth scope inventory

Verified against `src/domain/google/scopes.ts`, which is both the list requested at consent and the
rule deciding whether a stored grant is usable. Must be re-checked at launch and kept in step with
the privacy policy.

| Scope | Sensitivity | Why required | Feature | Narrower option? |
| --- | --- | --- | --- | --- |
| `classroom.courses.readonly` | Sensitive | List courses so the student can choose which to track | Course discovery | None |
| `classroom.coursework.me.readonly` | Sensitive | Read coursework and due dates | Deadline feed | Already the `.me` variant |
| `classroom.student-submissions.me.readonly` | Sensitive | Know what is already submitted, and learn the student's Classroom user id without a roster scope | Feed filtering, source targeting | Already the `.me` variant |
| `classroom.topics.readonly` | Sensitive | Topic names are a section-targeting signal | Classification | None |

No write scopes. No roster scope. No profile scope. The student's Classroom user id is learned from
their own submission payloads specifically to avoid a broader scope.

**Google does not name all four back.** `classroom.student-submissions.me.readonly` and
`classroom.coursework.me.readonly` are one permission to Google, and a token granted both is
described by `tokeninfo` as carrying only one of the two names. **One shape has been observed**
(row 21): the submissions name present, the coursework name absent, after a complete consent. The
reverse has not been observed and is not ruled out — which name Google returns is undocumented — so
the rule accepts either and no code branches on which one arrived. All four scopes are still
requested; the rule that decides whether a stored grant is usable treats that pair as one
permission, matches on the permission a scope stands for rather than on the string that was asked
for, and reports one missing item when neither name is present. Accepting either name grants no
extra capability, and that is checkable rather than assumed: the pair is required only for the
coursework and submissions calls in `src/infrastructure/google/classroom.client.ts`, whose other two
calls are covered by the separately required, unaliased `courses.readonly` and `topics.readonly`.

**Before launch:** confirm each scope's current classification against Google's live list —
sensitive vs restricted changes over time. Restricted scopes trigger an independent security
assessment, which is an external cost and a multi-week timeline.

## Google verification — external, on the critical path

| Requirement | Status |
| --- | --- |
| OAuth consent screen published (not Testing) | NOT STARTED |
| Brand verification | NOT STARTED |
| Sensitive-scope verification | NOT STARTED |
| Independent security assessment (only if any scope is *restricted*) | NOT DETERMINED |
| Privacy policy hosted on the verified domain | NOT STARTED |
| App behaviour matches the Cloud Console configuration and the privacy policy | NOT VERIFIED |

Testing mode allows up to 100 test users with no verification, which is fine for development and
for a small trial with classmates. It is not a lawful basis for public launch. **Start verification
early** — it is measured in weeks, not days, and it gates the launch date more than any code does.

Google's API Services User Data Policy must be re-read immediately before launch. Classroom data
must not be sold, used for advertising or profiling, or shared with unrelated third parties.

---

## Data inventory

To be completed and verified before launch. Populated from the schema as it stands.

| Category | Source | Purpose | Stored | Retention | Deletion |
| --- | --- | --- | --- | --- | --- |
| Email, display name | Supabase Auth (Google) | Identify the account | `user_profiles` | TBD | TBD |
| Google account id (`sub`) | OAuth | Link the connection | `google_connections` | TBD | TBD |
| Classroom user id | Submission payloads | Source-level assignee targeting | `google_connections` | TBD | TBD |
| Section, program, batch, aliases | Student input | Section classification | `academic_profiles`, `section_aliases` | TBD | TBD |
| Time zone | Student input | Render deadlines correctly | `academic_profiles` | TBD | TBD |
| Course names, sections, state | Classroom | Course selection and display | `courses`, `topics` | TBD | TBD |
| Coursework titles, descriptions, due dates | Classroom | The product | `assignments` | TBD | TBD |
| Submission state, lateness | Classroom | Filter completed work | `submissions` | Until deletion | Cascade |
| Classification verdicts, scope, evidence | Derived | Explainability, audit | `assignment_classifications` | TBD | TBD |
| Manual overrides, course tracking | Student decisions | Product behaviour | `classification_overrides`, `course_tracking` | TBD | TBD |
| Google access + refresh tokens | OAuth | Call Classroom on the student's behalf | `google_connections`, **encrypted** | Until disconnect/deletion | Revoke + delete |
| Sync history and errors | Internal | Debugging, freshness | `sync_runs`, `sync_errors`, `sync_course_results` | **TBD — currently unbounded** | TBD |

~~Note that **grades** are stored (`assigned_grade`, `draft_grade`).~~ **RESOLVED 2026-08-31.**
Grades are no longer stored. Migration `0009_drop_grades.sql` drops both columns and replaces
`app_upsert_submissions`; the mapper discards the fields on arrival, and a unit test asserts they
never survive it. The `student-submissions.me.readonly` scope is unchanged because submission
*state* is what hides completed work, so Google still sends grades and LockIn now throws them away.

Deleting the data was preferred to disclosing it: nothing read those columns, they were the most
sensitive fields in the database, and minimal collection is the standing rule.

## Subprocessors

**Data controller:** an individual based in Pakistan. Legal name and contact addresses are
`src/app/legal/content.tsx`: Affaan Ahmad, an individual in Pakistan, reachable at
contact@lockinapp.tech. Production domain is lockinapp.tech.

| Provider | Data | Region | Status |
| --- | --- | --- | --- |
| Supabase | Everything in the tables above | Chosen at project creation | Region must be recorded here once set |
| Google | OAuth + Classroom reads | Google infrastructure | |
| Hosting (Vercel or equivalent) | Request metadata, logs | TBD | Not yet chosen |

No analytics, no error-monitoring vendor, no email provider today. **Adding any of them is a
privacy-policy change and a subprocessor-list change in the same commit**, not afterwards.

---

## Required documents

| Document | Audience | Status |
| --- | --- | --- |
| Privacy Policy | Public | NOT STARTED — legal review required |
| Terms of Service | Public | NOT STARTED — legal review required |
| Security contact (`security@`, optionally `security.txt`) | Public | NOT STARTED |
| Data Retention Policy | Internal | NOT STARTED |
| Incident Response Plan | Internal | NOT STARTED |
| Threat Model | Internal | NOT STARTED |
| Data Inventory | Internal | DRAFT (above) |
| OAuth Scope Inventory | Internal | DRAFT (above) |
| Subprocessor List | Internal | DRAFT (above) |
| Architecture / data-flow diagram | Internal | NOT STARTED |
| Account Deletion Procedure | Internal | NOT STARTED |
| Google Disconnect Procedure | Internal | NOT STARTED |
| Backup / Restore Procedure | Internal | NOT STARTED |
| Production Runbook | Internal | NOT STARTED |

---

## Decisions the operator must make (code cannot)

These block the legal documents, and the legal documents block launch.

1. **Who legally operates this?** An individual, or a registered entity? Determines what the privacy
   policy and terms must disclose.
2. **Where is the operator, and where are the users?** Drives which privacy laws apply. Do not
   implement every law globally — determine which actually apply, and get advice where unclear.
3. **Minimum age.** This is an education product; assume some users may be minors until established
   otherwise. If minors are in scope, this needs qualified legal review before launch, not after.
4. **Supabase region** — affects data residency claims in the privacy policy.
5. **Domain**, with real `support@` / `privacy@` / `security@` addresses. Compliance processes must
   not be built on a personal inbox.
6. **Product name**, cleared against existing software, domains and trademarks, and not implying
   affiliation with Google, Google Classroom, or any university.

## What the product must never claim

The app organises academic information. It is not an educational institution, not a university
service, and not a Google product. Branding and copy must not imply otherwise.

Because students may rely on this for deadlines, correctness is a safety property, not just a
quality one. Never write "you will never miss an assignment". Write what is true: it helps track
coursework, it shows when data was last synchronised, it shows unknown when a deadline is unknown,
and it surfaces uncertain items rather than hiding them.

---

## Standing engineering rules

Applied continuously, not at launch:

- Authorization is enforced server-side and at the database. Frontend checks are never the control.
- Deny by default. New tables get RLS in the same migration that creates them.
- Minimal collection: if there is no defensible product reason for a field, do not store it.
- No new subprocessor, analytics tool, or data flow without updating the inventory and policy in the
  same change.
- Classroom content — course names, titles, descriptions, attachment names — is untrusted. When a
  frontend exists it must be escaped, never rendered as HTML.
- No debug endpoints, seed routes, mock auth or privileged test users in production.
- Serious production risks found during development are flagged when found, not deferred to the
  final review.
