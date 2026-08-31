import { describe, expect, it } from 'vitest';

import {
  createRelevanceClassifier,
  createSectionScopeResolver,
  defaultScopeRules,
} from '@/domain/classification/registry';
import type { SectionScopeRule } from '@/domain/classification/scope';
import { ScopePriority } from '@/domain/classification/scope';
import { SectionScopeResolver } from '@/domain/classification/scope-resolver';

import { relevanceInput, studentA, studentG } from '../helpers/fixtures';

const resolver = createSectionScopeResolver();
const classifier = createRelevanceClassifier();

function scopeOf(title: string, description: string | null = null, topicName: string | null = null) {
  return resolver.resolve({ title, description, topicName });
}

function relevanceOf(title: string, overrides: Parameters<typeof relevanceInput>[0] = {}) {
  return classifier.classify(relevanceInput({ title, ...overrides }));
}

/**
 * Scope is what the assignment targets. Relevance is what that means for one
 * student. These describe blocks are kept apart on purpose: every scope
 * assertion below is made without a student in scope at all, which is the
 * structural reason "the student's section was not mentioned, therefore this is
 * not theirs" cannot be expressed by any rule.
 */

describe('scope: CASE 1 — one explicit section', () => {
  it.each([
    'Assignment 3 - Section G',
    'Assignment 3 (Section G)',
    'Section G - Assignment 3',
    'Assignment 3 - Sec G',
    'Assignment 3 - Section-G',
  ])('%j targets G', (title) => {
    expect(scopeOf(title).scope).toEqual({ type: 'SPECIFIC_SECTIONS', sections: ['g'] });
  });

  it('reports which rule decided and what it matched', () => {
    const resolution = scopeOf('Assignment 3 - Section G');
    expect(resolution.rule).toBe('EXPLICIT_SECTION_WORD');
    expect(resolution.confidence).toBeGreaterThanOrEqual(0.9);
    expect(resolution.evidence[0]).toMatchObject({ source: 'TITLE', matchedText: 'Section G' });
  });
});

describe('scope: CASE 2 — several explicit sections', () => {
  it.each([
    ['Assignment 3 - Sections F/G', ['f', 'g']],
    ['Assignment 3 - Sections A, B and C', ['a', 'b', 'c']],
    ['Assignment 3 - Section A and B', ['a', 'b']],
    ['Assignment 3 - F/G', ['f', 'g']],
  ] as const)('%j targets %j', (title, expected) => {
    const scope = scopeOf(title).scope;
    expect(scope.type).toBe('SPECIFIC_SECTIONS');
    if (scope.type !== 'SPECIFIC_SECTIONS') return;
    expect([...scope.sections].sort()).toEqual([...expected].sort());
  });
});

describe('scope: CASE 3 — no section information', () => {
  /**
   * The correction that matters most. At this university a teacher labels a
   * post only when it is section-specific, so an unlabelled post is for
   * everyone. Reading absence as uncertainty would route most of a shared
   * course into the review queue and make the queue worthless.
   */
  it.each([
    'Assignment 3',
    'Lab 4',
    'Quiz 1',
    'Mid-term revision pack',
    'Submit your project proposal',
  ])('%j is unrestricted', (title) => {
    const resolution = scopeOf(title);
    expect(resolution.scope).toEqual({ type: 'ALL_SECTIONS' });
    expect(resolution.rule).toBe('NO_SECTION_RESTRICTION_FOUND');
    // Confidence 1, not a hedge: we checked all three fields and found no
    // restriction. That is a positive finding, not a failure to decide.
    expect(resolution.confidence).toBe(1);
  });

  it('is unrestricted when the description carries no section either', () => {
    const resolution = scopeOf('Assignment 3', 'Complete questions 1-10 before Monday.');
    expect(resolution.scope).toEqual({ type: 'ALL_SECTIONS' });
  });

  it('is unrestricted when the only letters present are false friends', () => {
    // Each of these contains a letter a substring matcher would read as a
    // section. None of them is one.
    for (const title of ['Group G presentation', 'Question A', 'Part B of the report']) {
      expect(scopeOf(title).scope).toEqual({ type: 'ALL_SECTIONS' });
    }
  });
});

