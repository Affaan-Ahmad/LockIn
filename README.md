# LockIn

A personalised deadline layer over Google Classroom.

At this university one Google Classroom is shared by several sections — A, B, C, G and so on — and
teachers post section-specific assignments, labs, quizzes and deadlines into the same course. Most
of what a student sees in Classroom is not theirs. This backend answers one question per item:

> **Does this piece of coursework belong to this student, and when is it due?**

**Status: backend foundation only.** There is no frontend beyond the minimum needed to sign in and
exercise the API during development.

**Not production ready.** Security, privacy, Google API compliance and legal readiness are release
blockers for this project, tracked in [`docs/production-readiness.md`](docs/production-readiness.md)
— including the gaps that currently block launch and the external reviews that code cannot
substitute for.

---

## The one thing to understand first

Incorrect information is worse than missing information. If we wrongly hide an assignment, the
student misses a deadline; if we wrongly show one, they are mildly annoyed. Every design decision
in this repository leans in that direction, and three of them follow directly:

1. **Relevance is three-valued.** `RELEVANT` / `NOT_RELEVANT` / `UNCERTAIN`. Ambiguous coursework
   becomes UNCERTAIN and stays visible for review. It is never quietly discarded.
2. **Absence of your section is never evidence against you.** An unlabelled assignment is scoped
   `ALL_SECTIONS` and shown to everyone. Hiding requires positive evidence that the coursework
   names *other* sections, and the database has a `CHECK` that refuses to store a `NOT_RELEVANT`
   below 0.8 confidence — and another that refuses to pair one with an `ALL_SECTIONS` scope at all.
3. **Nothing is invented.** A due date with no due time stays a date with no time. It never becomes
   23:59, and coursework with no due date at all never enters the deadline feed.
4. **The student chooses their subjects.** Google reporting a course as still enrolled is not a
   reason to track it. Nothing is synchronised or shown until they opt in.

---

## Setup

### Requirements

- Node 20.11+
- A Supabase project
- A Google Cloud project with the Classroom API enabled

### 1. Install and configure

```bash
npm install
cp .env.example .env.local
```

Generate the token encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Put it in `GOOGLE_TOKEN_ENCRYPTION_KEY`. Fill in the Supabase and Google values. Every variable is
validated at first use by [`src/config/env.ts`](src/config/env.ts) — a missing or malformed value
fails loudly at boot with every problem listed at once, rather than surfacing as a confusing runtime
error later.

> Rotating `GOOGLE_TOKEN_ENCRYPTION_KEY` invalidates every stored refresh token. Users reconnect.

### 2. Apply the database schema

```bash
supabase db push
```

Or run the three migrations in order against your database:

| File | Contents |
| --- | --- |
| [`supabase/migrations/0001_schema.sql`](supabase/migrations/0001_schema.sql) | Tables, enums, constraints, indexes, triggers |
| [`supabase/migrations/0002_functions.sql`](supabase/migrations/0002_functions.sql) | Transactional batch operations and the read model |
| [`supabase/migrations/0003_rls.sql`](supabase/migrations/0003_rls.sql) | Row-level security, grants, new-user bootstrap |

### 3. Configure Google OAuth

In Google Cloud Console, enable the Classroom API and create an OAuth client. Add your Supabase
callback URL as an authorised redirect URI.

The application requests only these read-only scopes:

```
classroom.courses.readonly
classroom.coursework.me.readonly
classroom.student-submissions.me.readonly
classroom.topics.readonly
```

No roster scope, no profile scope, no write scope. The student's Classroom user id — needed for
Google's own assignee targeting — is learned from their own submission payloads instead of being
purchased with a broader scope.

In Supabase → Authentication → Providers → Google, enter the same client id and secret.

### 4. Create an academic profile

Classification needs to know the student's section. Insert a row for the signed-in user:

```sql
insert into academic_profiles (user_id, primary_section, program_code, batch, time_zone)
values ('<auth.users id>', 'G', 'BCS', '4', 'Asia/Karachi');
```

That produces the alias set `G`, `Section G`, `Sec G`, `Section-G`, `Sec-G`, `4G`, `BCS-4G`,
`BCS4G` automatically. Extra aliases can be added to `section_aliases`.

Without a profile the sync still runs and still stores coursework — it just writes no
classifications, and everything reads back as UNCERTAIN. Guessing a section would mean inventing
every verdict.

