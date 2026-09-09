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

## [Unreleased]

Not released. The version in `package.json` is unchanged, so `/api/version` still reports 0.5.3.

### Added

- **The class timetable.** A `/timetable` screen showing the classes for a chosen programme,
  intake and section, read from the spreadsheet the university publishes rather than typed in by
  hand. Days are selectable; today is the default.

  The parser exists because the document cannot be read the obvious way. A cell names its course
  and section but **not its intake** — `OOP (CS-A)` and `DB (CS-A)` are different years sharing a
  section letter, separated only by the cell's background colour. Every values-only source (the CSV
  export, `gviz`, an `IMPORTRANGE` mirror) throws that away and would merge four intakes into one
  timetable. So the sheet is read through the Sheets API with grid data, and the colour is decoded
  against the legend printed in the document's own first rows.

- **Free-room search.** Which rooms have no class in them for the next 30, 60 or 120 minutes,
  answered from the campus clock on the server rather than the browser's. A room holding something
  the parser could not read is reported as unaccounted for rather than counted as empty, and the
  count of those is shown: sending somebody to an occupied room is the one mistake this must not
  make.

- **A second Google credential**, in its own Cloud project, holding `spreadsheets.readonly` for one
  account. Deliberately separate from the student-facing OAuth client, because the consent screen is
  per project: sharing one would have added a Sheets permission to the screen every student sees.
  The four read-only Classroom scopes are unchanged, and no student consents to anything new.

- **Notes on work you have handed in.** Review now lists submitted coursework, filterable by course,
  with a note against each item. The filter lives in the URL, so a filtered view is shareable and the
  back button clears it.

  The classification queue is kept rather than replaced. It is usually empty — sections that classify
  cleanly produce nothing to review — and an empty screen is what made it feel useless, but it is
  also the mechanism that makes the product honest about what it cannot place. It keeps the top of
  the screen whenever it has anything in it; the guidance text and the full empty state now appear
  only then.

- **Your own calendar entries.** A quiz announced in a lecture and never posted to Classroom is real,
  dated, and invisible to every sync. Upcoming can now hold one: it appears as a card beside the
  deadlines and as a second dot on the calendar day.

  Marked separately from published deadlines rather than merged into them, in both places. One is
  authoritative and the other is a reminder somebody set themselves, and a single dot covering both
  would quietly claim the same standing for each. A student-added entry also has no submission state,
  no classification and no override history, so folding it into the deadline list would mean
  inventing those fields.

- **Coursework is readable offline, and the app resyncs the moment it reconnects.** The Today screen
  mirrors what it already rendered into IndexedDB, and the offline page reads it back — so an
  installed app on a train shows the deadlines it last saw instead of a wall.

  Today, Upcoming and Timetable each cache their own screen, and offline the app stays navigable:
  the worker serves one document for any route it cannot fulfil, and because `respondWith` does not
  rewrite the address, that document can read the URL and show the screen that was actually asked
  for. The tabs are ordinary links, so back and forward work. Courses, review and settings say they
  need a connection rather than pretending — they all change something on the server.

  Each section carries its own age, because a timetable read this morning and a deadline list read a
  minute ago are not equally current and one shared timestamp would have to lie about one of them.

  The safety rules are the design, not a footnote. One record ever, stamped with whose it is, and
  writing for a different user wipes what was there first, so two accounts can never have coursework
  on one device. Deleting the account deletes it. It expires after seven days, because a fortnight-old
  deadline list is not a degraded truth but a different and wrong one. Only titles, courses, dates and
  submission state — no tokens, no email, nothing from `/api/auth`. And it is never dressed up as
  current: the page says how old it is in words, sets it on recessed sheets rather than the raised
  ones the live screens use, and offers no action that would need a network.

  Reconnecting is a second trigger on the existing `AutoSync` rather than a new refresh path — same
  cooldown, same lease, same silence about refusals. A reconnect deliberately does not consume the
  reload grant, so a flaky connection cannot burn the rate limit one drop at a time.

