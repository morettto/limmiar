import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import type MiniSearch from 'minisearch'
import type { Nota } from '../../entities/nota/nota'
import { useSession } from '../../entities/account/session-context'
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
  nomesPacientes: ReadonlyMap<string, string>
  chaveIndice: ChaveIndiceBusca | null
  store: { ler: LerSelado; gravar: GravarSelado; apagar: ApagarSelado }
}

/**
 * Dona do ciclo restaurar -> (se `null`) construir + persistir -> `buscar(indice, termo)` e da
 * chave do índice; ver README, "Fluxo principal". O índice nunca sai por rede: `buscar` é
 * local e `persistirIndice`/`restaurarIndice` só tocam OPFS (critério de aceite 1).
 */
export function BibliotecaPage({ notas, nomesPacientes, chaveIndice, store }: BibliotecaPageProps) {
  const { sessao } = useSession()
  const accountId = sessao?.id ?? null
  const { i18n } = useLingui()
  const [indice, setIndice] = useState<MiniSearch<DocNota> | null>(null)
  const [termo, setTermo] = useState('')
  const [erro, setErro] = useState<MessageDescriptor | null>(null)
  const impressao = impressaoDigital(notas)

  useEffect(() => {
    // accountId===null cai no mesmo ramo que chaveIndice===null já cobria: sem conta real, não
    // há índice para restaurar/construir -- ver README, "accountId===null tratado no mesmo lugar".
    if (chaveIndice === null || accountId === null) {
      return
    }
    let cancelado = false

    async function preparar(chaveAtual: ChaveIndiceBusca, accountIdAtual: string) {
      const restaurado = await restaurarIndice(store, chaveAtual, accountIdAtual, impressao)
      if (cancelado) return
      if (restaurado) {
        setIndice(restaurado)
        return
      }
      const construido = construirIndice(notas.map(notaParaDoc))
      await persistirIndice(store.gravar, chaveAtual, accountIdAtual, construido, impressao)
      if (cancelado) return
      setIndice(construido)
    }

    setErro(null)
    // Sem `.catch`, uma OPFS negada ou uma chave/AAD errada vira rejeição não tratada e a
    // página encalha em "Preparando a busca..." sem sinal nenhum -- mesmo padrão de
    // `PatientWallet.tsx` (`load(kek).catch(...)`), mesmo `role="alert"`.
    preparar(chaveIndice, accountId).catch(() => {
      if (!cancelado) {
        setErro(msg`Não foi possível preparar a busca. Tente novamente.`)
      }
    })
    return () => {
      cancelado = true
    }
  }, [chaveIndice, accountId, impressao])

  return <main className="workspace">
    <header><h1><Trans>Biblioteca de notas</Trans></h1></header>
    {erro !== null ? (
      <div className="mx-auto max-w-sm p-4">
        <p role="alert" className="text-sm text-red-700">
          {i18n._(erro)}
        </p>
      </div>
    ) : (
    <BibliotecaNotas
      grupos={agruparPorPaciente(notas)}
      nomesPacientes={nomesPacientes}
      termo={termo}
      onTermoChange={setTermo}
      resultado={buscar(indice, termo)}
    />
    )}
  </main>
}