### 5. Choose which subjects to track

A Classroom account accumulates courses; last semester's are still ACTIVE and still enrolled.
Nothing is synchronised until the student opts in:

```bash
# Discover what is available (refresh=true re-reads from Google)
curl '.../api/courses?refresh=true'

# Opt in
curl -X PUT .../api/courses -d '{"courses":[{"courseId":"<uuid>","isTracked":true}]}'
```

`POST /api/sync` then discovers every course but fetches coursework only for the tracked ones.

### 6. Run it

```bash
npm run dev
```

| Endpoint | Purpose |
| --- | --- |
| `GET /api/auth/google` | Start the consent flow |
| `GET /api/connection` | Connection status (never returns a token) |
| `GET /api/courses` | Discovered courses with tracking state (`?refresh=true` re-reads Google) |
| `PUT /api/courses` | Choose which subjects to track |
| `POST /api/sync` | Run a sync — body `{ "mode": "FULL" \| "INCREMENTAL" }` |
| `GET /api/assignments/upcoming` | Deadline feed: tracked, dated, relevant — plus freshness |
| `GET /api/assignments/undated` | Tracked coursework Google gave no due date |
| `PUT /api/overrides` | Mark an assignment relevant or not |
| `DELETE /api/overrides` | Clear an override |

### Commands

```bash
npm run verify            # typecheck + lint + unit tests
npm run test:unit         # 302 tests, no I/O
npm run test:integration  # requires Supabase credentials; skips without them
npm run build
```

---

## Architecture

### Layering

```
  Next.js route handlers      thin: authenticate, validate, delegate, map errors
            │
  ┌─────────▼───────────────────────────────────────────┐
  │ application/    ports (interfaces) + services        │
  └─────────┬───────────────────────────────────────────┘
            │  depends only on ▼
  ┌─────────▼───────────────────────────────────────────┐
  │ domain/         pure. no I/O, no framework, no SDK   │
  └─────────────────────────────────────────────────────┘
            ▲  implements the ports
  ┌─────────┴───────────────────────────────────────────┐
  │ infrastructure/ Google adapter, Supabase repositories│
  └─────────────────────────────────────────────────────┘
```

The dependency rule is enforced by ESLint, not by convention:
[`eslint.config.mjs`](eslint.config.mjs) makes it a build error for anything under `src/domain/` to
import `next`, `react`, `@supabase/*` or `**/infrastructure/**`. A comment saying "domain must stay
pure" decays; a lint rule does not.

### Directory map

| Path | Responsibility |
| --- | --- |
| [`src/config/env.ts`](src/config/env.ts) | The only `process.env` read in the codebase |
| [`src/shared/`](src/shared/) | Errors, logging with redaction, retry, bounded concurrency, AES-GCM, fingerprints |
| [`src/domain/academic/`](src/domain/academic/) | Section normalisation and alias generation |
| [`src/domain/assignment/`](src/domain/assignment/) | Deadline value objects, lifecycle transitions |
| [`src/domain/classification/`](src/domain/classification/) | The mention tokeniser, scope rules, the scope resolver, the relevance classifier |
| [`src/domain/course/`](src/domain/course/) | Course tracking decisions |
| [`src/domain/sync/`](src/domain/sync/) | Sync outcome algebra, data freshness |
| [`src/application/ports/`](src/application/ports/) | Repository and source-adapter interfaces |
| [`src/application/services/`](src/application/services/) | Sync orchestration, Google credential lifecycle |
| [`src/infrastructure/google/`](src/infrastructure/google/) | Classroom client, Zod schemas, mapper, OAuth |
| [`src/infrastructure/supabase/`](src/infrastructure/supabase/) | Clients and repositories |
| [`src/app/api/`](src/app/api/) | Route handlers |

---

## Classification

Two questions, deliberately kept apart:

```
title / description / topic
        │
        ▼  SectionScopeResolver     — knows nothing about any student
  AssignmentSectionScope
    ALL_SECTIONS | ALL_SECTIONS_EXCEPT | SPECIFIC_SECTIONS | UNCERTAIN
        │
        ▼  RelevanceClassifier      — applies the student
  RELEVANT | NOT_RELEVANT | UNCERTAIN
```

