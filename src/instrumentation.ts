/**
 * Startup hook.
 *
 * Next.js runs this once per server instance, in *every* runtime it builds --
 * including Edge, which has no `node:crypto` and no `server-only` boundary. The
 * guard is therefore load-bearing at build time, not just at runtime: written in
 * the dot form, Next replaces `process.env.NEXT_RUNTIME` with a literal per
 * compilation, the branch folds away in the Edge bundle, and the Node-only
 * module below is never traced into it.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
