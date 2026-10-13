import { useLingui } from '@lingui/react/macro'
import { ESTADO_ASSINADA } from '../../entities/nota/nota'
import { useProntuario } from './prontuario-context'

export function EstadoDoAtendimento({ atendimentoId }: { atendimentoId: string }) {
  const { t } = useLingui()
  const { prontuario } = useProntuario()
  const transcrito = prontuario.transcricoes.some(item => item.id === atendimentoId)
  const assinado = prontuario.notas.some(nota => nota.atendimentoId === atendimentoId && nota.estado === ESTADO_ASSINADA)
  return <span className="editorial-meta">{transcrito ? t`Transcrição salva` : t`Sem transcrição`} · {assinado ? t`Nota assinada` : t`Nota pendente`}</span>
}