- **The timetable loads about three times faster.** It fetched its six weekday tabs strictly one
  after another — a `for` loop with the await inside it — so seven round trips to Google ran in
  series, each carrying a full grid with its formatting. Measured against the real document: 3673ms
  sequential against 1196ms in parallel, 5.41 MB across six tabs. The tabs do not depend on each
  other; only the tab list they come from does, and that is already fetched first.

  The Sheets responses are also cached by the platform now rather than only in the instance's own
  memory. This is the one place in the application where a *shared* cache is the right answer: the
  timetable is one document the whole university reads, identical for every student, so nothing
  about the response varies by who asked. Serverless memory dies with the instance, so on quiet
  traffic almost every visit was paying the full fetch.

- **Safe areas, offline handling and a service worker — the installed app's fundamentals.**

  `PaperShell`, the default skin's frame, handled no insets at all while `viewportFit: cover` and an
  Apple status bar style of `black-translucent` meant the app drew *under* the status bar. On a
  notched phone the page title sat beneath the Dynamic Island. There is now one `app-frame` utility
  carrying the status bar, the landscape notch and the tab bar clearance, with its desktop override
  inside the utility rather than as classes at the call site. The bottom padding it replaces was a
  fixed `pb-24` that guessed the tab bar height and ignored the home indicator entirely.

  A network indicator that stays silent while the connection is fine, says plainly what is and is
  not possible when it drops, and confirms once on return before getting out of the way. It reads
  `navigator.onLine` and deliberately does not touch the freshness model — there is already one
  authoritative answer to "is this current?" and a second derived from a weaker signal would
  eventually contradict it.

  A service worker that caches the build's content-hashed assets and an offline page, and nothing
  else. No API responses and no navigation HTML: every screen here is rendered for the signed-in
  user, and a cache is shared by every profile on the browser. Offline therefore shows a page that
  says so rather than yesterday's deadlines — a smaller offline experience than a notes app would
  give, and the honest one for a product whose promise is that a deadline shown is current.

  Also: the browser's tap highlight removed in favour of the pressed states the design already has,
  scroll chaining contained in standalone so Chrome's pull-to-refresh cannot fire inside the app, a
  stable manifest `id`, and long-press shortcuts to Upcoming and Timetable.

- **An Install section in Settings.** Four states, because the browsers genuinely differ and one
  button would be dead on half of them: already installed, an offer we hold, iOS (which has no
  install API and gets the two taps written out), and everything else.

  The captured offer lives in a module-level store watched from the root layout, not in the Settings
  screen. `beforeinstallprompt` fires once on load and is the only way to open the install dialog —
  there is no API to summon one — and Next.js navigates on the client, so a student arriving at
  Settings from Today would mount the listener long after the event had gone.

- **A loading screen for the installed app.** Android builds the launch splash from the manifest —
  the icon on `background_color` — and a web app cannot replace it. So this does not try to: it
  continues it, with the same ground and the same mark in the same place, and removes itself the
  moment the app hydrates. The seam between the two is meant to be invisible.

  Only in the installed app. A browser tab has no launch splash to continue from, so
  `display-mode: standalone` gates it; a full-screen mark on every hard load would be branding for
  its own sake. The CSS carries a 2.5s fade as a failsafe, because a splash that outlives a failed
  hydration is a screen the student cannot get past.

### Changed

- Navigation gains a Timetable destination on both the sidebar and the mobile bar. The mobile bar's
  documented "four destinations, not five" rule is updated rather than quietly broken: Settings is
  still not a tab, and Timetable earns one on the same test the rule was written around.