Scope is a fact about the **assignment**: what did the teacher target? Relevance is a fact about
**this student**: does that include me? Fusing them is how "the student's section was not
mentioned, therefore this is not theirs" creeps into a codebase. Here it is not expressible — a
scope rule has no access to a student at all.

### The four cases

| Input | Scope | Student G sees |
| --- | --- | --- |
| `Assignment 3 - Section G` | `SPECIFIC_SECTIONS ["g"]` | RELEVANT |
| `Assignment 3 - Sections F/G` | `SPECIFIC_SECTIONS ["f","g"]` | RELEVANT |
| `Assignment 3 - Section A` | `SPECIFIC_SECTIONS ["a"]` | NOT_RELEVANT |
| `Assignment 3` | `ALL_SECTIONS` | RELEVANT |
| `Assignment for remaining sections` | `UNCERTAIN` | needs review |
| `Quiz 1 - all sections except B` | `ALL_SECTIONS_EXCEPT ["b"]` | RELEVANT |

The third row is the whole product; the fourth is the whole safety property. A teacher here labels
a post only when it is section-specific, so an unlabelled post is for everyone — `ALL_SECTIONS` at
confidence **1**, not a hedge. Routing unlabelled work to UNCERTAIN would put most of a shared
course into the review queue, and a queue full of ordinary coursework is a queue nobody reads.

`ALL_SECTIONS_EXCEPT` exists because we do not know how many sections a course has. Expressing
"all sections except B" as a `SPECIFIC_SECTIONS` list would mean inventing the roster.

### Precedence

1. **Manual override** — the student's own decision. Nothing outranks it.
2. **Google targeting** — an explicit `individualStudentsOptions` list. Source truth, not inference.
3. **Section scope** — everything above.

Fixed and short, because these three are not a variation point. The variation lives in the scope
rules underneath, which is where the extension point is.

### Why a tokeniser and not a substring match

Every one of these contains the letter G, and only two are section G:

| Text | Result | Why |
| --- | --- | --- |
| `Assignment 3 - G` | section G | Bare letter set apart by punctuation |
| `Assignment 3 - Section G` | section G | Keyword-scoped |
| `Group G presentation` | **no mention** | `group` is a deny-listed prefix |
| `Assignment G1` | **no mention** | Letter bound to a digit is an identifier |
| `a) Introduction` | weak only | Enumeration marker, never acted on |
| `All sections except G` | carve-out | Scope and exclusion parsed as one construct |

`All sections except G` earns the emphasis: a substring matcher sees "G" and marks the item
relevant to section G — the exact inverse of what the teacher wrote.

### The scope rules

| Priority | Rule | Recognises |
| --- | --- | --- |
| 500 | `AMBIGUOUS_SECTION_PHRASE` | "remaining sections", unscoped exclusions, unexpandable ranges |
| 450 | `UNIVERSAL_EXCEPT` | "all sections except B" |
| 400 | `EXPLICIT_ALL_SECTIONS` | "all sections" |
| 320 | `EXPLICIT_SECTION_WORD` | "Section G", "Sections F/G" in the title |
| 310 | `SECTION_SLASH_LIST` | "- F/G", "- G and H" in the title |
| 305 | `SECTION_ALIAS_CODE` | "BCS-4G", "4G" in the title |
| 200 | `TOPIC_SECTION` | a Classroom topic named for a section |
| 100 | `DESCRIPTION_SECTION` | a keyword-scoped mention in body text |
| 0 | `NO_SECTION_RESTRICTION_FOUND` | nothing — the unrestricted default |

Highest priority wins outright; lower ones are discarded, not blended. Rules that tie and agree are
merged by **union** (never intersection — that would drop a section and hide the item from its
students); rules that tie and disagree produce UNCERTAIN.

### Adding a naming convention

```ts
export const morningCohortRule: SectionScopeRule = {
  id: 'MORNING_SUFFIX_CONVENTION',
  priority: ScopePriority.TITLE_EXPLICIT + 1,
  evaluate: (context) => /* ... */ null,
};
```

Add it to `defaultScopeRules` in [`registry.ts`](src/domain/classification/registry.ts) and bump
`RULESET_VERSION`. Nothing else changes — there is a test in
[`section-scope.test.ts`](tests/unit/section-scope.test.ts) that registers exactly this rule and
asserts both that it works and that the shipped rules still behave identically.

The version bump carries the fix to rows already stored: it changes every classification
fingerprint, and because an incremental pass only revisits what Google recently touched, the sync
service detects a stale rule set and **escalates that run to a full pass**.

