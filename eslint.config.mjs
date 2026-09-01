import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * The `no-restricted-imports` blocks below are the mechanical enforcement of the
 * dependency rule described in the README. Without them "domain must not depend on
 * infrastructure" is a comment that decays; with them it is a build failure.
 */
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      // Output of an isolated verification build. Same reason as .next: it is
      // generated, and it does not exist on a fresh clone.
      '.next-verify/**',
      'coverage/**',
      'next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // The two .mjs config files at the root are not part of tsconfig's
        // include list; allowDefaultProject lets them be linted without
        // widening the type-checked program.
        projectService: { allowDefaultProject: ['*.mjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // The root config files run in Node during the build, not in a browser.
    // Without declaring that, `process` reads as an undefined global -- which
    // is how a genuine error in next.config.mjs went unseen: `next build` only
    // lints src, so nothing checked this file until eslint was run directly.
    files: ['*.mjs', '*.config.mjs'],
    languageOptions: {
      globals: { process: 'readonly', __dirname: 'readonly', console: 'readonly' },
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'next',
                'next/*',
                'react',
                '@supabase/*',
                'server-only',
                '**/infrastructure/**',
                '**/application/**',
                '../../infrastructure/*',
                '../../application/*',
              ],
              message:
                'domain/ must stay pure: no framework, no persistence, no transport. Depend inward only.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['next', 'next/*', 'react', '@supabase/*', '**/infrastructure/**'],
              message:
                'application/ orchestrates through ports. Concrete adapters are injected, never imported.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts', '**/*.test.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
);
