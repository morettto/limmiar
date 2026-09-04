import type { Account } from './account'

const SESSION_STORAGE_KEY = 'limmiar:account'

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface SessaoDeConta {
  ler(): Account | null
  registar(account: Account): void
  terminar(): void
}

// ponytail: only `id` is validated because it is the only field this module reads back from a
// restored session (accountId); `role`/`twoFactorRequirement` always arrive fresh from `registar`
// in the login/recovery flow, never round-tripped through JSON.
function ehConta(valor: unknown): valor is Account {
  if (typeof valor !== 'object' || valor === null) {
    return false
  }
  const { id } = valor as { id?: unknown }
  return typeof id === 'string' && id !== ''
}

// Accepts the storage as a dependency instead of reaching for `window.sessionStorage` itself, so
// tests can inject an in-memory stand-in without touching a real Storage.
export function criarSessaoDeConta(storage: KeyValueStorage): SessaoDeConta {
  return {
    ler() {
      const raw = storage.getItem(SESSION_STORAGE_KEY)
      if (raw === null) {
        return null
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return null
      }

      return ehConta(parsed) ? parsed : null
    },
    registar(account) {
      storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(account))
    },
    terminar() {
      storage.removeItem(SESSION_STORAGE_KEY)
    },
  }
}

// The one place this module reaches for the real browser storage. Deliberately not re-exported by
// the `entities/account` barrel (S08-08 review): that barrel is imported all over the app for
// unrelated reasons (`Account`, `login`...) -- import this file directly.
export const sessaoDaConta: SessaoDeConta = criarSessaoDeConta(window.sessionStorage)
