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
all. Every one is implemented and unit-tested, and as of 2026-08-31 the database-enforced ones are
verified against a live Postgres by 27 passing integration tests.

| Control | Where |
| --- | --- |
| RLS enabled on all 14 tables; identical `user_id = auth.uid()` predicate, `USING` **and** `WITH CHECK` | `0003_rls.sql`, `0004` |
| `google_connections` denies every client role — RLS on, zero policies, `FORCE` | `0003_rls.sql` |
| Google tokens encrypted at rest, AES-256-GCM, user id as AAD | `shared/crypto.ts` |
| Refresh tokens reachable only through `GoogleCredentialProvider.getAccessToken(userId)`; no `getRefreshToken` exists anywhere | `ports/google-credentials.ts` |
| Service-role client confined to two call sites, both server-only | `infrastructure/composition.ts` |
| Sync pipeline runs as the signed-in user, so RLS applies to its every statement | `composition.ts` |
| Unconditional log redaction by key substring, at any depth, plus binary | `shared/logger.ts` |
| Route errors return a whitelist of codes; everything else is generic | `app/api/_lib/handler.ts` |
| All external input validated with Zod at the trust boundary | `google/classroom.schemas.ts`, all routes |
| Parameterised queries only; no string-concatenated SQL | all repositories |
| `requireUser()` uses `getUser()` (server-validated) not `getSession()` (cookie-trusting) | `handler.ts` |
| Least-privilege OAuth: four read-only scopes, no roster, no profile, no write | `google/oauth.ts` |
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
| 5 | **No CI.** No typecheck/lint/test gate, no dependency scan, no secret scan. | HIGH | |
| 6 | **OAuth callback `state` handling unverified.** `exchangeCodeForSession` is assumed to validate PKCE; not confirmed. | HIGH | Must be read and proven, not assumed. |
| 7 | ~~The entire SQL layer has never been executed.~~ **RESOLVED 2026-08-31.** All four migrations applied to a live Postgres; 27/27 integration tests pass against it. | ~~HIGH~~ CLOSED | RLS isolation, the confidence floor, the ALL_SECTIONS guard, deadline coherence, two-strike reconciliation, single-active-sync and duplicate prevention are now measured rather than argued. |
| 8 | **No data export.** | MEDIUM | Required if GDPR/UK GDPR applies. |
| 9 | **No retention policy implemented.** `sync_runs`, `sync_errors`, `sync_course_results` grow without bound. | MEDIUM | |
| 10 | **No monitoring or alerting.** | MEDIUM | Nobody would know sync had been failing for a week. |
| 11 | **No backup restore test.** | MEDIUM | Supabase takes backups; an untested restore is not a proven restore. |
| 12 | **No threat model document.** | MEDIUM | |
| 13 | **No legal documents.** ~~None existed.~~ **PARTIALLY ADDRESSED 2026-08-31.** Privacy policy, terms, cookie policy and disclaimer drafted from the schema and scope list, published at `/legal/*`, public in middleware, linked from a footer on both the app shell and the signed-out screen. **STILL OPEN:** never reviewed by a lawyer; controller legal name and the privacy/security contact addresses are unfilled placeholders. | CRITICAL for launch | Drafting is in scope; legal sufficiency is not. |
| 14 | **Google OAuth app is in Testing mode**, unverified. | CRITICAL for launch | See below. |
| 15 | ~~Dev `service_role` credentials exposed.~~ **RESOLVED 2026-08-30.** Both exposed credentials are dead: the `sb_secret_` key was replaced, and legacy JWT-based API keys were disabled project-wide. | ~~HIGH~~ CLOSED | See the incident log below. |

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

## OAuth scope inventory

Verified against `src/infrastructure/google/oauth.ts`. Must be re-checked at launch and kept in step
with the privacy policy.

| Scope | Sensitivity | Why required | Feature | Narrower option? |
| --- | --- | --- | --- | --- |
| `classroom.courses.readonly` | Sensitive | List courses so the student can choose which to track | Course discovery | None |
| `classroom.coursework.me.readonly` | Sensitive | Read coursework and due dates | Deadline feed | Already the `.me` variant |
| `classroom.student-submissions.me.readonly` | Sensitive | Know what is already submitted, and learn the student's Classroom user id without a roster scope | Feed filtering, source targeting | Already the `.me` variant |
| `classroom.topics.readonly` | Sensitive | Topic names are a section-targeting signal | Classification | None |

No write scopes. No roster scope. No profile scope. The student's Classroom user id is learned from
their own submission payloads specifically to avoid a broader scope.

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
placeholders in `src/app/legal/content.tsx` and must be filled before launch; grep for
`TO BE CONFIRMED`.

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
