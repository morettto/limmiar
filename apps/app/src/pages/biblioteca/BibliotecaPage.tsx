import { useEffect, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import type { CryptoKey } from '@limmiar/crypto'
import type MiniSearch from 'minisearch'
import type { Nota } from '../../entities/nota/nota'
import type { ItemFila } from '../../features/nota-fila/FilaAssinatura'
import { agruparPorPaciente } from '../../features/nota-biblioteca/biblioteca'
import { buscar, construirIndice, notaParaDoc, type DocNota } from '../../features/nota-biblioteca/indice'
import {
  persistirIndice,
  restaurarIndice,
  type GravarSelado,
  type LerSelado,
} from '../../features/nota-biblioteca/indice-store'
import { BibliotecaNotas } from '../../widgets/biblioteca/BibliotecaNotas'

export interface BibliotecaPageProps {
  itens: readonly ItemFila[]
  notas: readonly Nota[]
  accountId: string
  dek: CryptoKey | null
  store: { ler: LerSelado; gravar: GravarSelado }
}

/**
 * Dona do ciclo restaurar -> (se `null`) construir + persistir -> `buscar(indice, termo)`, e
 * da DEK -- ver README, "Fluxo principal", para o passo a passo completo (inclui o caso
 * `dek === null`).
 *
 * Índice de busca nunca sai por rede: `buscar` é local (MiniSearch em memória), e
 * `persistirIndice`/`restaurarIndice` só tocam OPFS via `store` -- nenhum termo digitado
 * aqui chega a `fetch` (critério de aceite 1 do ticket).
 */
export function BibliotecaPage({ itens, notas, accountId, dek, store }: BibliotecaPageProps) {
  const { t } = useLingui()
  const [indice, setIndice] = useState<MiniSearch<DocNota> | null>(null)
  const [termo, setTermo] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (dek === null) {
      return
    }
    let cancelado = false

    async function preparar(dekAtual: CryptoKey) {
      const restaurado = await restaurarIndice(store.ler, dekAtual, accountId)
      if (cancelado) return
      if (restaurado) {
        setIndice(restaurado)
        return
      }
      const construido = construirIndice(notas.map(notaParaDoc))
      await persistirIndice(store.gravar, dekAtual, accountId, construido)
      if (cancelado) return
      setIndice(construido)
    }

    setErro(null)
    // Sem `.catch` aqui, uma OPFS negada/corrompida ou uma DEK/AAD errada (`restaurarIndice`/
    // `abrirIndice` rejeitam) vira rejeição não tratada, e a página encalha em "Preparando a
    // busca..." para sempre, sem sinal ao utilizador -- mesmo padrão de `PatientWallet.tsx`
    // (`load(kek).catch(...)`), mesmo `role="alert"`.
    preparar(dek).catch(() => {
      if (!cancelado) {
        setErro(t`Não foi possível preparar a busca. Tente novamente.`)
      }
    })
    return () => {
      cancelado = true
    }
  }, [dek, accountId, store, notas, t])

  if (erro !== null) {
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="alert" className="text-sm text-red-700">
          {erro}
        </p>
      </div>
    )
  }

  return (
    <BibliotecaNotas
      grupos={agruparPorPaciente(itens)}
      termo={termo}
      onTermoChange={setTermo}
      resultado={buscar(indice, termo)}
    />
  )
}
