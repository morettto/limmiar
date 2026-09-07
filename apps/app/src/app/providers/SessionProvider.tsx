import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { Account } from '../../entities/account'
import { sessaoDaConta } from '../../entities/account/session'
import { SessionContext } from '../../entities/account/session-context'
import { purgarConta } from './purgar-conta'

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
