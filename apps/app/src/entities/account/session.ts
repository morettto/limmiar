import type { Account } from './account'

const SESSION_STORAGE_KEY = 'limmiar:account'

export interface KeyValueStorage {
  setItem(key: string, value: string): void
}

// Accepts the storage as a dependency instead of reaching for `window.sessionStorage`
// itself, so tests can inject an in-memory stand-in without touching a real Storage.
export function createSessionRecorder(storage: KeyValueStorage): (account: Account) => void {
  return (account) => {
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(account))
  }
}

// The one place this module reaches for the real browser storage. Deliberately not
// re-exported by the `entities/account` barrel (S08-08 review): that barrel is imported
// all over the app for unrelated reasons (`Account`, `login`...) -- import this file directly.
export const recordSession = createSessionRecorder(window.sessionStorage)
