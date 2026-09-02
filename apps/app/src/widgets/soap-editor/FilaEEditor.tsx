import { useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { AdaptivePanel } from '@limmiar/ui'
import type { Ancora } from '@limmiar/copilot'
import type { Nota } from '../../entities/nota/nota'
import { FilaAssinatura } from '../../features/nota-fila/FilaAssinatura'
import { EditorSoap } from '../../features/nota-editor/EditorSoap'

export interface FilaEEditorProps {
  /** A fila inteira, todas as abas. A fila real (fatia 4, backend) substitui isto por um fetch. */
  notas: readonly Nota[]
  onChangeNota: (nota: Nota) => void
  /** Vem do reprodutor real (fatia 3, `features/nota-audio/reprodutor.ts`), repassado sem
   *  alteração até `EditorSoap`/`Citacao`. */
  aoTocar: (ancora: Ancora) => void
  /** Assinar de facto fica para a fatia 4; aqui só coordena fila + editor. */
  aoAssinar: (nota: Nota) => void
}

/**
 * Ecrã P4.1: fila de assinatura (esquerda) + editor SOAP (direita), compostos com
 * `AdaptivePanel` de `@limmiar/ui` (R5 -- coluna fixa em D, gaveta/faixa em T/M).
 */
export function FilaEEditor({ notas, onChangeNota, aoTocar, aoAssinar }: FilaEEditorProps) {
  const { t } = useLingui()
  const [selecionadoId, setSelecionadoId] = useState<string | null>(notas[0]?.id ?? null)
  const notaSelecionada = notas.find((nota) => nota.id === selecionadoId)

  return (
    <div className="flex">
      <AdaptivePanel label={t`Fila de assinatura`}>
        <FilaAssinatura itens={notas} selecionadoId={selecionadoId} onSelecionar={setSelecionadoId} />
      </AdaptivePanel>
      <div className="flex-1 p-3">
        {notaSelecionada ? (
          <EditorSoap nota={notaSelecionada} onChange={onChangeNota} aoTocar={aoTocar} aoAssinar={aoAssinar} />
        ) : (
          <p role="status">
            <Trans>Selecione uma nota na fila.</Trans>
          </p>
        )}
      </div>
    </div>
  )
}
