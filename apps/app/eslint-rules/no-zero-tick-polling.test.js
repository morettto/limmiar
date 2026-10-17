import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ESLint, RuleTester } from 'eslint'
import { fileURLToPath } from 'node:url'
import rule from './no-zero-tick-polling.js'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
})

ruleTester.run('no-zero-tick-polling', rule, {
  valid: [
    'await vi.advanceTimersByTimeAsync(0)',
    'for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0)',
    'for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(100)',
  ],
  invalid: [
    {
      code: 'for (let i = 0; i < 5 && !ready(); i++) await vi.advanceTimersByTimeAsync(0)',
      errors: [{ messageId: 'polling' }],
    },
    {
      code: 'for (let i = 0; i < 5 && api.mock.calls.length === 0; i++) await vi.advanceTimersByTimeAsync(0)',
      errors: [{ messageId: 'polling' }],
    },
    {
      code: 'async function wait() { for (let i = 0; i < 5; i++) { if (ready()) return; await vi.advanceTimersByTimeAsync(0) } }',
      errors: [{ messageId: 'polling' }],
    },
  ],
})

describe('ESLint test-file config', () => {
  it('applies the rule to TypeScript tests through the real flat config', async () => {
    const eslint = new ESLint({ cwd: fileURLToPath(new URL('..', import.meta.url)) })
    const [result] = await eslint.lintText(
      'for (let i = 0; i < 5 && !ready(); i++) await vi.advanceTimersByTimeAsync(0)',
      { filePath: 'src/features/device-pairing-primary/PairPrimaryDevice.security.test.tsx' },
    )

    if (!result) throw new Error('ESLint returned no result')
    assert.ok(result.messages.some(message => message.ruleId === 'local/no-zero-tick-polling'))
  })
})
