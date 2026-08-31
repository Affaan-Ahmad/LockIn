/**
 * Tailwind v4 needs no JS config file — the design system lives in
 * `src/app/globals.css` under `@theme`, next to the raw tokens it maps.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
