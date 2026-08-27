import { describe, expect, it } from 'vitest'
import { createSessionRecorder, type KeyValueStorage } from './session'

const ACCOUNT = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  role: 'Professional' as const,
  twoFactorRequirement: 'NotApplicable' as const,
  twoFactorTicket: null,
}

function createFakeStorage(): KeyValueStorage & { getItem(key: string): string | null } {
  const store = new Map<string, string>()
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value)
    },
  }
}

describe('createSessionRecorder', () => {
  it('writes the account as JSON under the "limmiar:account" key', () => {
    const storage = createFakeStorage()
    const recordSession = createSessionRecorder(storage)

    recordSession(ACCOUNT)

    expect(storage.getItem('limmiar:account')).toBe(JSON.stringify(ACCOUNT))
  })
})