---

## Course tracking

A Google Classroom account accumulates courses. Last semester's Programming Fundamentals is still
`ACTIVE`, still enrolled, and full of coursework with no due dates. Google's course state says
nothing about whether the student wants it in their feed today.

```
listCourses()  ──▶  discover & store every course      (cheap: one paginated call)
                             │
                             ▼
                    student chooses subjects           (persisted; asked once)
                             │
                             ▼
                    tracked courses only  ──▶  listCourseWork() + submissions + classification
```

Discovery is complete and always runs — a student cannot choose a subject they were never shown.
Everything expensive happens below the tracking filter. An untracked course costs one row in a
listing and **zero** coursework or submission requests.

`course_tracking` is a separate table from `courses` for the same reason
`classification_overrides` is separate from `assignment_classifications`: `courses` is rewritten by
every discovery pass, and a student's choice must not live anywhere a sync can overwrite it. The
sync pipeline has no write path to it, and there is a test asserting the write log stays empty
across two full runs.

Three states, not two: no row means *not chosen yet*, `is_tracked = false` means *chosen and
declined*. Only the first should prompt the student.

Google archiving a course does **not** untrack it. Flipping tracking off automatically would drop
the course out of every tracked query, which is indistinguishable from data loss to the person
looking at the screen.

---

## Deadlines and the two feeds

The application is a deadline tracker, so the feed requires a deadline:

```sql
join course_tracking ... where is_tracked   -- untracked subjects never appear
and a.due_sort_at is not null               -- undated coursework never appears
and coalesce(override, classification) = any (:relevance)
```

Coursework Google gave no due date for is still the student's work, so it is stored and reachable —
through `app_undated_assignments` and `GET /api/assignments/undated`, a separate query with its own
sort order. It is not a frontend filter over a feed that should never have contained it, and it is
emphatically not solved by inventing 23:59 or today's date.

The same rule exists twice on purpose: as a pure predicate in
[`feed.ts`](src/domain/assignment/feed.ts), unit-tested in isolation, and as SQL, integration-tested
against Postgres. A test asserts the two lists **partition** cleanly — nothing appears in both,
nothing falls between them.

---

## Synchronisation

```
acquire lease            ← partial unique index; stale leases reclaimed under an advisory lock
      ↓
list courses             ← paginated, validated, mapped, batch-upserted
      ↓
per course, bounded concurrency (default 4)
      ├── topics
      ├── coursework      ← orderBy updateTime desc, early stop at the watermark
      └── submissions     ← ONE request for the whole course via courseWorkId="-"
      ↓
batch upsert  →  reconcile disappearances (only if the listing was COMPLETE)
      ↓
classify changed items   ← pure, in memory, two queries per course
      ↓
record per-course results and issues  →  finalise: SUCCESS | PARTIAL_SUCCESS | FAILED
```

Two API details carry most of the performance weight:

- **`courseWorkId="-"`** lists every submission a student has in a course in one paginated call.
  Without it, a 500-item course means 500 requests against a quota-limited API.
- **`orderBy=updateTime desc`** lets an incremental sync stop paging the moment it crosses the
  stored watermark. Classroom has no server-side `updatedAfter` filter, so this ordering is the
  only mechanism available.

Because an incremental pass then holds only a *prefix* of the course, it reports
`completeness: PARTIAL` and **the disappearance reconciler is skipped**. An incremental sync can
never delete anything. This is enforced in two places — the sync service checks before calling, and
[`assignment.repository.ts`](src/infrastructure/supabase/repositories/assignment.repository.ts)
throws if called with a non-complete listing anyway.

No database transaction spans a network call. Google is contacted, the response is fully in memory,
and only then does a short transactional batch write run.

### Partial success is a real outcome

```json
{
  "status": "PARTIAL_SUCCESS",
  "counts": { "coursesProcessed": 6, "coursesSucceeded": 5, "coursesFailed": 1,
              "assignmentsCreated": 3, "assignmentsUpdated": 8, "uncertainCount": 2 },
  "courses": [{ "sourceCourseId": "...", "status": "FAILED", "completeness": "FAILED" }]
}
```

One course failing on a 403 does not discard the other five courses' work, and it is a materially
different situation from a revoked token that failed everything. Returning `"Sync failed"` for both
throws away the information the student needs in order to know whether to trust their list.

