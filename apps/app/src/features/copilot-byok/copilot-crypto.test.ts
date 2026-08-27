import { describe, expect, it } from 'vitest'
import { copilotDekAad, copilotKeyAad } from './copilot-crypto'

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'

describe('copilotDekAad / copilotKeyAad', () => {
  it('builds the locked AAD strings as UTF-8 bytes', () => {
    expect(new TextDecoder().decode(copilotDekAad(ACCOUNT_ID))).toBe(`limmiar/copilot-dek/v1|${ACCOUNT_ID}`)
    expect(new TextDecoder().decode(copilotKeyAad(ACCOUNT_ID, 'openai'))).toBe(
      `limmiar/copilot-key/v1|${ACCOUNT_ID}|openai`,
    )
  })
})
