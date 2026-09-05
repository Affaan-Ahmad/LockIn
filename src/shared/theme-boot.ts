/**
 * The script that applies a saved theme before the first paint.
 *
 * It has to be inline and synchronous. Anything deferred, including a React
 * effect, runs after the browser has already painted, so a student who chose
 * light on a dark-set phone would see a dark page flash first. That flash is
 * the entire problem this solves.
 *
 * Reading storage can throw outright in private mode or with site data blocked,
 * so the whole body is wrapped: a failure here must leave the device preference
 * in charge, not leave the page unstyled.
 *
 * ---------------------------------------------------------------------------
 * Why this is hash-pinned rather than nonced
 *
 * It used to carry the per-request CSP nonce, which produced a hydration
 * warning on every page load: the HTML spec requires a browser to blank the
 * `nonce` content attribute once the element is inserted, so a CSS attribute
 * selector cannot read it back out. React compared `nonce="..."` from the
 * server against `nonce=""` in the DOM and reported a mismatch that was not
 * one.
 *
 * Suppressing the warning worked but left the cause in place. Because this
 * script is a compile-time constant, its hash is stable, so the CSP can pin it
 * by content instead. No nonce attribute means nothing for React to compare,
 * and the policy gets stricter rather than looser: a nonce authorises whatever
 * happens to carry it, while a hash authorises exactly these script bytes and
 * nothing else.
 * ---------------------------------------------------------------------------
 */
export const THEME_COLORS = { light: '#f4f4ef', dark: '#080b08' } as const;

export const THEME_BOOT =
  `try{var t=localStorage.getItem('lockin-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}try{var d=document.documentElement.getAttribute('data-theme'),m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',d==='dark'||(d!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches)?'${THEME_COLORS.dark}':'${THEME_COLORS.light}')}catch(e){}`;

/**
 * The base64 SHA-256 of `THEME_BOOT`, for `script-src`.
 *
 * Hard-coded rather than computed at runtime. Hashing on every request would
 * cost a digest in middleware for a value that cannot change between requests,
 * and the Edge runtime's only digest API is async, which would make the header
 * builder async for no benefit.
 *
 * The obvious hazard is that someone edits the script and forgets this, which
 * would block the script and silently restore the theme flash. A unit test
 * recomputes the digest and fails if the two ever disagree, so the constant
 * cannot rot unnoticed.
 */
export const THEME_BOOT_SHA256 = 'sha256-1fmIzO9MXOBackvAH5cV5HN19W/zoQ6PkYBTh0wKQeA=';
