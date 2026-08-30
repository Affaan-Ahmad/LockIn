/**
 * Section identity primitives.
 *
 * Everything in this file is a pure function over strings. It is the lowest
 * layer of the correctness-critical path: if `normalizeAliasKey` is wrong, every
 * classification above it is wrong, so it is kept deliberately small and is
 * covered by table-driven tests.
 */

/**
 * Canonical comparison key for a section alias.
 *
 * Case, accents, and every separator are removed, so `Section-G`, `section g`
 * and `SECTION G` collapse to the same key. Separators are *removed* rather
 * than replaced by a space because the university writes the same code as both
 * `BCS-4G` and `BCS4G`, and those must compare equal.
 *
 * Returns an empty string for input with no alphanumeric content; callers treat
 * that as "not a usable alias" rather than matching everything.
 */
export function normalizeAliasKey(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** A section identifier is a letter, optionally followed by a single digit: G, A, B2. */
const SECTION_IDENTIFIER = /^[a-z][0-9]?$/;

export function isSectionIdentifier(value: string): boolean {
  return SECTION_IDENTIFIER.test(value.toLowerCase());
}

/**
 * `BCS4G`, `bcs-4g`, `SE3B` -- a program code carrying batch and section.
 * Two to six letters, one or two digits, then the section identifier.
 */
const PROGRAM_CODE = /^([a-z]{2,6})([0-9]{1,2})([a-z][0-9]?)$/;

/** `4G`, `3b` -- batch and section without the program prefix. */
const BATCH_SECTION = /^([0-9]{1,2})([a-z][0-9]?)$/;

export interface ProgramCodeParts {
  readonly programCode: string | null;
  readonly batch: string | null;
  readonly section: string;
}

/**
 * Pulls the section out of a compound code. Returns null when the token is not a
 * compound code at all -- callers must not fall back to "use the last letter",
 * which would turn `Quiz2` into section 2 and `Lab3a` into a false match.
 */
export function parseCompoundSectionCode(token: string): ProgramCodeParts | null {
  const normalized = normalizeAliasKey(token);
  if (normalized === '') return null;

  const program = PROGRAM_CODE.exec(normalized);
  if (program !== null) {
    return {
      programCode: program[1] ?? null,
      batch: program[2] ?? null,
      section: program[3] as string,
    };
  }

  const batch = BATCH_SECTION.exec(normalized);
  if (batch !== null) {
    return { programCode: null, batch: batch[1] ?? null, section: batch[2] as string };
  }

  return null;
}

/**
 * Expands `A-G` into every letter between the endpoints.
 *
 * Returns null when the range is not expandable with confidence: reversed
 * endpoints, multi-character identifiers, or an implausibly wide span. A null
 * result means the caller must degrade to UNCERTAIN rather than guess at the
 * teacher's intent.
 */
export function expandSectionRange(from: string, to: string, maxSpan = 12): string[] | null {
  const start = from.toLowerCase();
  const end = to.toLowerCase();
  if (start.length !== 1 || end.length !== 1) return null;
  if (!/^[a-z]$/.test(start) || !/^[a-z]$/.test(end)) return null;

  const startCode = start.charCodeAt(0);
  const endCode = end.charCodeAt(0);
  if (endCode < startCode) return null;
  if (endCode - startCode + 1 > maxSpan) return null;

  const out: string[] = [];
  for (let code = startCode; code <= endCode; code += 1) {
    out.push(String.fromCharCode(code));
  }
  return out;
}