### Disappearance

Coursework vanishing from a response is weak evidence: pagination truncation, a partial outage, a
permission change and a network failure all look identical to deletion. So nothing is ever hard
deleted. An absent item accrues a missing streak and only reaches `SOURCE_REMOVED` after **two
consecutive complete listings**. `SOURCE_MISSING` items stay visible to the student throughout.

---

## Data model

Source data, derived data and user decisions live in three separate tables with three separate
owners:

| Table | Owner | Written by |
| --- | --- | --- |
| `assignments` | Google | sync only |
| `assignment_classifications` | the classifier | sync only |
| `classification_overrides` | the student | the override route only |
| `course_tracking` | the student | the courses route only |

`assignment_classifications` stores both halves side by side and separately: `scope_type` /
`scope_sections` / `scope_rule` describe what the coursework targeted, while `relevance` /
`confidence` describe what that means for this student. A wrong verdict can be traced to whichever
half was wrong.

The sync pipeline has **no write path at all** to `classification_overrides`. Not a discouraged
one — none. `app_upsert_classifications` contains no statement touching that table, and
`ClassificationRepository` exposes no method to write it. "A sync will not erase what I decided" is
therefore a structural property rather than a promise, and it is covered by tests at both levels.

### Per-user projection

Courses and assignments are stored **per user** rather than as shared entities with a join table.
Shared rows would mean one student's sync writing rows another student reads — a cross-tenant write
path, a much more complex RLS story, and one incremental watermark shared between users whose syncs
run at different times. Duplication is roughly ten course rows per student, which is not worth
avoiding at that price. These rows are a projection of Google's state, not a canonical registry.

### Invariants enforced by the database

```sql
UNIQUE (user_id, source, source_item_id)              -- repeated sync cannot duplicate
UNIQUE (assignment_id) ON submissions                 -- one submission per student per item
CREATE UNIQUE INDEX ... ON sync_runs(user_id) WHERE status = 'RUNNING'

CHECK ((due_precision='EXACT'     AND due_at IS NOT NULL AND due_time_raw IS NOT NULL)
    OR (due_precision='DATE_ONLY' AND due_at IS NULL     AND due_date_raw IS NOT NULL)
    OR (due_precision='NONE'      AND due_at IS NULL     AND due_date_raw IS NULL))

CHECK (relevance <> 'NOT_RELEVANT' OR confidence >= 0.8)   -- no timid hiding
CHECK (relevance <> 'UNCERTAIN'    OR confidence <  0.8)

-- Coursework for everyone can never be hidden from anyone. ALL_SECTIONS is the
-- default scope for unlabelled work, so a bug pairing the two would hide most
-- of a shared course from every student.
CHECK (scope_type <> 'ALL_SECTIONS' OR relevance <> 'NOT_RELEVANT')

-- A scope naming sections must actually name some.
CHECK ((scope_type IN ('ALL_SECTIONS','UNCERTAIN')            AND cardinality(scope_sections) = 0)
    OR (scope_type IN ('ALL_SECTIONS_EXCEPT','SPECIFIC_SECTIONS') AND cardinality(scope_sections) > 0))
```

The confidence floor is the schema refusing to let a buggy rule hide a student's coursework. A
violation is a write failure, which is loud, rather than a missing assignment, which is silent.

### Indexes

| Index | Query it serves |
| --- | --- |
| `assignments(user_id, due_sort_at) WHERE lifecycle IN (ACTIVE, SOURCE_MISSING) AND source_state='PUBLISHED'` | The hot path. Partial, so years of archived work never enter the tree |
| `assignments(course_id, source_updated_at DESC)` | Incremental watermark comparison |
| `assignments(user_id, source, source_item_id)` UNIQUE | Upsert conflict target |
| `assignment_classifications(user_id, relevance) INCLUDE (assignment_id, confidence)` | "Show my UNCERTAIN pile" without a heap fetch |
| `sync_runs(user_id, finished_at DESC) WHERE status IN (SUCCESS, PARTIAL_SUCCESS)` | Freshness lookup |
| `course_tracking(user_id, course_id) WHERE is_tracked` | The tracking filter every feed query joins through — partial, because three to six rows out of however many courses the account has |
| `assignments(user_id, course_id) WHERE due_sort_at IS NULL AND ...` | The undated query, which the partial index above deliberately excludes |
| `assignment_classifications(user_id, scope_type) WHERE scope_type='UNCERTAIN'` | The review queue |

