import { useState, type KeyboardEvent } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { proximoIndice } from './navegacao-teclado'
import { ESTADO_PENDENTE, ESTADOS_NOTA, type EstadoNota, type Nota } from '../../entities/nota/nota'

export interface FilaAssinaturaProps {
  itens: readonly Nota[]
  /** Nota atualmente aberta no editor (fonte da verdade no widget-pai), não a que o teclado percorre. */
  selecionadoId: string | null
  onSelecionar: (id: string) => void
}

const ABAS = ESTADOS_NOTA

function indiceInicial(total: number): number {
  return total > 0 ? 0 : -1
}

// `itens` pode encolher "por fora" sem que `trocarAba` tenha corrido, deixando `indiceAtivo`
// maior do que `filtrados.length` permite. Clampa em vez de apontar para além do fim (ver
// README, "índice ativo sobrevive a itens que encolhem").
function indiceClampado(indice: number, total: number): number {
  return total === 0 ? -1 : Math.min(Math.max(indice, 0), total - 1)
}

/**
 * Fila de assinatura: abas de estado + listbox acessível, navegação j/k sem wrap (ver README).
 * `aria-activedescendant` é o cursor do teclado e `aria-selected` a nota aberta no editor --
 * os dois divergem enquanto se navega sem premir Enter.
 */
export function FilaAssinatura({ itens, selecionadoId, onSelecionar }: FilaAssinaturaProps) {
  const { t } = useLingui()
  const [aba, setAba] = useState<EstadoNota>(ESTADO_PENDENTE)
  const filtrados = itens.filter((item) => item.estado === aba)
  const [indiceAtivo, setIndiceAtivo] = useState(() => indiceInicial(filtrados.length))

  const rotulos: Record<EstadoNota, string> = {
    pendente: t`Pendentes`,
    assinada: t`Assinadas`,
  }

  function trocarAba(proximaAba: EstadoNota) {
    setAba(proximaAba)
    setIndiceAtivo(indiceInicial(itens.filter((item) => item.estado === proximaAba).length))
  }

  const indiceEfetivo = indiceClampado(indiceAtivo, filtrados.length)
  const itemAtivo = filtrados[indiceEfetivo]

  function aoTeclarNaListbox(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'j' || e.key === 'k') {
      e.preventDefault()
      setIndiceAtivo((indiceAnterior) =>
        proximoIndice(indiceClampado(indiceAnterior, filtrados.length), filtrados.length, e.key),
      )
      return
    }
    if (e.key === 'Enter' && itemAtivo) {
      onSelecionar(itemAtivo.id)
    }
  }

  const id = itemAtivo ? `fila-opcao-${itemAtivo.id}` : undefined

  return (
    <div>
      <div role="tablist" aria-label={t`Estado da nota`} className="mb-2 flex gap-1">
        {ABAS.map((estadoAba) => (
          <button
            key={estadoAba}
            type="button"
            role="tab"
            aria-selected={aba === estadoAba}
            onClick={() => trocarAba(estadoAba)}
            className="min-h-11 rounded-md border border-neutral-300 px-3"
          >
            {rotulos[estadoAba]}
          </button>
        ))}
      </div>
      <div
        role="listbox"
        aria-label={t`Fila de assinatura`}
        aria-activedescendant={id}
        tabIndex={0}
        onKeyDown={aoTeclarNaListbox}
        className="flex flex-col gap-1"
      >
        {filtrados.length === 0 ? (
          <p role="status">
            <Trans>Nenhuma nota nesta aba.</Trans>
          </p>
        ) : (
          filtrados.map((item, indice) => (
            <div
              key={item.id}
              id={`fila-opcao-${item.id}`}
              role="option"
              aria-selected={item.id === selecionadoId}
              onClick={() => onSelecionar(item.id)}
              className={`min-h-11 rounded-md border px-3 py-2 ${
                indice === indiceEfetivo ? 'border-neutral-900' : 'border-neutral-300'
              }`}
            >
              {item.patientId}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
