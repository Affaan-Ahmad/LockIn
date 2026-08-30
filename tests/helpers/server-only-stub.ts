/**
 * `server-only` throws unless it is resolved under Next.js's react-server
 * condition. Vitest runs plain Node, so the real module would make every
 * server module unimportable in tests.
 *
 * Aliasing it away is safe: the guard exists to stop server code reaching a
 * client bundle, and a test process is neither. The guard still applies to the
 * real build, which is where it matters.
 */
export {};
