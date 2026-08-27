import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearApiKey, COPILOT_KEY_STORAGE_KEY, loadApiKey, saveApiKey } from './key-store'

/**
 * A fresh module instance has its in-memory copy unset (module-scoped `let`) while sharing the
 * same jsdom `localStorage` -- simulates "same account reopens the app after a reload", the only
 * way to exercise loadApiKey's localStorage/decrypt branch once a save always populates memory.
 */
async function reloadKeyStoreModule(): Promise<typeof import('./key-store')> {
  vi.resetModules()
  return import('./key-store')
}

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'
const OTHER_ACCOUNT_ID = '22222222-2222-2222-2222-222222222222'
const FAKE_API_KEY = 'sk-test-abc123-do-not-leak-me'

function storageKeyFor(accountId: string): string {
  return `${COPILOT_KEY_STORAGE_KEY}:${accountId}`
}

async function makeKek(): Promise<CryptoKey> {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  return limmiarWebcrypto.importKek(raw)
}

describe('saveApiKey / loadApiKey', () => {
  afterEach(() => {
    localStorage.clear()
    clearApiKey(ACCOUNT_ID)
    clearApiKey(OTHER_ACCOUNT_ID)
  })

  it('round-trips: what is saved is what is loaded, with the correct kek/accountId', async () => {
    const kek = await makeKek()

    await saveApiKey(kek, ACCOUNT_ID, 'openai', FAKE_API_KEY, true)
    const loaded = await loadApiKey(kek, ACCOUNT_ID)

    expect(loaded).toEqual({ providerId: 'openai', apiKey: FAKE_API_KEY })
  })

  it('loadApiKey returns null when nothing has been saved yet', async () => {
    const kek = await makeKek()

    expect(await loadApiKey(kek, ACCOUNT_ID)).toBeNull()
  })

  it('a different accountId cannot see the key at all once storage is namespaced per account', async () => {
    const kek = await makeKek()
    await saveApiKey(kek, ACCOUNT_ID, 'openai', FAKE_API_KEY, true)

    expect(await loadApiKey(kek, OTHER_ACCOUNT_ID)).toBeNull()
  })

  it('fails to open under a different kek', async () => {
    const kek = await makeKek()
    const wrongKek = await makeKek()
    await saveApiKey(kek, ACCOUNT_ID, 'openai', FAKE_API_KEY, true)
    // Force the localStorage/decrypt path -- a fresh module has no in-memory copy to
    // short-circuit through, same as reopening the app in a new tab.
    const reloaded = await reloadKeyStoreModule()

    await expect(reloaded.loadApiKey(wrongKek, ACCOUNT_ID)).rejects.toThrow()
  })

  it('never stores the plaintext API key anywhere in localStorage when persist is true', async () => {
    const kek = await makeKek()

    await saveApiKey(kek, ACCOUNT_ID, 'openai', FAKE_API_KEY, true)

    const raw = window.localStorage.getItem(storageKeyFor(ACCOUNT_ID))
    expect(raw).not.toBeNull()
    expect(raw!.includes(FAKE_API_KEY)).toBe(false)
  })

  it('persist=false keeps the key memory-only: nothing is written to localStorage', async () => {
    const kek = await makeKek()

    await saveApiKey(kek, ACCOUNT_ID, 'openai', FAKE_API_KEY, false)

    expect(window.localStorage.getItem(storageKeyFor(ACCOUNT_ID))).toBeNull()
    expect(window.localStorage.length).toBe(0)
  })

  it('persist=false wipes an earlier persist=true save for the same account, so a reload never resurrects the old key', async () => {
    const kek = await makeKek()
    await saveApiKey(kek, ACCOUNT_ID, 'openai', FAKE_API_KEY, true)

    await saveApiKey(kek, ACCOUNT_ID, 'openai', 'sk-test-new-key', false)

    expect(window.localStorage.getItem(storageKeyFor(ACCOUNT_ID))).toBeNull()

    // Simulate a reload: no in-memory copy left to short-circuit through -- must not fall back
    // to the old envelope still sitting in localStorage.
    const reloaded = await reloadKeyStoreModule()
    expect(await reloaded.loadApiKey(kek, ACCOUNT_ID)).toBeNull()
  })

  it('persist=false still lets loadApiKey read the key back in the same session, from memory', async () => {
    const kek = await makeKek()

    await saveApiKey(kek, ACCOUNT_ID, 'openai', FAKE_API_KEY, false)

    expect(await loadApiKey(kek, ACCOUNT_ID)).toEqual({ providerId: 'openai', apiKey: FAKE_API_KEY })
  })

  it('loadApiKey prioritizes the in-memory copy over localStorage, even under the wrong kek', async () => {
    const kek = await makeKek()
    const wrongKek = await makeKek()
    await saveApiKey(kek, ACCOUNT_ID, 'openai', FAKE_API_KEY, true)

    // A wrong kek would normally fail AES-GCM tag verification when going through localStorage;
    // it does not here because the in-memory copy short-circuits the decrypt entirely.
    expect(await loadApiKey(wrongKek, ACCOUNT_ID)).toEqual({ providerId: 'openai', apiKey: FAKE_API_KEY })
  })

  it('a localStorage-path load populates memory, so a second read needs no correct kek', async () => {
    const kek = await makeKek()
    const wrongKek = await makeKek()
    await saveApiKey(kek, ACCOUNT_ID, 'openai', FAKE_API_KEY, true)
    const reloaded = await reloadKeyStoreModule() // fresh in-memory state, same localStorage

    const firstLoad = await reloaded.loadApiKey(kek, ACCOUNT_ID)
    expect(firstLoad).toEqual({ providerId: 'openai', apiKey: FAKE_API_KEY })

    // Second read must not touch localStorage/decrypt again -- a wrong kek succeeding here
    // proves it went through memory instead.
    expect(await reloaded.loadApiKey(wrongKek, ACCOUNT_ID)).toEqual({ providerId: 'openai', apiKey: FAKE_API_KEY })
  })

  it('two accounts on the same device do not clobber each other', async () => {
    const kekA = await makeKek()
    const kekB = await makeKek()
    await saveApiKey(kekA, ACCOUNT_ID, 'openai', 'key-for-a', true)
    await saveApiKey(kekB, OTHER_ACCOUNT_ID, 'anthropic', 'key-for-b', true)

    expect(window.localStorage.getItem(storageKeyFor(ACCOUNT_ID))).not.toBeNull()
    expect(window.localStorage.getItem(storageKeyFor(OTHER_ACCOUNT_ID))).not.toBeNull()
    expect(await loadApiKey(kekA, ACCOUNT_ID)).toEqual({ providerId: 'openai', apiKey: 'key-for-a' })
    expect(await loadApiKey(kekB, OTHER_ACCOUNT_ID)).toEqual({ providerId: 'anthropic', apiKey: 'key-for-b' })
  })
})

