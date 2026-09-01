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

Seventeen names appear in `.env.example`. **Seven of them are required**; the
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

`SYNC_COURSE_CONCURRENCY` 4 · `SYNC_LEASE_TTL_SECONDS` 900 ·
`GOOGLE_MAX_RETRY_ATTEMPTS` 3 · `GOOGLE_REQUEST_TIMEOUT_MS` 20000 ·
`SYNC_RATE_LIMIT` 10 · `SYNC_RATE_WINDOW_SECONDS` 600 ·
`DISCOVERY_RATE_LIMIT` 20 · `DISCOVERY_RATE_WINDOW_SECONDS` 600 ·
`LOG_LEVEL` info

Setting one of these to an empty string fails validation, which is worse than
omitting it. Omit unless overriding.

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

Applied by hand through the Supabase SQL editor, in numeric order. `0010` needs
`pg_cron`; if the extension cannot be created the migration fails rather than
installing a retention function that nothing calls, because the privacy policy
states a 90-day window and an unscheduled function would make that untrue.

## Before calling it live

See `docs/production-readiness.md`. That document, not this one, decides whether
the thing is fit to put in front of students.
