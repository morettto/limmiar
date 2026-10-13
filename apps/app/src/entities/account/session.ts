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
// 'SetupRequired' fica de fora de propósito: um cadastro sem segundo fator concluído nunca é guardado.
const REQUISITOS_2FA: readonly TwoFactorRequirement[] = ['NotApplicable', 'ChallengeRequired']

// Stored metadata never grants access: the API still validates the bearer token.
function ehConta(valor: unknown): valor is Account {
  if (!valor) {
    return false
  }
  const { id, email, role, twoFactorRequirement, accessToken, refreshToken, accessTokenExpiresAt } = valor as Partial<Account>
  return (
    typeof id === 'string' &&
    id !== '' &&
    (role === 'Patient' ? email === null : typeof email === 'string' && email.trim() !== '') &&
    PAPEIS.includes(role as AccountRole) &&
    REQUISITOS_2FA.includes(twoFactorRequirement as TwoFactorRequirement) &&
    typeof accessToken === 'string' && accessToken !== '' &&
    typeof refreshToken === 'string' && refreshToken !== '' &&
    typeof accessTokenExpiresAt === 'string' && Number.isFinite(Date.parse(accessTokenExpiresAt))
  )
}

// Accepts the storage as a dependency instead of reaching for `window.sessionStorage` itself, so
// tests can inject an in-memory stand-in without touching a real Storage.
export function criarSessaoDeConta(storage: KeyValueStorage): SessaoDeConta {
  return {
    ler() {
      const raw = storage.getItem(SESSION_STORAGE_KEY)
      // Stryker disable next-line ConditionalExpression,BlockStatement: equivalent, JSON.parse(null) is null, which ehConta refuses.
      if (raw === null) {
        return null
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
        // Stryker disable next-line BlockStatement: equivalent, an unparsed value stays undefined, which ehConta refuses.
      } catch {
        return null
      }

      if (!ehConta(parsed)) {
        return null
      }
      const { id, email, role, twoFactorRequirement, accessToken, refreshToken, accessTokenExpiresAt } = parsed
      return { id, email, role, twoFactorRequirement, twoFactorTicket: null, accessToken, refreshToken, accessTokenExpiresAt }
    },
    registar(account) {
      if (!ehConta(account)) throw new Error('Cannot persist an incomplete authentication')
      const { id, email, role, twoFactorRequirement, accessToken, refreshToken, accessTokenExpiresAt } = account
      storage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ id, email, role, twoFactorRequirement, accessToken, refreshToken, accessTokenExpiresAt }))
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