describe('scope: CASE 4 — ambiguous targeting', () => {
  it.each([
    'Assignment for remaining sections',
    'Assignment for the other sections',
    'Submit this - your respective section',
    'Task for the rest of the sections',
  ])('%j is uncertain', (title) => {
    const scope = scopeOf(title).scope;
    expect(scope.type).toBe('UNCERTAIN');
    if (scope.type !== 'UNCERTAIN') return;
    expect(scope.reason).toBeTruthy();
  });

  it('is uncertain for an exclusion with no stated audience', () => {
    expect(scopeOf('Lab 4 - not for B').scope.type).toBe('UNCERTAIN');
  });

  it('is uncertain for a range it cannot expand', () => {
    expect(scopeOf('Assignment - Sections G-A').scope.type).toBe('UNCERTAIN');
  });
});

describe('scope: carve-outs', () => {
  it('models "all sections except B" without inventing the full section list', () => {
    // We do not know how many sections the course has, so an ALL_EXCEPT scope
    // is the only honest representation.
    expect(scopeOf('Quiz 1 - all sections except B').scope).toEqual({
      type: 'ALL_SECTIONS_EXCEPT',
      excluded: ['b'],
    });
  });

  it('reads an explicit whole-cohort phrase as unrestricted', () => {
    expect(scopeOf('Quiz 1 - all sections').scope).toEqual({ type: 'ALL_SECTIONS' });
  });

  it('does not let an affirmative list be overridden by a trailing exclusion', () => {
    // "Section G ... not for B" states its audience. Only an unscoped
    // exclusion is ambiguous.
    expect(scopeOf('Assignment 3 - Section G - not for B').scope).toEqual({
      type: 'SPECIFIC_SECTIONS',
      sections: ['g'],
    });
  });
});

describe('scope: field precedence', () => {
  it('prefers the title over the description', () => {
    const scope = scopeOf('Assignment 3 - Section A', 'Section G should also read chapter 4').scope;
    expect(scope).toEqual({ type: 'SPECIFIC_SECTIONS', sections: ['a'] });
  });

  it('uses the description when the title says nothing', () => {
    expect(scopeOf('Assignment 3', 'This is for Section G only.').scope).toEqual({
      type: 'SPECIFIC_SECTIONS',
      sections: ['g'],
    });
  });

  it('uses the topic when neither title nor description says anything', () => {
    expect(scopeOf('Assignment 3', null, 'Section G').scope).toEqual({
      type: 'SPECIFIC_SECTIONS',
      sections: ['g'],
    });
  });

  it('ignores a bare letter buried in a description', () => {
    // Convincing in a short title, meaningless in a paragraph.
    expect(scopeOf('Assignment 3', 'Please bring handout - G to the lab.').scope.type).toBe(
      'ALL_SECTIONS',
    );
  });
});

describe('relevance derived from scope, for a student in G', () => {
  it.each([
    ['Assignment 1', 'RELEVANT'],
    ['Assignment 1 - Section G', 'RELEVANT'],
    ['Assignment 1 - Section A', 'NOT_RELEVANT'],
    ['Assignment 1 - Sections A/G', 'RELEVANT'],
    ['Assignment 1 - Section A and B', 'NOT_RELEVANT'],
    ['Assignment 1 - all sections', 'RELEVANT'],
    ['Assignment 1 - all sections except G', 'NOT_RELEVANT'],
    ['Assignment 1 - all sections except B', 'RELEVANT'],
    ['Assignment for remaining sections', 'UNCERTAIN'],
    ['Assignment 1 - BCS-4G', 'RELEVANT'],
    ['Assignment 1 - BCS-4A', 'NOT_RELEVANT'],
  ] as const)('%j -> %s', (title, expected) => {
    expect(relevanceOf(title).relevance).toBe(expected);
  });

  it('picks up a section named only in the description', () => {
    const decision = classifier.classify(
      relevanceInput({ title: 'Assignment 1', description: 'For Section G only.' }),
    );
    expect(decision.relevance).toBe('RELEVANT');
    expect(decision.scope).toEqual({ type: 'SPECIFIC_SECTIONS', sections: ['g'] });
  });

  it('reaches the opposite verdict for a student in A on the same item', () => {
    const forA = classifier.classify(
      relevanceInput({ student: studentA(), title: 'Assignment 1 - Section G' }),
    );
    expect(forA.relevance).toBe('NOT_RELEVANT');
  });
});