`due_sort_at` is maintained by trigger and exists **only** for `ORDER BY`. A `DATE_ONLY` item sorts
at the start of its UTC day. It must never be rendered as a deadline — the student was not given a
time, and showing one would be inventing data. The read model returns `due_precision` alongside
every deadline so a consumer physically cannot make that mistake.

---

## Deadlines

Google returns `dueDate` and `dueTime` as two independently-optional fields, **both in UTC**. Two
mistakes are common and both are silent:

1. Treating them as the teacher's local time, shifting every deadline by the UTC offset.
2. Filling a missing `dueTime` with 23:59, manufacturing a deadline the student was never given.

Precision is therefore part of the type:

```ts
type DuePrecision = 'EXACT' | 'DATE_ONLY' | 'NONE';
```

A `DATE_ONLY` deadline carries no instant at all, and `deadlineInTimeZone()` returns `null` for it —
so no formatter, anywhere, can manufacture a wall-clock time for an item that never had one.
[`tests/unit/deadline.test.ts`](tests/unit/deadline.test.ts) covers UTC interpretation, midnight
crossings, both DST transitions in `Europe/London`, leap days, and every missing-field combination.

---

## Google authorisation

**Supabase Auth does not refresh Google provider tokens.** It surfaces `provider_token` and
`provider_refresh_token` once, in the session created at the OAuth callback, and then forgets them.
An application that assumes otherwise works perfectly in development and breaks about an hour after
the first real user signs in.

So there are two separate credential systems:

- the **Supabase session** — who the user is in *our* app;
- the **`google_connections` row** — our authorisation to call Classroom *on their behalf*.

[`GoogleTokenService`](src/application/services/google-token.service.ts) is the only code that
reads a refresh token, decides whether an access token is usable, calls Google's token endpoint,
persists a rotated credential, or concludes that consent is gone. Callers receive
`GoogleCredentialProvider`, whose single method returns an access token — they cannot see the
refresh token, cannot see expiry, and cannot write. Duplicated refresh logic has nowhere to appear.

Concurrent refreshes for one user are collapsed into a single in-flight request. Without that, a
sync fanning out over six courses fires six refreshes; Google rotates the refresh token on one and
invalidates the rest, and the student is told to reconnect for no reason.

`invalid_grant` marks the connection `REVOKED` and is never retried. A transient 5xx does **not**
mark it broken — pushing a student through a consent flow because Google had a bad minute is the
wrong trade.

---

## Security

- **RLS on every user-owned table**, with the same predicate everywhere:
  `user_id = (select auth.uid())`. Both `USING` and `WITH CHECK` on every writable policy — `USING`
  alone would let a user update a row they own into one they do not.
- **`google_connections` has RLS enabled with no policies at all**, plus `FORCE ROW LEVEL SECURITY`.
  No client role can reach it. Only the service role can, and it is used in exactly two places.
- **Tokens are encrypted at rest** with AES-256-GCM, with the user id as additional authenticated
  data — a ciphertext copied between rows fails authentication rather than decrypting into someone
  else's live credential. RLS protects the API surface; encryption protects backups, replicas and
  support exports.
- **The sync pipeline runs as the signed-in user**, not the service role. A bug in a repository
  filter is caught by a policy instead of becoming a data leak.
- **The logger redacts unconditionally** — any field whose key contains `token`, `secret`,
  `authorization`, `credential`, `cookie`, `session` and so on, at any nesting depth, plus all
  binary. There is no way to opt out and no call site has to remember.
- **Route handlers return a whitelist of error codes.** Everything else becomes a generic message;
  the cause chain stays in the logs.

---

## Testing

```
302 unit tests      no I/O, no network, no database
 27 integration     real Postgres, real RLS; skipped when credentials are absent
```

The unit tests are structured around what can go wrong rather than around code coverage:

