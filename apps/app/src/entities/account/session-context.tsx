import { createContext, useContext } from 'react'
import type { Account } from './account'

export interface ContextoSessao {
  sessao: Account | null
  kek: CryptoKey | null
  iniciarSessao(account: Account, kek?: CryptoKey): void
  terminarSessao(): void
}

export const SessionContext = createContext<ContextoSessao | null>(null)

export function useSession(): ContextoSessao {
  const value = useContext(SessionContext)
  if (value === null) {
    throw new Error('useSession: nenhum <SessionProvider> ancestral')
  }
  return value
}
