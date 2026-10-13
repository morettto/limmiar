import { createContext, useContext } from 'react'
import type { Prontuario } from './abrir-prontuario'

export interface ProntuarioContexto {
  prontuario: Prontuario
  /** Relê o prontuário sem desmontar quem o usa; rejeita se a leitura falhar. */
  recarregar(): Promise<void>
}

export const ProntuarioContext = createContext<ProntuarioContexto | null>(null)

export function useProntuario(): ProntuarioContexto {
  const contexto = useContext(ProntuarioContext)
  if (contexto === null) throw new Error('useProntuario precisa de um <ProntuarioProvider> acima.')
  return contexto
}
