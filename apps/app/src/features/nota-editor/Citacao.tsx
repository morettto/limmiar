import { useLingui } from '@lingui/react/macro'
import type { Ancora } from '@limmiar/copilot'

export interface CitacaoProps {
  ancora: Ancora
  /** Vem do reprodutor real (fatia 3, `features/nota-audio/reprodutor.ts`), passado pelo
   *  chamador (hoje `NotaPage`). */
  aoTocar: (ancora: Ancora) => void
}

function formatarMs(ms: number): string {
  const totalSegundos = Math.floor(ms / 1000)
  const minutos = Math.floor(totalSegundos / 60)
  const segundos = totalSegundos % 60
  return `${minutos}:${segundos.toString().padStart(2, '0')}`
}

/** Citação clicável de uma âncora temporal: mostra `mm:ss–mm:ss` e delega o tocar ao chamador.
 *  Passar o rato toca o instante; ganhar foco (`Tab`) toca também, senão quem navega por teclado
 *  ficaria sem forma de o disparar. */
export function Citacao({ ancora, aoTocar }: CitacaoProps) {
  const { t } = useLingui()
  const inicio = formatarMs(ancora.inicioMs)
  const fim = formatarMs(ancora.fimMs)
  return (
    <button
      type="button"
      onClick={() => aoTocar(ancora)}
      onMouseEnter={() => aoTocar(ancora)}
      onFocus={() => aoTocar(ancora)}
      aria-label={t`Tocar áudio de ${inicio} a ${fim}`}
      className="min-h-11 min-w-11 rounded-md border border-neutral-300 px-2 text-xs"
    >
      {inicio}–{fim}
    </button>
  )
}
