export type AliasSource = 'USER' | 'DERIVED';

export type AliasKind = 'BARE' | 'LABELLED' | 'PROGRAM_CODE' | 'BATCH_SECTION' | 'CUSTOM';

export interface SectionAlias {
  /** As a human would write it, preserved for display and for provenance evidence. */
  readonly raw: string;
  /** Comparison key produced by `normalizeAliasKey`. */
  readonly key: string;
  readonly kind: AliasKind;
  readonly source: AliasSource;
}

/** Everything the alias generator is allowed to reason about. */
export interface AcademicIdentity {
  /** The student's own section, e.g. "G". */
  readonly primarySection: string;
  /** e.g. "BCS". Null when the university does not use program codes. */
  readonly programCode: string | null;
  /** Semester/batch number that appears inside codes like BCS-4G. */
  readonly batch: string | null;
}

/**
 * Resolved, ready-to-match view of a student's section identity.
 *
 * Built once per sync run and shared by every rule, so alias expansion cost is
 * paid once rather than per assignment.
 */
export interface StudentSectionProfile {
  readonly primarySection: string;
  readonly aliases: readonly SectionAlias[];
  readonly aliasKeys: ReadonlySet<string>;
  /** Bare section identifiers only (`g`), used for list/range membership tests. */
  readonly sectionKeys: ReadonlySet<string>;
  /**
   * Changes whenever the alias set changes. Part of the classification input
   * fingerprint so that editing an alias re-runs classification.
   */
  readonly aliasSetVersion: string;
}
