import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The build identifies itself, and the changelog knows about it.
 *
 * A version is only useful if it is trustworthy. Two ways it stops being so,
 * both caught here:
 *
 *   The number in package.json and the number the app reports drift apart.
 *   They cannot, because version.ts imports the one from package.json -- and
 *   this asserts that arrangement rather than trusting it to survive an edit.
 *
 *   Someone bumps the version and forgets the changelog, so the release exists
 *   but nothing says what is in it.
 */

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
const changelog = readFileSync('CHANGELOG.md', 'utf8');

describe('version', () => {
  it('is a semantic version', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('has a changelog entry', () => {
    // Bumping the version without saying what changed produces a release
    // nobody can evaluate.
    expect(changelog).toContain(`## [${pkg.version}]`);
  });

  it('is what the app reports, by construction', async () => {
    const { APP_VERSION, buildInfo } = await import('@/config/version');

    expect(APP_VERSION).toBe(pkg.version);
    expect(buildInfo().version).toBe(pkg.version);
  });

  it('reports no commit outside a Vercel build, rather than guessing one', async () => {
    // `next dev` serves the working tree, which is usually not any commit at
    // all. Naming the last one there would be a confident lie about
    // uncommitted code.
    const { buildInfo } = await import('@/config/version');

    expect(buildInfo().commit).toBeNull();
  });

  it('exposes only the three fields, never the rest of package.json', async () => {
    // package.json lists every dependency and its exact version, which is a
    // CVE map for anyone who asks.
    const { buildInfo } = await import('@/config/version');

    expect(Object.keys(buildInfo()).sort()).toEqual(['commit', 'environment', 'version']);
  });
});

/**
 * What an unauthenticated caller is allowed to learn.
 *
 * `/api/version` is public, so its payload is an published surface rather than
 * an implementation detail. A penetration test flagged the commit here: a short
 * SHA pins the deployment to an exact revision and hands anyone auditing the
 * source the precise tree to read.
 *
 * Asserted as a whole-shape equality rather than a "does not contain commit"
 * check, because the failure worth catching is the *next* field somebody adds
 * to the public payload without thinking about who reads it.
 */
describe('the public build identity', () => {
  it('names the version and the environment, and nothing else', async () => {
    const { publicBuildInfo } = await import('@/config/version');

    expect(Object.keys(publicBuildInfo()).sort()).toEqual(['environment', 'version']);
  });

  it('withholds the commit, which the authenticated label still carries', async () => {
    const { publicBuildInfo, buildInfo } = await import('@/config/version');

    expect(publicBuildInfo()).not.toHaveProperty('commit');
    // The operator has not lost it: buildInfo, and the Settings screen's
    // buildLabel, still report the commit behind a session.
    expect(buildInfo()).toHaveProperty('commit');
  });

  it('still answers the question the endpoint exists for', async () => {
    const { publicBuildInfo } = await import('@/config/version');

    expect(publicBuildInfo().version).toBe(pkg.version);
  });
});