describe('empty accountId', () => {
  // storageKeyFor('') collapses to a single global slot (`${COPILOT_KEY_STORAGE_KEY}:`) shared by
  // every caller that forgets to pass a real accountId -- the AAD would also stop distinguishing
  // accounts. All three entry points funnel through the same namespacing, so all three reject it.
  afterEach(() => {
    localStorage.clear()
  })

  it('saveApiKey rejects an empty accountId before touching memory or storage', async () => {
    const kek = await makeKek()

    await expect(saveApiKey(kek, '', 'openai', FAKE_API_KEY, true)).rejects.toThrow(/accountId/)

    expect(window.localStorage.length).toBe(0)
  })

  it('loadApiKey rejects an empty accountId', async () => {
    const kek = await makeKek()

    await expect(loadApiKey(kek, '')).rejects.toThrow(/accountId/)
  })

  it('clearApiKey rejects an empty accountId', () => {
    expect(() => clearApiKey('')).toThrow(/accountId/)
  })
})

describe('clearApiKey', () => {
  afterEach(() => {
    localStorage.clear()
    clearApiKey(ACCOUNT_ID)
  })

  it('removes the stored entry so loadApiKey goes back to null', async () => {
    const kek = await makeKek()
    await saveApiKey(kek, ACCOUNT_ID, 'openai', FAKE_API_KEY, true)

    clearApiKey(ACCOUNT_ID)

    expect(await loadApiKey(kek, ACCOUNT_ID)).toBeNull()
    expect(window.localStorage.getItem(storageKeyFor(ACCOUNT_ID))).toBeNull()
  })

  it('only clears the in-memory copy belonging to the given accountId', async () => {
    const kekA = await makeKek()
    const kekB = await makeKek()
    await saveApiKey(kekA, ACCOUNT_ID, 'openai', 'key-for-a', false)
    await saveApiKey(kekB, OTHER_ACCOUNT_ID, 'anthropic', 'key-for-b', false)

    clearApiKey(ACCOUNT_ID)

    expect(await loadApiKey(kekA, ACCOUNT_ID)).toBeNull()
    expect(await loadApiKey(kekB, OTHER_ACCOUNT_ID)).toEqual({ providerId: 'anthropic', apiKey: 'key-for-b' })

    clearApiKey(OTHER_ACCOUNT_ID)
  })
})