- **Legal pages updated in the same change, as the standing rule requires.** The cookie policy no
  longer claims cookies exist only to keep you signed in, and lists the two timetable preference
  cookies. The disclaimer gains sections on how the timetable can be wrong and on free rooms not
  being bookings. The terms describe the timetable, name the university's document as authoritative
  for it, and add the Sheets dependency. The privacy policy states that the timetable is not read
  from the student's Google account, that fetching it sends nothing about them anywhere, and that
  the cohort choice is held on the device rather than in the database.

- `docs/production-readiness.md` records the new credential in the scope inventory, the timetable
  and cohort cookie in the data inventory, and a new gap (22) stating plainly that the credential is
  broader than the job needs, belongs to a personal account, and expires with that person's
  enrolment.

- **Settings is reachable on a phone again in the paper design.** The sidebar is the only route to it
  and is hidden below `lg`, so on anything narrower the screen could not be opened at all. It is now
  a control in the header, as it was in the previous shell — rather than a sixth tab, which would put
  six targets across a 390px bar.

- **The welcome screen says what the product actually does now.** Every claim on it was already
  accurate — filtering, review-when-unsure, opt-in courses, freshness, read-only scopes — so nothing
  was removed. What was wrong is the inverse: it never mentioned the timetable, free rooms, notes on
  submitted work, or your own calendar entries. Four sections were added and the hero no longer
  describes the product as Classroom filtering alone.

- **The hero's clouds are cut paper now.** They were nested rings — concentric circles that read as
  bubbles rather than as anything cut. Each cloud is one hand-written silhouette stamped three times
  at small offsets, in three sheets, with a dashed thread just inside the cut edge and a pencilled
  curl, sparkle or wind mark in kraft.

  The sheets step p0 → p1 → p3 rather than through adjacent shades. Neighbouring sheets sit about
  four points of lightness apart, which is right for a card lying on a page and far too little here:
  stamped three times a few pixels apart they read as one shape with a thick outline. Skipping a
  step is what makes the stack legible as a stack.

  All SVG and CSS, no raster, `non-scaling-stroke` so the cut edge is identical at every size, and
  transform-only animation — the layers drift on different durations, which is where the parallax
  comes from. Three of the six clouds are dropped below `sm` so a phone gets fewer at full size
  rather than six squashed ones. Every animation is `motion-safe:` gated.

- **The glow is gone.** The hero's breathing pool, the pool under the closing card and under Needs
  Review, the strip along an active tab, and the primary button's under-glow. It was the one part of
  the design that measured badly: 1.47:1 against the sheets it sat on, which is a blurred layer
  rendered every frame for something almost nobody could see. Active tabs now carry a kraft strip,
  and the primary button is a raised sheet and nothing else.

- **The icons follow the paper palette.** They were still the old lime, which now survives only as
  the `workbench` skin — so the home screen and the app had different logos. The mark's colours live
  in `src/shared/brand.ts` rather than being retyped in four files, which is how they drifted in the
  first place. `ICON_REVISION` is bumped, which is what makes an installed Android app re-mint its
  launcher icon instead of keeping the copy it cached.

- **Today's context column shows the counts the old rail showed** — connection and sync, courses
  tracked, work hidden — in place of the list of tracked course names. A student who wants to know
  *which* courses are tracked is on their way to Courses to change them; the question worth answering
  in a side column is whether the number is the one they expect. It also drops a query from every
  Today render, since the dashboard already carries the count.

### Security

Findings from a penetration test of the production deployment. It found no critical, high or medium
issues; these are the three low-severity ones it did find, and one fault discovered while fixing
them. Recording them here rather than only in the commit, because "what was the security posture at
this version" is a question that gets asked later.

- **Manual relevance overrides now require the assignment to be yours.** The write went to PostgREST
  as an upsert, and the assignment id was validated only by its foreign key — which Postgres checks
  as the table owner, outside the caller's row-level security. So another user's assignment id
  succeeded while a nonexistent one failed, and the difference told the caller which was which.

  Low severity and worth stating why: assignment ids are `gen_random_uuid()`, so there was nothing
  to enumerate, and a confirmed hit named no owner, course or title. It was still a distinction the
  caller had no business drawing. `app_set_override` (migration `0014`) now asserts ownership and
  answers `P0002` either way, in one statement, so there is no window between the check and the
  write. The shape is not new — `app_set_assignment_ignored` has done exactly this since `0007`.

