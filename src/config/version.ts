import 'server-only';

import { version } from '../../package.json';

/**
 * What is actually running.
 *
 * This exists because "is my change live?" was, for a long stretch, only
 * answerable by downloading the favicon and comparing its pixels to the one in
 * the build directory. A deployment that cannot identify itself makes every
 * bug report ambiguous: the reporter and the person fixing it may not be
 * looking at the same code, and neither can tell.
 *
 * Two identifiers, doing different jobs:
 *
 *   `APP_VERSION` is the deliberate one, from package.json. It is what a human
 *   says out loud, and it changes only when someone decides it should.
 *
 *   `BUILD_COMMIT` is the precise one. A version number can be built a dozen
 *   times from a dozen different trees; the commit cannot. Vercel injects
 *   VERCEL_GIT_COMMIT_SHA at build time, so this needs no bookkeeping and
 *   cannot drift from what was deployed.
 *
 * Only `version` is imported out of package.json, never the whole object. The
 * file also lists every dependency and its exact version, which is a map of
 * known CVEs to anyone who asks for it, and this value is served publicly.
 */

export const APP_VERSION: string = version;

/**
 * Short commit of the running build, or null when that is unknowable.
 *
 * Null in local development, and honestly so: `next dev` serves the working
 * tree, which usually is not any commit at all. Reporting the last commit there
 * would be a confident lie about uncommitted code.
 */
export const BUILD_COMMIT: string | null =
  process.env['VERCEL_GIT_COMMIT_SHA']?.slice(0, 7) ?? null;

/** 'production', 'preview', or null outside Vercel. */
export const BUILD_ENV: string | null = process.env['VERCEL_ENV'] ?? null;

export interface BuildInfo {
  readonly version: string;
  readonly commit: string | null;
  readonly environment: string | null;
}

export function buildInfo(): BuildInfo {
  return { version: APP_VERSION, commit: BUILD_COMMIT, environment: BUILD_ENV };
}

/**
 * One line a person can read, and read out.
 *
 * "0.2.0 · 98f650d" in production; just "0.2.0 · dev" locally, where the commit
 * would be meaningless.
 */
export function buildLabel(): string {
  return `${APP_VERSION} · ${BUILD_COMMIT ?? 'dev'}`;
}
