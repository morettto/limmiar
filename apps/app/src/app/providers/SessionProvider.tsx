import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Account } from '../../entities/account'
import { sessaoDaConta } from '../../entities/account/session'
import { clearApiKey } from '../../features/copilot-byok/key-store'
import { purgarIndiceBusca } from '../../features/nota-biblioteca/indice-store'

type PurgaDeConta = (accountId: string) => void | Promise<void>

// Módulo-level, NÃO exportada. Exportar a lista, ou um registarPurga(), seria registo
// dinâmico -- a spec recusa isso.
const PURGAS: readonly PurgaDeConta[] = [clearApiKey, purgarIndiceBusca]

async function purgarConta(accountId: string): Promise<void> {
  for (const purga of PURGAS) {
    try {
      await purga(accountId)
    } catch {
      // uma purga falhada não trava as outras nem o logout
    }
  }
}

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
