// @ts-check
import tseslint from 'typescript-eslint'
import pluginLingui from 'eslint-plugin-lingui'
import noImplicitLocaleFormatting from './eslint-rules/no-implicit-locale-formatting.js'

// Scoped, single-purpose ESLint config — the general-purpose linter here is oxlint (package.json
// "lint"). This exists only for the two i18n gates oxlint has no rule for, the same way
// dependency-cruiser coexists with oxlint for architecture rules.
export default tseslint.config(
  {
    // *.spec.tsx are Playwright CT files, test-only like *.test.tsx (locators and stub fixtures are
    // not user-facing copy). src/test-support/** holds CT-only mount helpers, never rendered in the
    // production app either.
    ignores: [
      // src/app/routing/E2eMicrofoneScaffold.tsx: andaime de e2e atras de
      // VITE_ENABLE_E2E_TEST_ROUTES, sem equivalente de producao nenhum -- a copy dele existe
      // para o spec clicar nela e nunca chega a um utilizador, portanto traduzi-la seria encher
      // os quatro catalogos com texto de fixture. Mesmo estatuto que os *.spec.tsx acima.
      'src/app/routing/E2eMicrofoneScaffold.tsx',
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
          // "Limmiar" is the product name, identical in all 4 locales, so wrapping it would be
          // extraction noise. A bare URL path is routing config, not copy — matched by value, since
          // ignoreNames would exempt every future attribute called `to`, copy included.
          ignore: ['^Limmiar$', '^/[a-z0-9/-]*$'],
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
            // AccountResult.twoFactorRequirement (e.g. MagicLinkCallback.tsx) is the
            // same kind of internal state-machine tag as `status` above -- only
            // branched on to pick real <Trans> copy, never rendered as-is.
            'twoFactorRequirement',
            // TanStack Router route config key (router.tsx) -- a URL path, not copy.
            'path',
          ],
          // DOM/browser APIs whose string argument is an element id/selector,
          // never user-visible copy.
          ignoreFunctions: [
            '*.getElementById',
            '*.querySelector',
            '*.querySelectorAll',
            // translateProblemCode's `code` argument is a backend problem-code key
            // looked up in problem-messages.ts's registry, not copy rendered as-is.
            'translateProblemCode',
            // router.tsx's own helper -- its 2nd argument is a URL search-param key.
            'readSearchString',
            // Error messages are developer-facing diagnostics (thrown/rejected, never
            // rendered UI), same convention already used across this repo's *.ts files.
            'Error',
          ],
        },
      ],
    },
  },
)
