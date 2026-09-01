/**
 * Static security headers.
 *
 * Duplicated from src/shared/security-headers.ts rather than imported: this
 * file is loaded by the Next.js build before TypeScript path aliases resolve.
 * The TS module is the one under test; keep the two in step.
 */
const STATIC_SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Where the build output goes.
   *
   * Overridable so a verification build can be sent somewhere other than
   * `.next`. `next dev` and `next build` otherwise share that directory, and a
   * build run while the dev server is up rewrites the chunks the running
   * server still holds references to. The result is
   * `__webpack_modules__[moduleId] is not a function` on the next request,
   * which looks like a code fault and is not one.
   *
   * Set NEXT_DIST_DIR to isolate a build: `npm run verify:build`.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',

  headers() {
    // Next.js accepts a plain value here; the signature is only typed as async.
    return Promise.resolve([{ source: '/:path*', headers: STATIC_SECURITY_HEADERS }]);
  },

  reactStrictMode: true,
  // Fail the build on type or lint errors. A backend whose invariants are enforced
  // by the type system must not ship with those checks disabled.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
  experimental: {
    // Keep Node-only modules (crypto, server-only token handling) out of any
    // client bundle that might accidentally import a server module.
    serverActions: { bodySizeLimit: '1mb' },
  },
};

export default nextConfig;
