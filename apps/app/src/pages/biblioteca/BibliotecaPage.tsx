import { useEffect, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import type MiniSearch from 'minisearch'
import type { Nota } from '../../entities/nota/nota'
import { agruparPorPaciente } from '../../features/nota-biblioteca/biblioteca'
import { buscar, construirIndice, impressaoDigital, notaParaDoc, type DocNota } from '../../features/nota-biblioteca/indice'
import type { ChaveIndiceBusca } from '../../features/nota-biblioteca/indice-crypto'
import {
  persistirIndice,
  restaurarIndice,
  type ApagarSelado,
  type GravarSelado,
  type LerSelado,
} from '../../features/nota-biblioteca/indice-store'
import { BibliotecaNotas } from '../../widgets/biblioteca/BibliotecaNotas'

export interface BibliotecaPageProps {
  notas: readonly Nota[]
  accountId: string
  chaveIndice: ChaveIndiceBusca | null
  store: { ler: LerSelado; gravar: GravarSelado; apagar: ApagarSelado }
}

/**
 * Dona do ciclo restaurar -> (se `null`) construir + persistir -> `buscar(indice, termo)` e da
 * chave do índice; ver README, "Fluxo principal". O índice nunca sai por rede: `buscar` é
 * local e `persistirIndice`/`restaurarIndice` só tocam OPFS (critério de aceite 1).
 */
export function BibliotecaPage({ notas, accountId, chaveIndice, store }: BibliotecaPageProps) {
  const { t } = useLingui()
  const [indice, setIndice] = useState<MiniSearch<DocNota> | null>(null)
  const [termo, setTermo] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (chaveIndice === null) {
      return
    }
    let cancelado = false

    async function preparar(chaveAtual: ChaveIndiceBusca) {
      const impressao = impressaoDigital(notas)
      const restaurado = await restaurarIndice(store, chaveAtual, accountId, impressao)
      if (cancelado) return
      if (restaurado) {
        setIndice(restaurado)
        return
      }
      const construido = construirIndice(notas.map(notaParaDoc))
      await persistirIndice(store.gravar, chaveAtual, accountId, construido, impressao)
      if (cancelado) return
      setIndice(construido)
    }

    setErro(null)
    // Sem `.catch`, uma OPFS negada ou uma chave/AAD errada vira rejeição não tratada e a
    // página encalha em "Preparando a busca..." sem sinal nenhum -- mesmo padrão de
    // `PatientWallet.tsx` (`load(kek).catch(...)`), mesmo `role="alert"`.
    preparar(chaveIndice).catch(() => {
      if (!cancelado) {
        setErro(t`Não foi possível preparar a busca. Tente novamente.`)
      }
    })
    return () => {
      cancelado = true
    }
  }, [chaveIndice, accountId, store, notas, t])

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
      grupos={agruparPorPaciente(notas)}
      termo={termo}
      onTermoChange={setTermo}
      resultado={buscar(indice, termo)}
    />
  )
}
