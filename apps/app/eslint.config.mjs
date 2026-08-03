// @ts-check
import tseslint from 'typescript-eslint'
import pluginLingui from 'eslint-plugin-lingui'
import noImplicitLocaleFormatting from './eslint-rules/no-implicit-locale-formatting.js'

// Scoped, single-purpose ESLint config — the project's general-purpose
// linter is oxlint (see package.json "lint"). This config exists only to
// enforce the two i18n gates oxlint has no rule (and no stable custom-rule
// API) for: AC "lint bloqueante" of S00.5-03. Same precedent as
// dependency-cruiser already coexisting with oxlint in packages/i18n for
// architecture rules oxlint doesn't cover either.
export default tseslint.config(
  {
    ignores: ['**/*.test.{ts,tsx}', 'dist/**', 'coverage/**', 'node_modules/**'],
  },
  {
    // TypeScript parser (needed for both .ts and .tsx — plain .ts files hit
    // a parse error on type annotations without it) + the locale-formatting
    // check, which can appear in plain .ts logic too, not just components.
    files: ['src/**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended],
    plugins: {
      local: { rules: { 'no-implicit-locale-formatting': noImplicitLocaleFormatting } },
    },
    rules: {
      'local/no-implicit-locale-formatting': 'error',
    },
  },
  {
    // JSX-visible-text check only applies where JSX exists.
    files: ['src/**/*.tsx'],
    extends: [pluginLingui.configs['flat/recommended']],
    rules: {
      'lingui/no-unlocalized-strings': [
        'error',
        {
          // "Limmiar" is the product name — identical in all 4 locales, so
          // wrapping it in a translation macro everywhere it appears would
          // be extraction noise with zero translation payoff.
          ignore: ['^Limmiar$'],
          ignoreNames: [
            { regex: { pattern: 'className', flags: 'i' } },
            'id',
            'key',
            'href',
            'rel',
            'target',
            'type',
            'name',
            'htmlFor',
            'data-testid',
          ],
          // DOM/browser APIs whose string argument is an element id/selector,
          // never user-visible copy.
          ignoreFunctions: ['*.getElementById', '*.querySelector', '*.querySelectorAll'],
        },
      ],
    },
  },
)
