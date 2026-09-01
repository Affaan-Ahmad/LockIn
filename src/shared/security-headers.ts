import { THEME_BOOT_SHA256 } from './theme-boot';
/**
 * HTTP security headers.
 *
 * Set before any UI exists, deliberately. A strict Content-Security-Policy bans
 * inline scripts and styles; introduce it after a frontend is written and half
 * of it breaks, at which point the tempting fix is `unsafe-inline` -- which
 * switches the protection back off. Build inside the policy from the start and
 * it costs nothing.
 *
 * The threat is concrete for this application. LockIn renders text written by
 * other people: assignment titles, descriptions and course names pulled from
 * Google Classroom. React escapes by default, so the realistic risk is a future
 * `dangerouslySetInnerHTML` -- say, to make links in a description clickable.
 * CSP is the layer underneath: even if that bug ships, the browser refuses to
 * execute injected script.
 */

export interface CspOptions {
  /** Per-request nonce. Only scripts carrying it may execute. */
  readonly nonce: string;
  /** Dev needs eval for React Fast Refresh and websockets for HMR. */
  readonly isDevelopment: boolean;
  /** Supabase origin, which the browser talks to directly for auth. */
  readonly supabaseOrigin: string;
}

export function buildContentSecurityPolicy(options: CspOptions): string {
  const { nonce, isDevelopment, supabaseOrigin } = options;

  const directives: Record<string, readonly string[]> = {
    // Deny by default; every allowance below is deliberate.
    'default-src': ["'self'"],

    // 'strict-dynamic' lets a nonced script load its own dependencies, which is
    // what makes a nonce policy survive a bundler. Browsers that honour it
    // ignore the host allowlist entirely; older ones fall back to 'self'.
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      // The theme boot script, pinned by content rather than by nonce. A nonce
      // authorises whatever happens to carry it; a hash authorises exactly
      // these bytes. It also removes the `nonce` attribute React was comparing
      // across hydration, which the browser blanks by spec.
      `'${THEME_BOOT_SHA256}'`,
      "'strict-dynamic'",
      ...(isDevelopment ? ["'unsafe-eval'"] : []),
    ],

    // Next.js injects a handful of inline styles that cannot currently carry a
    // nonce. Style injection is a defacement and data-exfiltration-via-CSS
    // risk rather than script execution, so this is the one relaxation taken --
    // recorded here rather than buried, and worth revisiting when the UI is
    // built and we know what it actually needs.
    'style-src': ["'self'", "'unsafe-inline'"],

    // Google avatars, plus data: for inlined icons.
    'img-src': ["'self'", 'data:', 'https://lh3.googleusercontent.com', 'https://*.googleusercontent.com'],
    'font-src': ["'self'", 'data:'],

    // The browser calls Supabase directly for auth and PostgREST.
    'connect-src': [
      "'self'",
      supabaseOrigin,
      ...(isDevelopment ? ['ws:', 'wss:'] : []),
    ],

    // Nothing embeds anything, and nothing embeds us: clickjacking protection
    // that supersedes X-Frame-Options in modern browsers.
    'frame-src': ["'none'"],
    'frame-ancestors': ["'none'"],

    // No Flash-era plugins, no <base> hijacking, and forms may only post to us.
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    };

  const policy = Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(' ')}`)
    .join('; ');

  // Only meaningful over HTTPS, and it would break local development.
  return isDevelopment ? policy : `${policy}; upgrade-insecure-requests`;
}

/**
 * Headers that do not vary per request.
 *
 * Applied in next.config.mjs so they cover static assets too, not only routes
 * that happen to pass through middleware.
 */
export const STATIC_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  // Two years, subdomains included, preload-eligible. Ignored over plain HTTP,
  // so it is safe to send in development.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },

  // Stop browsers guessing a content type and executing a response as script.
  { key: 'X-Content-Type-Options', value: 'nosniff' },

  // Legacy equivalent of frame-ancestors, for browsers that predate CSP 2.
  { key: 'X-Frame-Options', value: 'DENY' },

  // Do not leak assignment ids or course ids in the Referer of outbound links.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

  // This app needs none of these. Denying them shrinks what a successful XSS
  // could reach.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    },

    // Isolate the browsing context so cross-origin pages cannot get a handle on
  // ours, which blunts several side-channel and popup-based attacks.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
];
