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
    // *.spec.tsx (S02-01): Playwright Component Testing files, same
    // test-only status as *.test.tsx (locators/screenshot filenames/stub
    // fixture values aren't user-facing copy needing translation) -- see
    // playwright-ct.config.ts and vite.config.ts's matching Vitest-vs-CT
    // include split. src/test-support/**: CT-only mount helpers (axe
    // rule ids, the pt-BR locale tag passed to i18n.loadAndActivate) --
    // never rendered in the production app either.
    ignores: [
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      'src/test-support/**',
      'dist/**',
      'coverage/**',
      'node_modules/**',
    ],
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
            // <input type="radio"/checkbox/option value="..."> — a wire/DOM
            // value (e.g. AuthScreen's AccountRole segmented control), never
            // rendered text on its own (rendered text is a sibling/child).
            'value',
            // Internal state-machine tags (e.g. AuthScreen's SubmitState
            // `{ status: 'idle' | 'submitting' | 'error' | 'success' }`) --
            // never rendered as-is, only branched on to pick real <Trans> copy.
            'status',
            // SCREAMING_SNAKE_CASE module-level constants are identifiers/keys
            // (e.g. storage keys), by this repo's own convention never prose.
            { regex: { pattern: '^[A-Z][A-Z0-9_]*$' } },
          ],
          // DOM/browser APIs whose string argument is an element id/selector,
          // never user-visible copy.
          ignoreFunctions: ['*.getElementById', '*.querySelector', '*.querySelectorAll'],
        },
      ],
    },
  },
)
