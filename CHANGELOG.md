# Changelog

Notable changes to LockIn, newest first.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [Semantic Versioning](https://semver.org/). While the major
version is 0, a minor bump may carry breaking changes; those are called out
under **Migration** so they are impossible to miss.

The version here is the one `package.json` declares and the app reports at
`/api/version` and in Settings, so a bug report can always name the build it
came from.

---

## [0.5.2] — 2026-09-06

### Fixed

- **The installed app's icon sat in a white circle instead of filling its
  shape.** A white plate is Android saying it was handed an icon it could not
  mask, so it shrank a copy and centred it. The manifest has declared a proper
  `purpose: "maskable"` icon since 0.3.x, and it checks out against every
  documented requirement: 512x512, served as `image/png`, drawn edge to edge
  with no transparency, and the mark 164px from centre against a 205px safe
  zone. The assets were not the problem.

  The URLs were. The icon routes are static, their paths never move, and they
  are served `immutable` with a one-year max-age. An installed Android app is
  minted once from those URLs, and Chrome decides whether to refresh it by
  diffing the manifest — so an unchanged URL reads as an unchanged icon and
  nothing is re-fetched, however wrong the copy already installed. Every icon
  URL now carries a revision that is bumped by hand when the pixels change,
  which makes the URL itself the thing that changed.

  **This is a likely cause, not a confirmed one.** What is confirmed is that
  the manifest and the images served are correct, so the stale copy is on the
  device. If a fresh install still shows a plate, the cause is elsewhere.

- **Accepting every Classroom permission still ended at "Some Classroom
  permissions were not granted."** Observed in production: consent completed,
  and Google sent the student to
  `/welcome?connection=insufficient_scopes` anyway, with the connection stored
  `NEEDS_RECONNECT`. Reconnecting was the advice on the screen and could not
  work — a second consent produces the same token and the same verdict.

  Nothing was wrong with the grant. Google reports the *permission* it granted,
  not the scope string that was asked for, and it treats
  `classroom.student-submissions.me.readonly` and
  `classroom.coursework.me.readonly` as one permission. A token granted both is
  described by `tokeninfo` as carrying only one of the two names, so comparing
  Google's answer against the requested list by string identity found a complete
  grant one permission short.

  The first attempt at this fix aliased coursework to submissions and no
  further, on the reasoning that coursework access subsumes reading one's own
  submissions but not the reverse. That describes the APIs, not what Google
  reports: a live diagnostic on the deployed fix, after a complete consent,
  came back naming `student-submissions.me.readonly` with
  `coursework.me.readonly` absent, and the connection was stored
  `NEEDS_RECONNECT` / `INSUFFICIENT_SCOPES` exactly as before.

  So either name is accepted now, and nothing reads which one came back. That
  submissions-named shape is the only one ever observed; the coursework-named
  one is neither demonstrated nor ruled out, and relying on the observed name
  being the one Google always picks would repeat the guess that caused the
  fault. Accepting either buys no extra access: the pair is needed only for the
  coursework and submissions calls, and the courses and topics calls have their
  own unaliased scopes.

  A grant carrying neither name is still refused, and now says so once rather
  than twice — the pair is one line on the consent screen, so "Still needed"
  lists one permission for it instead of asking a student to grant two things
  they declined once. The requested scope set is unchanged, and
  `granted_scopes` still records exactly what Google reported.

---

## [0.5.1] — 2026-09-06

### Fixed

- **The status bar was an off-white strip above the app in dark mode, on the
  installed Android app.** The page itself was never the problem: the inline
  boot script corrects the `theme-color` meta tag before the first paint, and
  the pinned CSP hash still matches, so it was running. The manifest was the
  one colour nothing could reach — it declared the *light* ground as
  `theme_color`, and Chrome bakes that value into the installed app, where the
  meta tag does not govern the system status bar.

  A manifest carries a single `theme_color` with no dark variant, so it is now
  the dark ground for both themes. That is a deliberate trade: a dark status bar
  above a light app is what most Android apps look like, whereas an off-white
  strip above a near-black one reads as a rendering fault. Both manifest
  colours now come from the same constants the boot script uses, and a test
  fails if either is written as a bare hex literal again.

  **This one is not instant.** Android refreshes an installed app's baked
  colours on its own schedule, usually within a day or so. Reinstalling from the
  browser applies it immediately.

## [0.5.0] — 2026-09-06

### Added

- **The Google connection now records the permissions actually granted, not the
  ones LockIn asked for.** The consent screen lets you untick individual
  permissions, and the callback used to write the full requested list into
  `granted_scopes` regardless — so a partial consent was stored as a complete
  one, every screen reported the account as connected, and the problem surfaced
  later as an unexplained Google error in the middle of a sync. Supabase's
  session carries the token but nothing about what it may do, so the grant is
  now checked against Google directly and the answer is what gets saved.

  Four outcomes, kept distinct because they need different things from you:
  connected; connected but missing permissions; connected with nothing able to
  renew it after about an hour; and *we could not ask Google*. The last writes
  nothing at all — an outage says nothing about your consent, and must not
  overwrite a connection that was working.

- **Sync refuses an incomplete grant up front**, before a run is claimed and
  before the rate limit is spent, and says which permission is missing. It used
  to start, fail somewhere in the middle, and present a permissions problem as a
  broken sync.

### Fixed

- **A resumed sync could be failed out from under itself.** `app_fail_sync_run`
  checked that the caller held the lease and then ignored the answer, marking
  every unfinished course FAILED for anyone who knew a run id. A worker that
  stalled, was declared dead and came back did exactly the damage the check
  existed to prevent: the worker that had legitimately taken over found its
  queue emptied and finished a run that had never attempted those courses. You
  were told your coursework could not be read when nothing had tried to read it.

- **Connection messages reached a page nobody sees.** They were attached to `/`,
  but a half-configured account is bounced from `/` to `/welcome` and the query
  string is dropped on the way — so "couldn't connect" was written to a URL that
  was never loaded. Every outcome now lands on `/welcome`.

- **A Google refresh token that will not decrypt no longer destroys the row it
  is stored in.** Treated as merely absent, it looked identical to never having
  granted offline access, and the connection was overwritten as needing a
  reconnect — for a fault no reconnection can fix, with the evidence gone.
  Nothing is written now, and restoring the correct
  `GOOGLE_TOKEN_ENCRYPTION_KEY` brings the account back with no action from you.

### Changed

- CI's dependency audit can fail the build again. It ended in `|| true`, excused
  by a postcss advisory reached through Next and believed to need a major
  framework upgrade — which was wrong. A scoped `next -> postcss` override lifts
  that one edge, the audit reports zero vulnerabilities, and a gate that cannot
  fail is not a gate.
- `AGENTS.md` sets out how an orchestrating agent delegates implementation work
  in this repository, including the caution areas each drawn from a real
  incident here.

### Migration

- **Apply `supabase/migrations/0013_fail_run_fencing.sql`.** It is `create or
  replace` and safe to run twice. Applying it is deliberate rather than forced,
  because the function signature is unchanged: code from this release runs
  perfectly happily against a database still on `0012`, with the race above
  still open and no error to notice.

## [0.4.3] — 2026-09-05

### Fixed

- **Sync stopped creating runs at all, and the button sat on "Still working".**
  A plpgsql function declared `returns sync_runs` answers with SQL NULL when it
  has nothing to return — `app_resume_sync_run` does exactly that whenever no
  run is queued, which is most of the time. PostgREST does not render that as
  `null`; it renders an object whose every column is null, which is truthy and
  passes any `!== null` check written against it.

  So `resume()` produced a lease with a null run id, `startOrResume` concluded
  it had adopted a run and never called `start()` — no run was ever created —
  and the endpoint still answered 202 with `syncRunId: null`, which the client
  polled until it gave up. The rate limit was consumed each time, so repeated
  attempts eventually exhausted it too.

  Guarded in three places: the repository refuses to build a lease without an
  id, `startOrResume` will not adopt one, and the client rejects a null id
  rather than only a missing one. The same trap in the work-item unwrapper had
  been guarded before but only on the object form, not the one-element-array
  form PostgREST also uses — both now guard after unwrapping.

## [0.4.2] — 2026-09-05

### Fixed

- **Automatic sync exhausted the rate limit, which presented as sync refusing to
  start.** A reload was allowed to bypass the anti-stampede cooldown, but
  Navigation Timing describes the *document* load and a client-side route change
  creates no new entry — so after opening the app with a reload, every screen
  for the rest of the session still saw `reload` and skipped the cooldown.
  Moving Today → Upcoming → Courses → Settings fired four syncs in seconds; a
  couple of passes exhausted the ten-per-ten-minutes budget and every further
  request, manual ones included, was refused. The reload grant is now spendable
  once per document load, after which the cooldown governs as intended.
- The sync button no longer sits on "Starting…" indefinitely. It said so until a
  status poll succeeded, and a poll that kept being refused left the text
  unchanged — which reads as a frozen button rather than as work in progress. It
  now reports the run as under way the moment it is claimed, and says so plainly
  if it loses the ability to follow it.
- The Settings control stays at the top right of the header on mobile and in the
  installed app. A long page title wraps the header, leaving the control alone on
  the second row where `space-between` had nothing to align it against, and it
  drifted inward.

## [0.4.1] — 2026-09-05

### Added

- Page and control motion, via `framer-motion`, honouring `prefers-reduced-motion`
  through `MotionConfig reducedMotion="user"`.
- The browser and installed-app chrome colour now follows the theme. The
  synchronous boot script sets it before first paint and `ThemeChrome` keeps it
  in step with an explicit theme choice or a system change afterwards.

### Changed

- `themeColor` moved out of Next's metadata export and into a single mutable
  `<meta name="theme-color">`. The metadata API emits media-query variants,
  which a script cannot update; one tag can be corrected before paint.
- The theme boot script's CSP hash is regenerated. It is pinned by content, so a
  stale hash would have the script blocked outright — a test recomputes the
  digest from the constant and fails if the two drift.

### Note

- `framer-motion` adds roughly **40 kB** to the first load of every interactive
  page (`/welcome` 109 → 149 kB, `/courses` 112 → 152 kB, `/settings` 137 → 176
  kB). The static legal pages are unaffected. The provider sits in the root
  layout, so the cost is paid everywhere the app is interactive.

## [0.4.0] — 2026-09-05

### Changed

- **Frontend redesign.** A workspace layout for desktop and a more tactile
  mobile presentation, built on the existing OKLCH palette rather than replacing
  it. Design tokens and layout primitives moved into `src/app/tokens.css` and
  `src/app/workspace.css`; `design.md` and `docs/frontend-audit.md` record the
  system and the audit behind it.
- **Sync status now says what actually happened.** The banner previously read
  "Couldn't refresh Classroom" whenever data was merely old, which is what made
  the original incident so hard to diagnose — a stale banner and a failed one
  were the same sentence. A failed or abandoned run, a partial run, a run in
  progress and simply-old data now each say so. Extracted to
  `status-presentation.ts` with tests.
- The Review badge counts what the Review screen actually shows. It previously
  counted only upcoming uncertain work while the screen also listed overdue and
  undated items, so the number and the page disagreed.

### Legal

- **Privacy policy corrected against the implementation.** The scope disclosure
  said LockIn asks Google for "four things and nothing else"; signing in also
  uses the basic Google identity permissions, which is how the email this same
  policy says it stores is obtained, and which the consent screen displays.
- Added the Google API Services User Data Policy Limited Use statement to the
  privacy policy and the public landing page.
- Added a pre-OAuth disclosure at both points where the Google flow starts,
  naming the four Classroom permissions, what they are used for, and that the
  access is read-only.
- Retention no longer claims a 90-day sync-history window: the pruning function
  exists but nothing schedules it.
- The export no longer claims to contain "everything"; the categories it omits
  are named.
- Deletion now distinguishes removal from the live database — immediate — from
  provider backups and request logs, which expire on their own schedules.
- Absolute claims softened where the code cannot prove them: "never shared"
  became "does not disclose", "nobody buys it" became "does not sell your
  personal data", and Google revocation on deletion is described as attempted
  rather than guaranteed, which is what the code does.
- Cookie policy corrected: local storage holds two values, not one.

## [0.3.2] — 2026-09-05

### Added

- **A maskable icon for Android launchers.** The manifest previously offered
  only `purpose: "any"`, which Android cannot crop to its own shape — so Chrome
  centred a shrunken copy on a white plate, giving a small lime square inside a
  white circle beside every app that fills its shape properly. `/maskable-icon`
  runs edge to edge with the mark inside the 80% safe zone, verified to leave no
  pixel outside a circular crop.

### Fixed

- `/maskable-icon` was redirected to `/welcome` by the auth middleware, whose
  matcher excluded `icon` and `apple-icon` but not this. A launcher fetches
  icons with no session, so Android would have received an HTML page where it
  expected a PNG.

### Note

- An already-installed PWA keeps the icon it was installed with. Reinstall to
  pick up a new one; nothing server-side can change a launcher shortcut.

## [0.3.1] — 2026-09-05

### Fixed

- Pull-to-refresh, Ctrl+R and the browser's refresh button are honoured even
  inside the automatic-sync cooldown. The cooldown exists to stop *automatic*
  triggers stampeding when someone moves between screens; applying it to a
  deliberate request meant a student pulled down, saw nothing happen, and
  reasonably concluded the app was broken. A reload still respects the freshness
  rule — data thirty seconds old is not worth re-fetching however firmly it is
  asked for.

### Known gap

- The installed app has no pull-to-refresh at all. Chrome and iOS both suppress
  the native gesture in `display: standalone`, so there is no reload to detect.
  The Sync button is the only manual refresh there.

## [0.3.0] — 2026-09-05

### Added

- **Classroom syncs by itself when you open the app.** A screen whose data has
  aged past the comfort window refreshes in the background as it loads, and
  swaps the result in when it arrives. Nothing blocks: the page renders with
  what was already stored, exactly as before.

  Deliberately not a scheduler. Vercel's free tier caps cron at once per day
  with an hour of jitter, which for a deadline product is close to useless — an
  assignment posted at nine could sit unseen until the following afternoon.
  Refreshing on arrival makes the data current at the only moment freshness is
  worth anything: when somebody is looking at it. It also costs nothing and has
  no quota to exhaust.

  A revoked Google grant is left alone rather than retried, since every attempt
  would fail identically and consume a rate-limit slot the reconnect prompt
  cannot use. A five-minute cooldown, shared across tabs, stops a student moving
  between screens from firing a sync per screen.

## [0.2.1] — 2026-09-05

### Fixed

- **A dead sync run locked the account out of syncing permanently.**
  `app_start_sync_run` reclaims a run whose worker died into `QUEUED` — correct,
  because the courses it finished are still worth keeping — and then refused to
  start because a `QUEUED` run existed. It blocked on the row it had just
  created, so every subsequent press answered "a sync is already running" about
  a run nothing was working on. The only code that could clear it was the
  continuation endpoint, reachable from a handing-over worker and the daily
  sweep and from nowhere a person could press.

  Pressing sync now adopts a queued run rather than refusing, which is also the
  better behaviour on its own terms: the completed courses stay completed. A run
  that genuinely holds a live lease is still refused.

## [0.2.0] — 2026-09-05

### Migration

Requires database migrations `0011` and `0012`. **Apply them before deploying
this version.** The application calls `app_start_sync_run` and friends, which do
not exist until `0012` runs, and `0012` drops the three-argument
`app_finalize_sync_run` that the previous version calls — so a deploy that gets
ahead of the migration fails every sync.

```bash
npx supabase db push
```

No user action is required, and no user data is destroyed.

### Added

- **Synchronisation is now durable and resumable.** A sync claims a run and
  returns immediately; the work proceeds in bounded units, one course at a time,
  with each result written before the next begins. An invocation that is
  terminated hands over cleanly, and whatever it finished stays finished.
- Per-course work queue, so the set of unfinished courses *is* the checkpoint.
- Fenced leases: a worker declared dead cannot come back and overwrite the
  state of the worker that replaced it.
- `GET /api/sync/:id` reports authoritative run status; the sync button polls it
  instead of inferring success from an HTTP 200.
- `POST /api/sync/continue` and a daily `/api/sync/sweep` backstop for runs that
  lose their worker.
- Startup configuration validation, which fails fast and names every broken
  variable at once rather than failing later inside a request.
- `GET /api/version` and a build line in Settings.
- Contrast test suite covering the palette, asserting both that a label can be
  read on a fill and that the fill can be seen on the page.

### Changed

- **New brand.** Lime and near-black, taken from the mark. The primary button is
  whichever half opposes the page: near-black under a lime label in the light
  theme, inverted in the dark.
- `lastSuccessfulSyncAt` now counts only complete successes. A partial run used
  to mark the whole dataset fresh, which presented a course that had failed to
  sync as though it were current.
- Sync run states gained `QUEUED`; the final status is derived by the database
  from the work queue, so no application bug can record `SUCCESS` for a run with
  a failed course.
- Defaults corrected: `GOOGLE_REQUEST_TIMEOUT_MS` 20000 → 10000 and
  `SYNC_LEASE_TTL_SECONDS` 900 → 90. The former could not survive its own retry
  policy inside one request; the latter turned a single killed invocation into a
  fifteen-minute lockout.
- `maxDuration` on sync routes 60 → 300, which is the Hobby ceiling with fluid
  compute. The previous value was reducing the available budget fivefold.

### Fixed

- **Element resets are now in `@layer base`.** They were unlayered, and
  unlayered CSS outranks `@layer utilities` — so `text-on-brand` never applied
  to a single button, `text-brand-ink` never applied to a link, and
  `font-semibold` never applied to a heading. The symptom was a button label at
  1.3:1 in the dark theme.
- A credential that cannot be decrypted is reported as `CREDENTIAL_DECRYPTION_FAILED`
  and changes nothing in the database, rather than being misreported as a
  missing Google grant. Restoring the correct key restores service with no user
  action.
- `invalid_client` from Google's token endpoint is a configuration fault, not a
  revoked grant. It previously marked the connection revoked, which **nulled the
  stored refresh tokens** — one mistyped client secret would have forced every
  user to reconnect.
- The sync button reported `Already up to date.` for a run that failed on every
  course: it read count fields that do not exist and never checked the run
  status.
- Failed-run issue messages are filtered through the same client-safe whitelist
  as thrown errors; they previously returned raw Postgres error text.
- `--ink-muted` raised to meet AA. At 3.6:1 it was under the floor while being
  used at `text-xs` for deadline metadata — a pre-existing failure the new
  contrast suite caught.
- Semantic fills carry `--ink-on-fill`, which flips with the theme. White on the
  dark theme's danger and review fills measured 2.7–3.1:1.

---

## [0.1.0]

Baseline: the first deployed version, before this changelog existed. Google
Classroom sync, section-based relevance classification, the review queue, course
tracking, and the account and legal surfaces.

[0.4.3]: https://github.com/Affaan-Ahmad/LockIn/releases/tag/v0.4.3
[0.4.2]: https://github.com/Affaan-Ahmad/LockIn/releases/tag/v0.4.2
[0.4.1]: https://github.com/Affaan-Ahmad/LockIn/releases/tag/v0.4.1
[0.4.0]: https://github.com/Affaan-Ahmad/LockIn/releases/tag/v0.4.0
[0.3.2]: https://github.com/Affaan-Ahmad/LockIn/releases/tag/v0.3.2
[0.3.1]: https://github.com/Affaan-Ahmad/LockIn/releases/tag/v0.3.1
[0.3.0]: https://github.com/Affaan-Ahmad/LockIn/releases/tag/v0.3.0
[0.2.1]: https://github.com/Affaan-Ahmad/LockIn/releases/tag/v0.2.1
[0.2.0]: https://github.com/Affaan-Ahmad/LockIn/releases/tag/v0.2.0
