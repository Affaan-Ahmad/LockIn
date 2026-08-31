import { describe, expect, it } from 'vitest';

import { extractSectionMentions } from '@/domain/classification/section-mentions';

/**
 * The tokeniser is where a naive implementation goes wrong, so it is tested
 * against the exact strings that break substring matching.
 *
 * Two directions of failure are checked separately and treated differently:
 * a MISSED mention is tolerable (the item ends up shown anyway), while a FALSE
 * mention is dangerous (it can hide real coursework). The dangerous direction
 * gets the most cases.
 */

function kinds(text: string): string[] {
  return extractSectionMentions(text).map((mention) => mention.kind);
}

function sectionsOf(text: string): string[] {
  return extractSectionMentions(text).flatMap((mention) => [...mention.sections]);
}

describe('genuine section targeting', () => {
  it.each([
    ['Assignment 3 - G', ['g']],
    ['Assignment 3 – G', ['g']],
    ['Quiz (G)', ['g']],
    ['Lab 2 [G]', ['g']],
    ['G - Assignment 3', ['g']],
    ['Assignment 3 - Section G', ['g']],
    ['Assignment 3 (Section-G)', ['g']],
    ['Sec G quiz', ['g']],
    ['Assignment 3 - BCS-4G', ['g']],
    ['Assignment 3 - BCS4G', ['g']],
    ['Assignment 3 - 4G', ['g']],
  ] as const)('%j targets %j', (title, expected) => {
    expect(sectionsOf(title)).toEqual(expect.arrayContaining([...expected]));
  });

  it('parses a list of sections', () => {
    expect(sectionsOf('Assignment 3 - G and H')).toEqual(expect.arrayContaining(['g', 'h']));
    expect(sectionsOf('Sections A, B and C')).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('expands a range', () => {
    const sections = sectionsOf('Sections A-G');
    expect(sections).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(kinds('Sections A-G')).toContain('RANGE');
  });
});

describe('false friends that must NOT be read as sections', () => {
  /**
   * Every string here contains a letter that a substring match would treat as
   * a section. Reading any of them as targeting would let the exclusion rule
   * hide coursework from the wrong student.
   */
  it.each([
    'Group G',
    'Group G presentation',
    'Assignment G1',
    'Question A',
    'Part A of the report',
    'Task B',
    'Figure A',
    'Appendix B',
    'Week A',
    'Team G',
    'Room G',
    'This is a quiz',
    'Assignment G is due tomorrow',
    'Chapter B review',
    'Version A of the spec',
  ])('%j yields no section mention', (title) => {
    expect(extractSectionMentions(title)).toHaveLength(0);
  });

  it('does not read an English word as a program-code prefix', () => {
    // Regression, found against real Computer Networks coursework. "on 5G"
    // was parsed as program "on", semester 5, section G -- so a quiz about the
    // cellular standard was hidden from every student outside section G.
    for (const title of [
      'Quiz on 5G',
      'Assignment 2: Comparison of 4G and 5G',
      'Notes on 4G',
      'Report for 3B',
      'Migration to 5G',
    ]) {
      const strong = extractSectionMentions(title).filter((m) => m.strength === 'STRONG');
      expect(strong, `"${title}" must yield no strong mention`).toHaveLength(0);
    }
  });

  it('still reads a hyphenated or joined program code', () => {
    // The fix must not cost genuine targeting.
    expect(sectionsOf('Assignment 3 - BCS-5G')).toContain('g');
    expect(sectionsOf('Assignment 3 - BCS5G')).toContain('g');
  });

  it('does not treat a letter bound to a digit as a section', () => {
    // "G1" has no word boundary between G and 1, so the bare-letter pass
    // never sees a standalone G.
    expect(sectionsOf('Assignment G1')).toHaveLength(0);
    expect(sectionsOf('Q2a')).toHaveLength(0);
  });

  it('treats a leading enumeration marker as weak evidence at most', () => {
    const mentions = extractSectionMentions('a) Introduction to the topic');
    for (const mention of mentions) {
      expect(mention.strength).toBe('WEAK');
    }
  });
});

describe('universal targeting', () => {
  it('recognises whole-cohort phrasing', () => {
    expect(kinds('Quiz 1 - all sections')).toContain('UNIVERSAL');
    expect(kinds('Open to all sections')).toContain('UNIVERSAL');
  });

  it('does not read a carve-out as universal', () => {
    const result = kinds('Quiz 1 - all sections except G');
    expect(result).toContain('UNIVERSAL_EXCEPT');
    expect(result).not.toContain('UNIVERSAL');
  });

  it('captures which sections a carve-out excludes', () => {
    const mentions = extractSectionMentions('Quiz 1 - all sections except G');
    const carveOut = mentions.find((mention) => mention.kind === 'UNIVERSAL_EXCEPT');

    expect(carveOut?.sections).toEqual(['g']);
    expect(carveOut?.negated).toBe(true);
    // A negated span must never offer its text as a positive alias match, or a
    // student in G would "match" the very phrase excluding them.
    expect(carveOut?.aliasKeys.size).toBe(0);
  });

  it('handles a multi-section carve-out', () => {
    const mentions = extractSectionMentions('Report - all sections except B and C');
    const carveOut = mentions.find((mention) => mention.kind === 'UNIVERSAL_EXCEPT');
    expect(carveOut?.sections).toEqual(expect.arrayContaining(['b', 'c']));
  });
});

describe('bare exclusions', () => {
  it.each(['Lab 4 - not for B', 'Lab 4 - excluding B', 'Lab 4 - other than B'])(
    '%j is recorded as a negated exclusion',
    (title) => {
      const mentions = extractSectionMentions(title);
      const exclusion = mentions.find((mention) => mention.kind === 'EXCLUSION');
      expect(exclusion).toBeDefined();
      expect(exclusion?.negated).toBe(true);
      expect(exclusion?.sections).toEqual(['b']);
    },
  );
});

describe('mention strength', () => {
  it('marks a keyword-scoped mention as strong', () => {
    const [mention] = extractSectionMentions('Assignment - Section G');
    expect(mention?.strength).toBe('STRONG');
  });

  it('marks a bare batch code outside a label position as weak', () => {
    // "4g" in running prose is one keystroke from a question number.
    const mentions = extractSectionMentions('Please read chapter 4g before class');
    for (const mention of mentions) {
      expect(mention.strength).toBe('WEAK');
    }
  });

  it('marks an unexpandable range as weak', () => {
    const mentions = extractSectionMentions('Sections G-A');
    for (const mention of mentions) {
      expect(mention.strength).toBe('WEAK');
    }
  });
});

describe('spans and evidence', () => {
  it('reports the exact substring the mention came from', () => {
    const title = 'Assignment 3 - Section G';
    const [mention] = extractSectionMentions(title);
    expect(mention).toBeDefined();
    expect(title.slice(mention!.start, mention!.end)).toBe(mention!.raw);
    expect(mention!.raw).toBe('Section G');
  });

  it('does not emit overlapping mentions for the same span', () => {
    const mentions = extractSectionMentions('Quiz 1 - all sections except G');
    const spans = mentions.map((mention) => `${String(mention.start)}:${String(mention.end)}`);
    expect(new Set(spans).size).toBe(spans.length);
  });
});

describe('degenerate input', () => {
  it.each([null, undefined, '', '   '])('returns nothing for %j', (input) => {
    expect(extractSectionMentions(input)).toEqual([]);
  });

  it('does not throw on long or unusual text', () => {
    expect(() => extractSectionMentions('x'.repeat(20_000))).not.toThrow();
    expect(() => extractSectionMentions('日本語のテキスト - G')).not.toThrow();
  });
});