- **`P0002` is translated as "not found" rather than falling through to a persistence error.** The
  ignore endpoint had raised it since `0007` and been reporting a routine "that assignment is not
  yours" as a `500`. Both endpoints now answer `404`.

- **`/api/version` no longer publishes the commit.** A short SHA pins the deployment to an exact
  revision, which hands anyone auditing the source the precise tree to read. The version and
  environment remain public; the commit stays on the Settings screen, behind a session, where the
  person who needs it for a bug report already is.

- **The data export is rate limited.** One call assembles a student's whole record from eight reads.
  It has its own bucket (`EXPORT_RATE_LIMIT`, ten per ten minutes) so exhausting it cannot also stop
  you syncing.

- Fixed while making the above: the new override RPC returns a composite, and PostgREST is not
  dependable about whether that arrives as an object or a one-element array. Read directly it would
  have thrown a `TypeError` *after* the write had already succeeded. It is normalised the same way
  the sync repository already normalises `app_start_sync_run`.

### Migration

- **`0014_override_ownership.sql` must be applied before this code is deployed.** It introduces
  `app_set_override`, which the application calls directly, so until it exists every attempt to
  record a manual relevance decision fails. This is the loud kind of ordering dependency, unlike
  `0013`.

- **`0015_student_notes_and_events.sql` must be applied before this code is deployed, and it bites
  harder.** It adds `assignment_notes` and `user_events`, which Review and Upcoming read on page
  load — so a deploy that arrives first does not degrade those screens, it breaks them outright.

  Written to be safely re-runnable (`if not exists`, `or replace trigger`, policies dropped before
  being recreated), because a migration applied by pasting into a SQL editor gets run twice sooner or
  later, and failing halfway is worse than doing nothing twice.

---

## [0.5.3] — 2026-09-06

### Fixed

- **The installed icon really was being plated, and 0.5.2 fixed the wrong
  half of it.** A screenshot settled what remote inspection could not: the
  thing sitting in the white circle was the *rounded* icon with the large
  mark -- `/icon`, the `purpose: "any"` entry -- not the maskable one. So the
  launcher was not holding a stale copy of the right icon. It was choosing a
  different icon.

  Android decides whether to plate on the `purpose` declaration, not on the
  artwork. The manifest offered three entries: two `any` and one `maskable`.
  That reads as thorough and is precisely the fault, because it leaves the
  launcher a choice, and every unmaskable entry in the list is a way for it to
  choose wrong. On a circular launcher it took `/icon`, could not crop it, and
  did what it does with a picture it cannot crop -- shrank it and centred it on
  a white disc.

  The manifest now offers exactly one icon, `purpose: "any maskable"`, drawn
  edge to edge with the mark inside the safe zone. Not "a maskable icon is
  available" but "there is nothing here that is not maskable", which is the
  only arrangement where no choice the launcher makes can go wrong. A test
  fails if an unmaskable entry is ever added back.

  Nothing else moves: the browser tab still comes from `icon.svg` and the iOS
  home screen from `apple-touch-icon`, both link tags, neither read from the
  manifest.

  The 0.5.2 revision stamp stays and is bumped, because it is still what makes
  an installed app re-fetch at all -- it was necessary and, on its own, not
  sufficient.

### Note

- A circular launcher needs no circular icon, and supplying one would be worse:
  the launcher masks whatever it is given, so a pre-rounded image is cropped a
  second time. Edge-to-edge artwork plus `maskable` is how an icon fills a
  circle, a squircle or a teardrop equally.

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
