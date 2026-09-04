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
    // CVE map for anyone who asks. This value is served publicly.
    const { buildInfo } = await import('@/config/version');

    expect(Object.keys(buildInfo()).sort()).toEqual(['commit', 'environment', 'version']);
  });
});
