import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Account } from '../../entities/account'
import { sessaoDaConta } from '../../entities/account/session'
import { clearApiKey } from '../../features/copilot-byok/key-store'
import { purgarIndiceBusca } from '../../features/nota-biblioteca/indice-store'

type PurgaDeConta = (accountId: string) => void | Promise<void>
type EntradaDePurga = readonly [nome: string, purga: PurgaDeConta]

// Módulo-level, NÃO exportada. Exportar a lista, ou um registarPurga(), seria registo
// dinâmico -- a spec recusa isso. Nome literal (não `purga.name`): o bundle de produção
// minifica funções, e `name` deixaria de ser legível no rasto do catch abaixo.
const PURGAS: readonly EntradaDePurga[] = [
  ['clearApiKey', clearApiKey],
  ['purgarIndiceBusca', purgarIndiceBusca],
]

async function purgarConta(accountId: string): Promise<void> {
  for (const [nome, purga] of PURGAS) {
    try {
      await purga(accountId)
    } catch (erro) {
      // uma purga falhada não trava as outras nem o logout; rasto é tudo o que existe hoje
      // (README `app/providers`). `erro` é seguro no console: DOMException de OPFS/
      // localStorage negado não carrega blob nem material de chave.
      console.error(`SessionProvider: purga "${nome}" falhou para a conta ${accountId}`, erro)
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
