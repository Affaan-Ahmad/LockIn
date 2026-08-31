/**
 * Class-name helpers.
 *
 * CSS Modules type their exports as an index signature, and this project runs
 * with `noPropertyAccessFromIndexSignature`, so `styles.card` is a type error.
 * These two functions keep that mechanical detail in one file instead of
 * spreading bracket access and `?? ''` through every component.
 */

export type Styles = Readonly<Record<string, string>>;

/** Looks up one class, tolerating a name that does not exist in the module. */
export function s(styles: Styles, name: string | undefined | false): string {
  if (name === undefined || name === false) return '';
  return styles[name] ?? '';
}

/** Joins class names, dropping anything falsy. */
export function cx(...parts: Array<string | undefined | false | null>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ');
}
