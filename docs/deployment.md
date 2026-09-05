# Deploying LockIn

What the production environment needs, and why each part is the way it is.
Written down because the reasoning is not recoverable from the values.

## Architecture

```
get.tech (registrar)
   └── nameservers delegated to Cloudflare
          └── Cloudflare (authoritative DNS, free plan)
                 ├── Email Routing -> contact@lockinapp.tech -> personal inbox
                 └── website records -> Vercel
                                          └── Next.js app
                                                 └── Supabase (Postgres, Auth)
                                                        └── Google Classroom API
```

Cloudflare stays authoritative. Nameservers are never pointed at Vercel, because
Email Routing lives in the same zone as the website records and moving DNS would
take the mailbox with it.

## Environment variables

Nineteen names appear in `.env.example`. **Seven of them are required**; the
rest have defaults in `src/config/env.ts` and should be left unset unless there
is a reason to override.

### Required

| Variable | Source | Differs in production? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API (`sb_publishable_…`) | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API (`sb_secret_…`) | No |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Cloud console → Credentials | No |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google Cloud console → Credentials | No |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Generated, see below | **Yes, always** |
| `NEXT_PUBLIC_SITE_URL` | The real origin | **Yes** |

### Optional, with defaults

Read from `src/config/env.ts`, which is where the real values live:

`SYNC_COURSE_CONCURRENCY` 4 · `SYNC_LEASE_TTL_SECONDS` 90 ·
`SYNC_UNIT_ESTIMATE_MS` 12000 · `SYNC_MAX_COURSE_ATTEMPTS` 3 ·
`GOOGLE_MAX_RETRY_ATTEMPTS` 3 · `GOOGLE_REQUEST_TIMEOUT_MS` 10000 ·
`SYNC_RATE_LIMIT` 10 · `SYNC_RATE_WINDOW_SECONDS` 600 ·
`DISCOVERY_RATE_LIMIT` 20 · `DISCOVERY_RATE_WINDOW_SECONDS` 600 ·
`LOG_LEVEL` info

Two of these are no longer what an older version of this page claimed, and both
corrections matter. `SYNC_LEASE_TTL_SECONDS` is 90, not 900: the worker
heartbeats, so the TTL is how long after a worker dies before somebody may take
over, and 900 meant one killed invocation locked an account out for fifteen
minutes. `GOOGLE_REQUEST_TIMEOUT_MS` is 10000, not 20000: with three retries, 20s per
attempt is an 80-second worst case for a single call, against the 12s
`SYNC_UNIT_ESTIMATE_MS` budgeted for a whole course. A production build now
refuses to start when one call's worst case exceeds four times that estimate,
which rejects the old default and accepts the new one — the check bounds the
ratio, it does not claim a single call fits inside one course's estimate.

Setting one of these to an empty string fails validation, which is worse than
omitting it. Omit unless overriding.

### `CRON_SECRET` — optional, and the sweep is off without it

The recovery sweep at `GET /api/sync/sweep` resumes runs that no continuation
came back for. It authenticates with `Authorization: Bearer <CRON_SECRET>`,
which is what Vercel sends on a cron invocation when the variable is set.

- **Unset:** the endpoint answers 503 and refuses every request. That is
  deliberate — an unauthenticated endpoint that resumes other people's
  synchronisations is worse than having no sweep at all — and the system is
  correct without it. Continuation and the student's next sync are the
  mechanism; the sweep is a floor under them.
- **Set:** at least 16 characters, generated the same way as the encryption key.
  It belongs in the host's environment, never in a file in the repository, and
  it is compared in constant time so it cannot be guessed a character at a time.

On Vercel's free tier cron runs at most once a day with up to an hour of
scheduling jitter, which is the right shape for a backstop and useless as a
mechanism. Nothing here should carry a real value; `.env.example` keeps the name
commented out because an empty value is *present* and fails the length check,
which is a worse failure than omitting it.

### `NODE_ENV` is not set by hand

Vercel manages it. Setting it manually causes problems, and the schema already
defaults to `development` for anything that is not a Vercel build.

## The encryption key must be new for each environment

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`GOOGLE_TOKEN_ENCRYPTION_KEY` encrypts every user's Google refresh token, with
the user id as additional authenticated data. Sharing one key between a laptop
and production means a leak of either compromises both, and refresh tokens are
the most valuable thing this system holds: they are standing access to somebody
else's Classroom account.

## `NEXT_PUBLIC_SITE_URL` must match a domain that resolves

It is read in exactly two places, both auth routes, and its only job is building
the OAuth redirect:

```ts
redirectTo: new URL('/auth/callback', env.NEXT_PUBLIC_SITE_URL).toString()
```

So it has to be the origin the browser will actually be sent back to. Pointing
it at a domain that does not resolve yet breaks sign-in with no useful error.

Sequence: use the `*.vercel.app` origin until the custom domain is live, then
change it to `https://lockinapp.tech` and **redeploy** — Vercel applies
environment changes to new deployments, not running ones.

The same origin must also be allowed in **Supabase → Authentication → URL
Configuration → Redirect URLs**, or Supabase refuses the redirect. Localhost
stays in that list so local development keeps working.

## The build does not need the secrets

Every `getServerEnv()` call sits inside a function; none run at module scope. So
`next build` completes without Supabase or Google credentials, which is why CI
builds with three placeholder `NEXT_PUBLIC_*` values and nothing else.

The consequence is that a successful build proves nothing about configuration. A
wrong value produces a 500 at request time, not a build failure.

## Google OAuth flow

Supabase performs the OAuth exchange, so the redirect URI registered in the
Google console points at **Supabase**, not at Vercel:

```
https://<project-ref>.supabase.co/auth/v1/callback
```

Supabase then sends the user to `/auth/callback` on whatever origin
`NEXT_PUBLIC_SITE_URL` names. Changing the Google console's redirect URI to a
Vercel URL breaks the flow.

## Migrations

Applied by hand through the Supabase SQL editor, in numeric order, and **before
the code that calls them is deployed**. The application invokes `app_*`
functions directly, so a build that calls a function the database does not have
fails at the first call.

`0013` is the exception worth knowing about, because it fails *quietly*. It
replaces the body of `app_fail_sync_run` and leaves the signature alone, so code
deployed against a database still on `0012` runs normally and simply keeps the
race the migration exists to close: a stalled worker that comes back can still
empty its successor's work queue. Nothing errors, nothing is logged, and the
only symptom is a resumed sync occasionally reporting courses as failed that
nothing attempted.

Two files need care:

- `0010` needs `pg_cron`. If the extension cannot be created the migration fails
  rather than installing a retention function that nothing calls, so that a
  scheduled pruning job is either really scheduled or visibly absent. The
  privacy policy deliberately claims no fixed retention period for sync history,
  precisely so that this being unapplied does not make the policy untrue.
- `0011` adds enum labels and `0012` uses them. They are separate files because
  Postgres will not let a new label be used until the transaction that added it
  has committed, so `0011` must be applied and committed first.

Which migrations a given environment has actually had applied is not recorded
here and is not knowable from the repository. Check the database.

## Before calling it live

See `docs/production-readiness.md`. That document, not this one, decides whether
the thing is fit to put in front of students.
