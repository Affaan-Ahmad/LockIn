import { normalizeAliasKey } from './section';
import type { AcademicIdentity, SectionAlias, StudentSectionProfile } from './types';

/**
 * Extension point for university-specific naming conventions.
 *
 * Adding support for a university that writes sections as `4-G(Morning)` means
 * adding an implementation here and registering it -- no existing generator and
 * no rule changes.
 */
export interface SectionAliasGenerator {
  readonly id: string;
  generate(identity: AcademicIdentity): SectionAlias[];
}

/**
 * Covers the conventions in use at the target university: a bare letter, the
 * word "section"/"sec" with several separators, and the program-batch-section
 * code in both hyphenated and joined forms.
 *
 * Generated aliases are deliberately *forms of the student's own section*. They
 * never include neighbouring sections, so a generator bug can widen what the
 * student sees but cannot hide anything from them.
 */
export const defaultSectionAliasGenerator: SectionAliasGenerator = {
  id: 'DEFAULT_V1',

  generate(identity: AcademicIdentity): SectionAlias[] {
    const section = identity.primarySection.trim();
    if (section === '') return [];

    const out: SectionAlias[] = [];
    const push = (raw: string, kind: SectionAlias['kind']): void => {
      const key = normalizeAliasKey(raw);
      if (key === '') return;
      out.push({ raw, key, kind, source: 'DERIVED' });
    };

    push(section, 'BARE');
    push(`Section ${section}`, 'LABELLED');
    push(`Sec ${section}`, 'LABELLED');
    push(`Section-${section}`, 'LABELLED');
    push(`Sec-${section}`, 'LABELLED');

    const batch = identity.batch?.trim() ?? '';
    const program = identity.programCode?.trim() ?? '';

    if (batch !== '') {
      push(`${batch}${section}`, 'BATCH_SECTION');
    }

    if (program !== '' && batch !== '') {
      push(`${program}-${batch}${section}`, 'PROGRAM_CODE');
      push(`${program}${batch}${section}`, 'PROGRAM_CODE');
      push(`${program} ${batch}${section}`, 'PROGRAM_CODE');
    }

    return dedupeByKey(out);
  },
};

/**
 * Merges generated aliases with any the student added by hand and produces the
 * matching structures every rule consumes.
 *
 * User-supplied aliases win on collision so that a student who corrects a bad
 * derived alias sees their correction reflected.
 */
export function buildStudentSectionProfile(
  identity: AcademicIdentity,
  userAliases: readonly SectionAlias[] = [],
  generator: SectionAliasGenerator = defaultSectionAliasGenerator,
): StudentSectionProfile {
  const merged = dedupeByKey([...userAliases, ...generator.generate(identity)]);
  const aliasKeys = new Set(merged.map((alias) => alias.key));

  const sectionKeys = new Set<string>();
  const primaryKey = normalizeAliasKey(identity.primarySection);
  if (primaryKey !== '') sectionKeys.add(primaryKey);
  for (const alias of merged) {
    if (alias.kind === 'BARE') sectionKeys.add(alias.key);
  }

  return {
    primarySection: identity.primarySection,
    aliases: merged,
    aliasKeys,
    sectionKeys,
    aliasSetVersion: computeAliasSetVersion(aliasKeys),
  };
}

function dedupeByKey(aliases: readonly SectionAlias[]): SectionAlias[] {
  const seen = new Map<string, SectionAlias>();
  for (const alias of aliases) {
    if (alias.key === '') continue;
    if (!seen.has(alias.key)) seen.set(alias.key, alias);
  }
  return [...seen.values()];
}

/**
 * Order-independent so that re-ordering the alias list does not spuriously
 * invalidate every cached classification.
 */
function computeAliasSetVersion(keys: ReadonlySet<string>): string {
  return [...keys].sort().join('|');
}