| File | What it protects |
| --- | --- |
| [`section-mentions.test.ts`](tests/unit/section-mentions.test.ts) | The tokeniser against every string that breaks substring matching |
| [`section-scope.test.ts`](tests/unit/section-scope.test.ts) | All four scope cases, precedence, conflict → UNCERTAIN, override supremacy, the confidence floor, OCP |
| [`course-tracking.test.ts`](tests/unit/course-tracking.test.ts) | Feed eligibility, the undated partition, tracking surviving archival |
| [`deadline.test.ts`](tests/unit/deadline.test.ts) | UTC, DST both directions, missing components, invalid dates |
| [`classroom-client.test.ts`](tests/unit/classroom-client.test.ts) | Pagination, early stop reporting a prefix, retry policy, 401/403/429 |
| [`classroom-mapper.test.ts`](tests/unit/classroom-mapper.test.ts) | Validation rejection, absent-vs-empty, fingerprint completeness |
| [`classroom-sync.service.test.ts`](tests/unit/classroom-sync.service.test.ts) | Partial failure, no-deletion-from-prefix, override survival, concurrency bound |
| [`google-token.service.test.ts`](tests/unit/google-token.service.test.ts) | Rotation, revocation, transient-failure tolerance, refresh collapsing |
| [`shared.test.ts`](tests/unit/shared.test.ts) | Redaction, AES-GCM, retry, lifecycle, freshness |

That the sync service can be tested end to end with no Google and no Postgres is the practical
proof that the layering works. The in-memory doubles are in
[`tests/helpers/fakes.ts`](tests/helpers/fakes.ts).

The integration tests assert what only a real database can demonstrate: that a repeated sync
produces no duplicate, that a `CHECK` constraint rejects an incoherent deadline, that a manual
override survives a full re-sync and wins in the read model, that reconciliation needs two strikes,
that a second concurrent sync is refused, that an expired lease is reclaimed as `ABANDONED`, and
that user B cannot read user A's coursework, classifications, overrides or sync errors.

### Regression policy

Every classification bug gets a row in the relevant table-driven test before or alongside the fix.
Rules are pure functions over a plain context object, so reproducing one is a matter of adding a
string, not building a fixture.

---

## Extension points

Each of these is "add a file", not "edit a switch":

| Future need | What you add | What you change |
| --- | --- | --- |
| Another university's section naming convention | `SectionScopeRule` | one line in the registry |
| A new classification strategy, including AI | `SectionScopeRule` at a chosen priority | one line in the registry |
| Moodle, an LMS, email, calendar | `AcademicSourceAdapter` | nothing — `assignments.source` is already a discriminator with its own uniqueness scope |
| Manual assignments | `ManualSource` adapter | nothing |
| Notification channels | `NotificationChannel` port; the deadline engine emits, never sends | nothing |
| Another university's section convention | `SectionAliasGenerator` | nothing |
| Deadlines parsed from description text | `DeadlineExtractionStrategy` | the resolver list |

`assignments` carries no Google-specific column that a Moodle row could not fill. Google's
identifiers live in `source` + `source_item_id`, which is why adding a second source does not
require reshaping the assignment model.

Deliberately **not** abstracted: repositories have concrete method names shaped by real queries
(`findUpcoming`, `reconcileMissing`), not `findAll`/`findOne`. No interface exists where only one
implementation is ever plausible.

---

## Known limitations

1. **Classroom exposes no section targeting for this use case.** `courses.section` is a
   course-level string; the university's sections live in free text inside post titles and topics.
   This is the irreducible risk, and the reason UNCERTAIN exists.
2. **No server-side `updatedAfter` filter** on `courseWork.list`. Incremental sync relies on
   ordering plus early stop, which is why incremental runs are gated out of deletion.
3. **`individualStudentsOptions` is often hidden from students**, so source targeting usually
   abstains rather than confirming.
4. **A student's scope may omit coursework not assigned to them**, so absence is never treated as
   evidence of non-relevance.
5. **A section named in a long description can hide an assignment.** `DESCRIPTION_SECTION` accepts
   only keyword-scoped mentions ("Section B") and program codes, never a bare letter, and sits at
   the lowest priority — but a description that discusses another section's logistics can still
   produce a `SPECIFIC_SECTIONS` scope. If that proves noisy in practice, the fix is to lower that
   one rule to UNCERTAIN rather than to change anything else.
6. **No caching layer.** Stale deadlines are a correctness hazard, so freshness is made *visible*
   through `lastSuccessfulSyncAt` / `syncStatus` rather than hidden behind a TTL.
7. **Scheduled sync is not implemented.** The current pipeline runs inside an authenticated request
   so it can use the user's own JWT and stay inside RLS. A background scheduler would need an
   explicit service-role path with per-user scoping.
