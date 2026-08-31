import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * The class-name helper shadcn components expect.
 *
 * Distinct from `cx` in `./cx`, and both are kept. `cx` joins and drops falsy
 * values, which is all a component with a fixed set of classes needs. `cn`
 * additionally resolves Tailwind conflicts, so a caller passing `p-6` to a
 * component whose base is `p-4` gets `p-6` rather than two padding utilities
 * fighting over specificity order.
 *
 * That conflict resolution is the whole reason shadcn components accept a
 * `className` at all, so they get `cn`. Components that do not take overrides
 * keep `cx` and stay off `tailwind-merge`'s parsing cost.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
