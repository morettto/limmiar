import { useMemo, useState, type ReactNode } from 'react'
import type { Account } from '../../entities/account'
import { sessaoDaConta } from '../../entities/account/session'
import { SessionContext } from '../../entities/account/session-context'
import { purgarConta } from './purgar-conta'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Account | null>(() => sessaoDaConta.ler())

  // Uma camada de memoização, não três (S18-14): as duas funções só dependiam de `sessao`.
  // Alvo da purga é `sessao` (estado), não `sessaoDaConta.ler()`, que degrada para `null` em
  // storage corrompido e saltaria a purga em silêncio (ver README).
  const value = useMemo(() => {
    const iniciarSessao = (account: Account) => {
      if (sessao !== null && sessao.id !== account.id) {
        void purgarConta(sessao.id)
      }
      sessaoDaConta.registar(account)
      setSessao(account)
    }
    const terminarSessao = () => {
      sessaoDaConta.terminar()
      setSessao(null)
      if (sessao !== null) {
        void purgarConta(sessao.id)
      }
    }
    return { sessao, iniciarSessao, terminarSessao }
  }, [sessao])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
