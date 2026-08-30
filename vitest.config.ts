import { fileURLToPath } from 'node:url';

import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const src = fileURLToPath(new URL('./src', import.meta.url));
const serverOnlyStub = fileURLToPath(
  new URL('./tests/helpers/server-only-stub.ts', import.meta.url),
);

const alias = { '@': src, 'server-only': serverOnlyStub };

/**
 * Load .env.local into the test process.
 *
 * Vitest does not do this on its own, and the integration suite reads its
 * Supabase credentials from process.env. Without this the suite finds no
 * configuration and skips all 27 tests -- reporting a green run that verified
 * nothing, which is the worst possible failure mode for a test suite whose
 * entire job is to check the things unit tests cannot.
 *
 * The empty prefix loads every variable, not just VITE_-prefixed ones. That is
 * safe here because nothing in this config reaches a browser bundle.
 */
const fileEnv = loadEnv('test', process.cwd(), '');

export default defineConfig({
  resolve: { alias },
  test: {
    globals: false,
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          // Real credentials, only for this project. Unit tests stay hermetic:
          // a unit test that quietly picked up a live database connection would
          // stop being a unit test.
          env: {
            NEXT_PUBLIC_SUPABASE_URL: fileEnv['NEXT_PUBLIC_SUPABASE_URL'] ?? '',
            NEXT_PUBLIC_SUPABASE_ANON_KEY: fileEnv['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '',
            SUPABASE_SERVICE_ROLE_KEY: fileEnv['SUPABASE_SERVICE_ROLE_KEY'] ?? '',
          },
          // Integration tests share one Postgres schema; running them in parallel
          // would let one test's sync run collide with another's lease.
          sequence: { concurrent: false },
          maxConcurrency: 1,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
