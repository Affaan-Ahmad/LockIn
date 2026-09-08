import 'server-only';

import { z } from 'zod';

import {
  buildGridFromSheet,
  parseTimetableGrid,
  selectStandingWeek,
  type SheetsSheet,
  type TimetableDay,
} from '@/domain/timetable';
import { getServerEnv } from '@/config/env';
import { ConfigError, GoogleApiError, isAppError } from '@/shared/errors';
import { createLogger } from '@/shared/logger';

/**
 * Server-only client for the published class timetable.
 *
 * The document is a Google Sheet the university maintains, and this is the only
 * place that knows it is reached over HTTP. It reads through the Sheets API as
 * an authenticated member of the university's domain rather than over the
 * public link, because link sharing is somebody else's setting to change and
 * has already been tightened once.
 *
 * Three things here are deliberate.
 *
 * **It has its own OAuth client.** Not the one students consent to. The consent
 * screen is per Cloud project, so sharing a project would add a Sheets scope to
 * the screen the student-facing application shows, and that application's whole
 * claim is that it asks for four read-only Classroom scopes and nothing else.
 *
 * **One credential serves everybody.** The timetable is the same document for
 * every student, so this is a single service credential rather than a per-user
 * grant. Nothing here touches a student's own Google account.
 *
 * **A stale timetable beats no timetable.** When a refresh fails the last good
 * snapshot is served with its age attached, so the screen can say "as of
 * 14:05" rather than going blank. A blank timetable is indistinguishable from
 * a day with no classes, which is the one impression it must never give.
 */

const logger = createLogger({ base: { component: 'timetable' } });

/** How long a snapshot is served before another fetch is attempted. */
const CACHE_TTL_MS = 15 * 60 * 1000;
/** How long a *stale* snapshot may still be served when refreshing fails. */
const STALE_LIMIT_MS = 24 * 60 * 60 * 1000;

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SHEETS_ENDPOINT = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * The field mask is what keeps a day's response near 300 KB rather than 1.1 MB.
 * Of everything the API can return per cell, the parser needs the displayed
 * text and the background colour -- the colour being the only thing that says
 * which intake a class belongs to -- plus the sheet's merge list.
 */
const GRID_FIELDS =
  'sheets(properties(title,sheetId,hidden),merges,' +
  'data(rowData(values(formattedValue,effectiveFormat/backgroundColor))))';
const TAB_FIELDS = 'properties.title,sheets.properties(title,sheetId,hidden)';

/**
 * Only the envelope is validated here.
 *
 * Validating every cell would mean walking three thousand of them per day to
 * re-describe a shape the grid adapter already treats as entirely optional. The
 * envelope is what a wrong endpoint or an error page would get wrong.
 */
const envelopeSchema = z.object({
  properties: z.object({ title: z.string() }).partial().optional(),
  sheets: z.array(z.unknown()),
});

export interface TimetableConfig {
  readonly spreadsheetId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

/**
 * Reads the credential, or explains precisely what is missing.
 *
 * All four values or none: a half-configured deployment is a mistake worth
 * naming rather than a feature that fails later with a 401.
 */
export function readTimetableConfig(): TimetableConfig | null {
  const env = getServerEnv();
  const parts = {
    spreadsheetId: env.TIMETABLE_SPREADSHEET_ID,
    clientId: env.TIMETABLE_OAUTH_CLIENT_ID,
    clientSecret: env.TIMETABLE_OAUTH_CLIENT_SECRET,
    refreshToken: env.TIMETABLE_REFRESH_TOKEN,
  };

  const missing = Object.entries(parts)
    .filter(([, value]) => value === undefined || value === '')
    .map(([key]) => key);

  if (missing.length === Object.keys(parts).length) return null;
  if (missing.length > 0) {
    throw new ConfigError(`Timetable is partly configured; missing: ${missing.join(', ')}`);
  }

  return parts as TimetableConfig;
}

export function isTimetableConfigured(): boolean {
  return readTimetableConfig() !== null;
}

export interface TimetableSnapshot {
  readonly days: readonly TimetableDay[];
  readonly fetchedAt: Date;
  readonly documentTitle: string;
  /** True when a refresh failed and this is the previous snapshot. */
  readonly stale: boolean;
}

interface CachedSnapshot {
  readonly snapshot: TimetableSnapshot;
  readonly expiresAt: number;
}

let cached: CachedSnapshot | null = null;
/** Concurrent callers share one fetch rather than each starting their own. */
let inFlight: Promise<TimetableSnapshot> | null = null;

let accessToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(config: TimetableConfig): Promise<string> {
  // A minute of headroom, so a token cannot expire between check and use.
  if (accessToken !== null && Date.now() < accessToken.expiresAt - 60_000) {
    return accessToken.value;
  }

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: config.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    // Two different faults, and merging them sends whoever is debugging to the
    // wrong place. Google answers `401 invalid_client` when the client id or
    // secret is wrong -- our own misconfiguration, with nothing revoked and the
    // stored token still perfectly good -- and `400 invalid_grant` when the
    // refresh token itself is dead. The first is fixed by correcting a
    // deployment variable; the second needs somebody to authorise again.
    //
    // The body is never surfaced: it can echo the credential back.
    throw new GoogleApiError(
      response.status === 401
        ? 'The timetable credential was rejected: its client id or secret is wrong. ' +
          'Nothing has been revoked -- check the deployment configuration.'
        : response.status === 400
          ? 'The timetable refresh token was rejected. It has most likely been revoked, ' +
            'and the timetable account has to authorise again.'
          : `The timetable credential could not be refreshed (${response.status}).`,
    );
  }

  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (typeof body.access_token !== 'string') {
    throw new GoogleApiError('Timetable credential refresh returned no access token.');
  }

  accessToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return accessToken.value;
}

async function sheetsGet(config: TimetableConfig, query: string): Promise<unknown> {
  const token = await getAccessToken(config);
  const response = await fetch(`${SHEETS_ENDPOINT}/${config.spreadsheetId}?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      // Force a refresh next time: an expired token and a revoked grant look
      // the same from here, and only one of them is worth retrying.
      accessToken = null;
    }
    throw new GoogleApiError(`Timetable document could not be read (${response.status}).`);
  }

  return response.json();
}

async function fetchSnapshot(config: TimetableConfig): Promise<TimetableSnapshot> {
  const metadata = envelopeSchema.parse(
    await sheetsGet(config, `fields=${encodeURIComponent(TAB_FIELDS)}`),
  );

  // The document carries more tabs than it shows -- dated makeup sittings, some
  // of them a year old and hidden. Only the visible weekday tabs are the
  // standing week.
  const standing = selectStandingWeek(metadata.sheets as readonly SheetsSheet[]);
  if (standing.length === 0) {
    throw new GoogleApiError('The timetable document has no visible weekday tabs.');
  }

  const days: TimetableDay[] = [];
  for (const tab of standing) {
    if (tab.weekday === null) continue;
    const payload = envelopeSchema.parse(
      await sheetsGet(
        config,
        `includeGridData=true&ranges=${encodeURIComponent(tab.title)}` +
          `&fields=${encodeURIComponent(GRID_FIELDS)}`,
      ),
    );
    const sheet = (payload.sheets as readonly SheetsSheet[])[0];
    if (sheet === undefined) continue;
    days.push(parseTimetableGrid(buildGridFromSheet(sheet), tab.weekday));
  }

  const problems = days.flatMap((day) => day.diagnostics);
  logger.info('timetable.fetched', {
    days: days.length,
    entries: days.reduce((total, day) => total + day.entries.length, 0),
    distinctProblems: problems.length,
  });

  return {
    days,
    fetchedAt: new Date(),
    documentTitle: metadata.properties?.title ?? 'Timetable',
    stale: false,
  };
}

/**
 * The current timetable, cached.
 *
 * Every student sees the same document, so this is cached once per server
 * instance rather than per user. A failed refresh falls back to the previous
 * snapshot for up to a day, marked stale, because a timetable an hour out of
 * date is far more useful than an empty screen.
 */
export async function loadTimetable(): Promise<TimetableSnapshot> {
  const config = readTimetableConfig();
  if (config === null) throw new ConfigError('The timetable is not configured.');

  const now = Date.now();
  if (cached !== null && now < cached.expiresAt) return cached.snapshot;
  if (inFlight !== null) return inFlight;

  inFlight = fetchSnapshot(config)
    .then((snapshot) => {
      cached = { snapshot, expiresAt: Date.now() + CACHE_TTL_MS };
      return snapshot;
    })
    .catch((error: unknown) => {
      const previous = cached?.snapshot;
      const age = previous === undefined ? Infinity : Date.now() - previous.fetchedAt.getTime();

      if (previous !== undefined && age < STALE_LIMIT_MS) {
        logger.warn('timetable.serving_stale', {
          ageMinutes: Math.round(age / 60_000),
          reason: isAppError(error) ? error.code : 'UNKNOWN',
        });
        return { ...previous, stale: true };
      }
      throw error;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Drops the cache. Used by tests, and by anything that must force a re-read. */
export function resetTimetableCacheForTests(): void {
  cached = null;
  inFlight = null;
  accessToken = null;
}
