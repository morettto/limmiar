import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Account } from '../../entities/account'
import { sessaoDaConta } from '../../entities/account/session'

export interface ContextoSessao {
  sessao: Account | null
  iniciarSessao(account: Account): void
  terminarSessao(): void
}

// Default when `useSession()` has no ancestor `<SessionProvider>`. `router.test.tsx` renders
// `<RouterProvider>` without `AppProviders` in ~25 places; throwing here would force wrapping all
// of them. Production always mounts via `App.tsx` -> `AppProviders`, which always includes this.
const SEM_PROVIDER: ContextoSessao = { sessao: null, iniciarSessao: () => {}, terminarSessao: () => {} }

const SessionContext = createContext<ContextoSessao>(SEM_PROVIDER)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Account | null>(() => sessaoDaConta.ler())

  const iniciarSessao = useCallback((account: Account) => {
    sessaoDaConta.registar(account)
    setSessao(account)
  }, [])

  const terminarSessao = useCallback(() => {
    sessaoDaConta.terminar()
    setSessao(null)
  }, [])

  const value = useMemo(() => ({ sessao, iniciarSessao, terminarSessao }), [sessao, iniciarSessao, terminarSessao])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): ContextoSessao {
  return useContext(SessionContext)
}
