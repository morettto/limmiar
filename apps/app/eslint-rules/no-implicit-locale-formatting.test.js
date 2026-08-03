import { describe, it } from 'node:test'
import { RuleTester } from 'eslint'
import rule from './no-implicit-locale-formatting.js'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
})

ruleTester.run('no-implicit-locale-formatting', rule, {
  valid: [
    // ADR-S00.5-03: Intl is the single source of truth for formatting, but a
    // call is only auditable statically when it says which locale it wants —
    // any explicit first argument (literal, variable, or expression) counts.
    'date.toLocaleDateString(locale)',
    'date.toLocaleDateString("pt-BR")',
    'date.toLocaleDateString(locale, options)',
    'date.toLocaleTimeString(locale)',
    'value.toLocaleString(locale)',
    // Unrelated method calls with the same zero-arg shape must not trip the rule.
    'date.toISOString()',
    'array.toString()',
  ],
  invalid: [
    {
      code: 'date.toLocaleDateString()',
      errors: [{ messageId: 'missingLocale', data: { method: 'toLocaleDateString' } }],
    },
    {
      code: 'date.toLocaleTimeString()',
      errors: [{ messageId: 'missingLocale', data: { method: 'toLocaleTimeString' } }],
    },
    {
      code: 'value.toLocaleString()',
      errors: [{ messageId: 'missingLocale', data: { method: 'toLocaleString' } }],
    },
  ],
})
