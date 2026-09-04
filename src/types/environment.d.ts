/**
 * `NEXT_RUNTIME` declared as a real property rather than reached through the
 * index signature.
 *
 * Two things need this. `noPropertyAccessFromIndexSignature` forbids
 * `process.env.NEXT_RUNTIME` unless the property exists, and Next.js only
 * replaces the *dot* form at build time -- `process.env['NEXT_RUNTIME']` is left
 * as a runtime lookup, so the dead branch survives bundling and the Edge
 * compilation tries to follow a `node:crypto` import it can never resolve.
 */
declare namespace NodeJS {
  interface ProcessEnv {
    readonly NEXT_RUNTIME?: 'nodejs' | 'edge';
  }
}