describe('false-negative protection', () => {
  /**
   * The single most important property in the system: absence of the student's
   * section is never evidence against them.
   */
  it('never hides an unlabelled assignment from anyone', () => {
    for (const student of [studentG(), studentA()]) {
      const decision = classifier.classify(relevanceInput({ student, title: 'Lab 4' }));
      expect(decision.relevance).toBe('RELEVANT');
      expect(decision.scope.type).toBe('ALL_SECTIONS');
    }
  });

  it('only hides an item when another section is named positively', () => {
    expect(relevanceOf('Lab 4').relevance).toBe('RELEVANT');
    expect(relevanceOf('Lab 4 - Section A').relevance).toBe('NOT_RELEVANT');
  });

  it('never hides on ambiguous targeting', () => {
    expect(relevanceOf('Assignment for remaining sections').relevance).not.toBe('NOT_RELEVANT');
  });

  it('never hides coursework because a technology looks like a section code', () => {
    // 4G and 5G are course *content* in Computer Networks. Reading them as
    // section targeting hid real coursework from every other section.
    for (const title of [
      'Quiz on 5G',
      'Assignment 2: Comparison of 4G and 5G',
      'Lab 4 - 5G Architecture',
      '5G network slicing report',
    ]) {
      const forA = classifier.classify(relevanceInput({ student: studentA(), title }));
      const forG = classifier.classify(relevanceInput({ student: studentG(), title }));
      expect(forA.relevance, title).toBe('RELEVANT');
      expect(forG.relevance, title).toBe('RELEVANT');
      expect(forA.scope.type, title).toBe('ALL_SECTIONS');
    }
  });

  it('never hides on a weak or unparseable signal', () => {
    for (const title of ['Please read chapter 4g', 'Sections G-A', 'a) Introduction to trees']) {
      expect(relevanceOf(title).relevance).not.toBe('NOT_RELEVANT');
    }
  });

  it('meets the database confidence floor on every hiding decision', () => {
    // The schema rejects NOT_RELEVANT below 0.8, so a rule that hid something
    // timidly would fail at write time rather than silently.
    for (const title of [
      'Assignment 1 - Section A',
      'Assignment 1 - Section A and B',
      'Assignment 1 - all sections except G',
      'Assignment 1 - BCS-4A',
    ]) {
      const decision = relevanceOf(title);
      expect(decision.relevance).toBe('NOT_RELEVANT');
      expect(decision.confidence).toBeGreaterThanOrEqual(0.8);
    }
  });
});

describe('precedence', () => {
  const decidedAt = new Date('2026-03-01T10:00:00Z');

  it('lets a manual override beat an explicit section scope', () => {
    const decision = relevanceOf('Assignment 1 - Section A', {
      override: { relevance: 'RELEVANT', note: 'added to my section late', decidedAt },
    });
    expect(decision.relevance).toBe('RELEVANT');
    expect(decision.source).toBe('MANUAL_OVERRIDE');
    // The scope is still resolved and recorded, so the override remains
    // explainable against what the assignment actually said.
    expect(decision.scope).toEqual({ type: 'SPECIFIC_SECTIONS', sections: ['a'] });
  });

  it('lets a manual override beat Google targeting', () => {
    const decision = relevanceOf('Individual task', {
      assigneeMode: 'INDIVIDUAL_STUDENTS',
      individualStudentIds: ['someone-else'],
      googleUserId: 'me',
      override: { relevance: 'RELEVANT', note: null, decidedAt },
    });
    expect(decision.relevance).toBe('RELEVANT');
    expect(decision.source).toBe('MANUAL_OVERRIDE');
  });

  it('lets Google targeting beat the section scope', () => {
    const decision = relevanceOf('Assignment 1 - Section G', {
      assigneeMode: 'INDIVIDUAL_STUDENTS',
      individualStudentIds: ['someone-else'],
      googleUserId: 'me',
    });
    expect(decision.relevance).toBe('NOT_RELEVANT');
    expect(decision.source).toBe('GOOGLE_TARGETING');
  });

  it('falls through to the scope when Google targeting cannot decide', () => {
    for (const overrides of [
      { assigneeMode: 'ALL_STUDENTS' as const },
      { assigneeMode: 'INDIVIDUAL_STUDENTS' as const, individualStudentIds: null },
      {
        assigneeMode: 'INDIVIDUAL_STUDENTS' as const,
        individualStudentIds: ['x'],
        googleUserId: null,
      },
    ]) {
      const decision = relevanceOf('Assignment 1', overrides);
      expect(decision.source).toBe('SECTION_SCOPE');
      expect(decision.relevance).toBe('RELEVANT');
    }
  });
});

