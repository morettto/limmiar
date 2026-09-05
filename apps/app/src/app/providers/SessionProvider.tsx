import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Account } from '../../entities/account'
import { sessaoDaConta } from '../../entities/account/session'
import { purgarConta } from './purgar-conta'

export interface ContextoSessao {
  sessao: Account | null
  iniciarSessao(account: Account): void
  terminarSessao(): void
}

const SessionContext = createContext<ContextoSessao | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Account | null>(() => sessaoDaConta.ler())

  // Alvo da purga é `sessao` (estado), não `sessaoDaConta.ler()`: `ler()` degrada para `null` em
  // storage corrompido -- certo para autenticação (falha fechada), mas saltaria a purga em
  // silêncio. `sessao` foi lido válido no mount, é a identidade que o botão "Sair" mostra.
  const iniciarSessao = useCallback((account: Account) => {
    if (sessao !== null && sessao.id !== account.id) {
      void purgarConta(sessao.id)
    }
    sessaoDaConta.registar(account)
    setSessao(account)
  }, [sessao])

  const terminarSessao = useCallback(() => {
    sessaoDaConta.terminar()
    setSessao(null)
    if (sessao !== null) {
      void purgarConta(sessao.id)
    }
  }, [sessao])

  const value = useMemo(() => ({ sessao, iniciarSessao, terminarSessao }), [sessao, iniciarSessao, terminarSessao])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): ContextoSessao {
  const value = useContext(SessionContext)
  if (value === null) {
    throw new Error('useSession: nenhum <SessionProvider> ancestral')
  }
  return value
}
