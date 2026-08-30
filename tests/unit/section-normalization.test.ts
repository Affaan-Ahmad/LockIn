import { describe, expect, it } from 'vitest';

import { buildStudentSectionProfile, defaultSectionAliasGenerator } from '@/domain/academic/alias-generation';
import {
  expandSectionRange,
  isSectionIdentifier,
  normalizeAliasKey,
  parseCompoundSectionCode,
} from '@/domain/academic/section';

/**
 * These functions sit underneath every classification decision. If
 * normalizeAliasKey is wrong, every rule above it is wrong in a way that no
 * higher-level test would localise, so they are tested exhaustively and by
 * table.
 */

describe('normalizeAliasKey', () => {
  const cases: ReadonlyArray<readonly [input: string, expected: string]> = [
    ['G', 'g'],
    ['g', 'g'],
    ['Section G', 'sectiong'],
    ['section g', 'sectiong'],
    ['SECTION G', 'sectiong'],
    ['Section-G', 'sectiong'],
    ['Sec G', 'secg'],
    ['Sec-G', 'secg'],
    ['BCS-4G', 'bcs4g'],
    ['BCS4G', 'bcs4g'],
    ['bcs 4g', 'bcs4g'],
    ['4G', '4g'],
    ['  G  ', 'g'],
    ['Séction G', 'section g'.replace(' ', '')],
  ];

  it.each(cases)('normalises %j to %j', (input, expected) => {
    expect(normalizeAliasKey(input)).toBe(expected);
  });

  it('collapses every separator so hyphenated and joined codes compare equal', () => {
    expect(normalizeAliasKey('BCS-4G')).toBe(normalizeAliasKey('BCS4G'));
    expect(normalizeAliasKey('Section-G')).toBe(normalizeAliasKey('Section G'));
  });

  it('returns an empty key for input with no alphanumeric content', () => {
    // An empty key must never be added to an alias set: it would match nothing
    // useful and, if compared loosely, could match everything.
    expect(normalizeAliasKey('---')).toBe('');
    expect(normalizeAliasKey('   ')).toBe('');
  });
});

describe('isSectionIdentifier', () => {
  it.each([
    ['g', true],
    ['G', true],
    ['a1', true],
    ['gg', false],
    ['4', false],
    ['g12', false],
    ['', false],
  ] as const)('%j -> %j', (input, expected) => {
    expect(isSectionIdentifier(input)).toBe(expected);
  });
});

describe('parseCompoundSectionCode', () => {
  it('extracts the section from a program code', () => {
    expect(parseCompoundSectionCode('BCS-4G')).toEqual({
      programCode: 'bcs',
      batch: '4',
      section: 'g',
    });
    expect(parseCompoundSectionCode('BCS4G')).toEqual({
      programCode: 'bcs',
      batch: '4',
      section: 'g',
    });
  });

  it('extracts the section from a batch code', () => {
    expect(parseCompoundSectionCode('4G')).toEqual({
      programCode: null,
      batch: '4',
      section: 'g',
    });
  });

  it('refuses tokens that merely end in a letter', () => {
    // "Quiz2" and "Lab3a" must not yield a section. Guessing from the last
    // character is how "Assignment 3b" becomes section B for everyone.
    expect(parseCompoundSectionCode('quiz2')).toBeNull();
    expect(parseCompoundSectionCode('assignment')).toBeNull();
    expect(parseCompoundSectionCode('g1')).toBeNull();
    expect(parseCompoundSectionCode('')).toBeNull();
  });
});

describe('expandSectionRange', () => {
  it('expands an ascending single-letter range inclusively', () => {
    expect(expandSectionRange('a', 'e')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(expandSectionRange('A', 'G')).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });

  it('refuses ranges it cannot expand with confidence', () => {
    // A null result forces the caller to degrade to UNCERTAIN rather than
    // invent a membership answer.
    expect(expandSectionRange('g', 'a')).toBeNull();
    expect(expandSectionRange('a1', 'b1')).toBeNull();
    expect(expandSectionRange('a', 'z', 12)).toBeNull();
  });
});

describe('defaultSectionAliasGenerator', () => {
  it('produces every written form of the student section', () => {
    const aliases = defaultSectionAliasGenerator.generate({
      primarySection: 'G',
      programCode: 'BCS',
      batch: '4',
    });
    const keys = aliases.map((alias) => alias.key);

    expect(keys).toContain('g');
    expect(keys).toContain('sectiong');
    expect(keys).toContain('secg');
    expect(keys).toContain('4g');
    expect(keys).toContain('bcs4g');
  });

  it('never generates an alias for a section other than the student own', () => {
    const aliases = defaultSectionAliasGenerator.generate({
      primarySection: 'G',
      programCode: 'BCS',
      batch: '4',
    });

    // A generator bug can only widen what a student sees, never hide something.
    for (const alias of aliases) {
      expect(alias.key).toContain('g');
    }
  });

  it('omits program forms when the university has no program code', () => {
    const aliases = defaultSectionAliasGenerator.generate({
      primarySection: 'B',
      programCode: null,
      batch: null,
    });
    const keys = aliases.map((alias) => alias.key);

    expect(keys).toEqual(expect.arrayContaining(['b', 'sectionb', 'secb']));
    expect(keys.some((key) => key.startsWith('bcs'))).toBe(false);
  });
});

describe('buildStudentSectionProfile', () => {
  it('lets a user-supplied alias win over a derived one with the same key', () => {
    const profile = buildStudentSectionProfile(
      { primarySection: 'G', programCode: 'BCS', batch: '4' },
      [{ raw: 'MY-G', key: 'g', kind: 'CUSTOM', source: 'USER' }],
    );

    const bareG = profile.aliases.find((alias) => alias.key === 'g');
    expect(bareG?.source).toBe('USER');
  });

  it('produces an alias set version that is order independent', () => {
    const a = buildStudentSectionProfile({ primarySection: 'G', programCode: 'BCS', batch: '4' }, [
      { raw: 'X', key: 'x', kind: 'CUSTOM', source: 'USER' },
      { raw: 'Y', key: 'y', kind: 'CUSTOM', source: 'USER' },
    ]);
    const b = buildStudentSectionProfile({ primarySection: 'G', programCode: 'BCS', batch: '4' }, [
      { raw: 'Y', key: 'y', kind: 'CUSTOM', source: 'USER' },
      { raw: 'X', key: 'x', kind: 'CUSTOM', source: 'USER' },
    ]);

    // Reordering must not invalidate cached classifications.
    expect(a.aliasSetVersion).toBe(b.aliasSetVersion);
  });

  it('changes the alias set version when an alias is added', () => {
    const before = buildStudentSectionProfile({
      primarySection: 'G',
      programCode: 'BCS',
      batch: '4',
    });
    const after = buildStudentSectionProfile(
      { primarySection: 'G', programCode: 'BCS', batch: '4' },
      [{ raw: 'Morning G', key: 'morningg', kind: 'CUSTOM', source: 'USER' }],
    );

    // The version feeds the classification fingerprint; if it did not change,
    // correcting an alias would leave every stale verdict in place.
    expect(after.aliasSetVersion).not.toBe(before.aliasSetVersion);
  });
});