describe('conflict handling', () => {
  it('returns UNCERTAIN when two rules at one priority disagree on scope type', () => {
    const agree: SectionScopeRule = {
      id: 'TEST_SPECIFIC',
      priority: ScopePriority.TOPIC,
      evaluate: () => ({
        scope: { type: 'SPECIFIC_SECTIONS', sections: ['a'] },
        confidence: 0.9,
        evidence: [],
      }),
    };
    const disagree: SectionScopeRule = {
      id: 'TEST_ALL',
      priority: ScopePriority.TOPIC,
      evaluate: () => ({ scope: { type: 'ALL_SECTIONS' }, confidence: 1, evidence: [] }),
    };

    const conflicted = new SectionScopeResolver({
      rules: [agree, disagree],
      rulesetVersion: 'test',
    }).resolve({ title: 'x', description: null, topicName: null });

    // Higher confidence must not win a disagreement.
    expect(conflicted.scope.type).toBe('UNCERTAIN');
    expect(conflicted.rule).toBe('SCOPE_CONFLICT');
  });

  it('unions rather than intersects when tied rules agree on the type', () => {
    const first: SectionScopeRule = {
      id: 'TEST_F',
      priority: ScopePriority.TOPIC,
      evaluate: () => ({
        scope: { type: 'SPECIFIC_SECTIONS', sections: ['f'] },
        confidence: 0.9,
        evidence: [],
      }),
    };
    const second: SectionScopeRule = {
      id: 'TEST_G',
      priority: ScopePriority.TOPIC,
      evaluate: () => ({
        scope: { type: 'SPECIFIC_SECTIONS', sections: ['g'] },
        confidence: 0.9,
        evidence: [],
      }),
    };

    const merged = new SectionScopeResolver({
      rules: [first, second],
      rulesetVersion: 'test',
    }).resolve({ title: 'x', description: null, topicName: null });

    // Intersecting would drop a section and hide the item from its students.
    expect(merged.scope).toEqual({ type: 'SPECIFIC_SECTIONS', sections: ['f', 'g'] });
  });

  it('discards lower priorities entirely rather than blending them', () => {
    const resolution = scopeOf('Assignment 3 - Section A', 'Section G also applies');
    expect(resolution.scope).toEqual({ type: 'SPECIFIC_SECTIONS', sections: ['a'] });
  });

  it('rejects duplicate rule ids', () => {
    const rule: SectionScopeRule = {
      id: 'DUP',
      priority: ScopePriority.DEFAULT,
      evaluate: () => null,
    };
    expect(
      () => new SectionScopeResolver({ rules: [rule, rule], rulesetVersion: 'test' }),
    ).toThrow(/duplicate rule ids/i);
  });
});

describe('open/closed: adding a naming convention', () => {
  it('accepts a new rule without touching any existing rule or the resolver', () => {
    // Stand-in for a university that writes sections as "G-Morning".
    const morningRule: SectionScopeRule = {
      id: 'MORNING_SUFFIX_CONVENTION',
      priority: ScopePriority.TITLE_EXPLICIT + 1,
      evaluate: (context) => {
        const match = /\b([a-z])-morning\b/i.exec(context.title);
        const section = match?.[1]?.toLowerCase();
        if (section === undefined) return null;
        return {
          scope: { type: 'SPECIFIC_SECTIONS', sections: [section] },
          confidence: 0.95,
          evidence: [
            { source: 'TITLE', matchedText: match?.[0] ?? '', detail: 'Morning-cohort convention' },
          ],
        };
      },
    };

    const extended = createSectionScopeResolver([...defaultScopeRules, morningRule], '2.0.0-morning');

    expect(extended.resolve({ title: 'Lab 4 - G-Morning', description: null, topicName: null }).scope)
      .toEqual({ type: 'SPECIFIC_SECTIONS', sections: ['g'] });

    // And the shipped rules still behave exactly as before.
    expect(extended.resolve({ title: 'Lab 4', description: null, topicName: null }).scope).toEqual({
      type: 'ALL_SECTIONS',
    });
  });
});

describe('determinism and fingerprinting', () => {
  it('produces the same decision for the same input', () => {
    const input = relevanceInput({ title: 'Assignment 3 - Section G' });
    expect(classifier.classify(input)).toEqual(classifier.classify(input));
  });

  it('changes the fingerprint when the alias set changes', () => {
    const before = classifier.fingerprintOf(relevanceInput({ student: studentG() }));
    const after = classifier.fingerprintOf(relevanceInput({ student: studentA() }));
    expect(after).not.toBe(before);
  });

  it('changes the fingerprint when the rule set version changes', () => {
    const input = relevanceInput();
    const v1 = createRelevanceClassifier(undefined, '2.0.0').fingerprintOf(input);
    const v2 = createRelevanceClassifier(undefined, '2.1.0').fingerprintOf(input);
    expect(v2).not.toBe(v1);
  });
});
