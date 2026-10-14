import { createContext, useContext, useEffect, type Dispatch, type SetStateAction } from 'react'

export const BloqueioContext = createContext<Dispatch<SetStateAction<number>> | null>(null)

// Contador, não booleano: o cleanup de uma página que sai não pode soltar o bloqueio de outra que entra.
export function useBloquearNavegacao(ativo: boolean): void {
  const setBloqueios = useContext(BloqueioContext)
  if (setBloqueios === null) throw new Error('useBloquearNavegacao: nenhum <AppShell> ancestral')
  useEffect(() => {
    if (!ativo) return
    setBloqueios(total => total + 1)
    return () => setBloqueios(total => total - 1)
  }, [ativo, setBloqueios])
}
