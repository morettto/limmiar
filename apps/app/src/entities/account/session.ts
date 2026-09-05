import type { Account, AccountRole, TwoFactorRequirement } from './account'

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

const PAPEIS: readonly AccountRole[] = ['Professional', 'Patient']
const REQUISITOS_2FA: readonly TwoFactorRequirement[] = ['NotApplicable', 'SetupRequired', 'ChallengeRequired']

// Valida os quatro campos que o predicado promete (valor is Account), não só `id` -- um
// sessionStorage editável no DevTools não deve conseguir forjar um `role`/`twoFactorRequirement`
// que o compilador depois trata como garantido em quem ler `sessao` do contexto.
function ehConta(valor: unknown): valor is Account {
  if (typeof valor !== 'object' || valor === null) {
    return false
  }
  const { id, email, role, twoFactorRequirement } = valor as Partial<Account>
  return (
    typeof id === 'string' &&
    id !== '' &&
    typeof email === 'string' &&
    role !== undefined &&
    PAPEIS.includes(role) &&
    twoFactorRequirement !== undefined &&
    REQUISITOS_2FA.includes(twoFactorRequirement)
  )
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

      // twoFactorTicket nunca sobrevive ao round-trip (S18-07): mesmo que `registar` já não o
      // grave, uma sessão gravada antes deste fix ainda pode ter um ticket no sessionStorage --
      // `ler()` força null para não devolver um segredo de 2FA a quem restaura a sessão.
      return ehConta(parsed) ? { ...parsed, twoFactorTicket: null } : null
    },
    registar(account) {
      const { twoFactorTicket: _twoFactorTicket, ...semTicket } = account
      storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(semTicket))
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
