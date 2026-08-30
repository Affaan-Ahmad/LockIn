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
all. Each is implemented and unit-tested; none is verified against a live database yet.

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
| 1 | **No account deletion.** No endpoint, no cascade test, no documented procedure. | CRITICAL | Legally required in several plausible jurisdictions. Cannot publish a privacy policy promising deletion without it. |
| 2 | **No Google disconnect.** `GoogleOAuthHttpClient.revoke()` is implemented and **never called** — dead code. | CRITICAL | Users must be able to withdraw access, and revocation must actually reach Google. |
| 3 | **No inbound rate limiting.** `POST /api/sync` and `GET /api/courses?refresh=true` reach Google on every request. | HIGH | The sync lease bounds concurrency, not frequency. Risks our Google quota and our own infrastructure. |
| 4 | **No security headers / CSP.** `next.config.mjs` sets none. | HIGH | Needed before any frontend exists, not after. |
| 5 | **No CI.** No typecheck/lint/test gate, no dependency scan, no secret scan. | HIGH | |
| 6 | **OAuth callback `state` handling unverified.** `exchangeCodeForSession` is assumed to validate PKCE; not confirmed. | HIGH | Must be read and proven, not assumed. |
| 7 | **The entire SQL layer has never been executed.** ~1,100 lines of DDL and plpgsql. | HIGH | Every RLS and constraint claim above is currently an argument from reading code. 27 integration tests exist to settle it. |
| 8 | **No data export.** | MEDIUM | Required if GDPR/UK GDPR applies. |
| 9 | **No retention policy implemented.** `sync_runs`, `sync_errors`, `sync_course_results` grow without bound. | MEDIUM | |
| 10 | **No monitoring or alerting.** | MEDIUM | Nobody would know sync had been failing for a week. |
| 11 | **No backup restore test.** | MEDIUM | Supabase takes backups; an untested restore is not a proven restore. |
| 12 | **No threat model document.** | MEDIUM | |
| 13 | **No legal documents.** No privacy policy, terms, or security contact. | CRITICAL for launch | Drafting is in scope; legal sufficiency is not. |
| 14 | **Google OAuth app is in Testing mode**, unverified. | CRITICAL for launch | See below. |
| 15 | **Dev `service_role` credentials exposed.** Both the `sb_secret_` key and the legacy `service_role` JWT for project `vkihrrhqduysjmmqggnm` were pasted into a chat transcript on 2026-08-30. The `sb_secret_` value has been removed from `.env.local`; the legacy JWT remains valid until legacy keys are disabled. | HIGH | See the incident log below. |

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

**Outstanding:**

- [ ] Create a new `sb_secret_` key and paste it into `.env.local` (Project Settings → API Keys)
- [ ] Revoke the exposed `sb_secret_` key
- [ ] Kill the legacy `service_role` JWT — disable legacy JWT keys (preferred, this project uses the
      new format) or roll the JWT secret
- [ ] Confirm no production project ever reuses this development project's keys

Must be done **before** any of: the first real user connecting a Google account, any deployment
reachable from the internet, or the production project being created. Not "before launch" — before
the database stops being empty.

**Lesson.** A credential does not need to be sent to be used. Secrets go into `.env.local` directly
and are never pasted into a chat, a ticket, or a commit.

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
| Submission state, lateness, grades | Classroom | Filter completed work | `submissions` | TBD | TBD |
| Classification verdicts, scope, evidence | Derived | Explainability, audit | `assignment_classifications` | TBD | TBD |
| Manual overrides, course tracking | Student decisions | Product behaviour | `classification_overrides`, `course_tracking` | TBD | TBD |
| Google access + refresh tokens | OAuth | Call Classroom on the student's behalf | `google_connections`, **encrypted** | Until disconnect/deletion | Revoke + delete |
| Sync history and errors | Internal | Debugging, freshness | `sync_runs`, `sync_errors`, `sync_course_results` | **TBD — currently unbounded** | TBD |

Note that **grades** are stored (`assigned_grade`, `draft_grade`). That raises the sensitivity of
this database and belongs in the privacy policy explicitly. Whether the product needs them at all is
worth revisiting — minimal collection is the standing rule, and nothing currently reads them.

## Subprocessors

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
