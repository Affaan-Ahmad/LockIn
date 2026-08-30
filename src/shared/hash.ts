import { createHash } from 'node:crypto';

/**
 * Stable content fingerprints.
 *
 * Used for two distinct jobs, both of which are pure performance work that must
 * never change a decision:
 *
 *  - `source_fingerprint` lets an upsert skip rows Google did not change.
 *  - `input_fingerprint` lets the classifier skip work whose inputs (content,
 *    alias set, rule set version) are all unchanged.
 *
 * Because a stale fingerprint means a *missed* update, the encoding must be
 * unambiguous: values are length-prefixed so that ["ab","c"] and ["a","bc"]
 * cannot collide.
 */
export function stableFingerprint(parts: readonly (string | number | boolean | null | undefined)[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    if (part === null || part === undefined) {
      hash.update('\u0000null\u0000');
      continue;
    }
    const encoded = String(part);
    hash.update(`${encoded.length}:${encoded}\u0000`);
  }
  return hash.digest('hex');
}
