import { useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { registrarConsentimento, type Finalidade } from '../../entities/consentimento/api'
import { useProntuario } from '../../features/prontuario/prontuario-context'
import { msg } from '@lingui/core/macro'
import { translateProblemCode } from '../../shared/api'
import { traduzir, type Texto } from '../../shared/i18n'

export interface ConsentimentoPacienteProps {
  baseUrl: string
  accountId: string
  accessToken: string
  patientId: string
}

/** O estado vem do prontuário aberto; cada decisão é registrada na API e o prontuário é relido. */
export function ConsentimentoPaciente({ baseUrl, accountId, accessToken, patientId }: ConsentimentoPacienteProps) {
  const { i18n } = useLingui()
  const { prontuario, recarregar } = useProntuario()
  const [ocupado, setOcupado] = useState(false)
  const [mensagem, setMensagem] = useState<Texto | null>(null)

  async function consentir(finalidade: Finalidade, concedido: boolean) {
    setOcupado(true); setMensagem(null)
    try {
      const resultado = await registrarConsentimento(baseUrl, accountId, accessToken, patientId,
        { finalidade, decisao: concedido ? 'concedido' : 'revogado' })
      if (!resultado.ok) throw new Error(translateProblemCode(resultado.code, resultado.params, i18n))
      await recarregar()
    } catch (erro) {
      setMensagem(erro instanceof Error ? erro.message : msg`Não foi possível concluir. Tente novamente.`)
    } finally { setOcupado(false) }
  }

  return <>
    <fieldset disabled={ocupado}><legend><Trans>Consentimento informado do paciente</Trans></legend>
      <label><input type="checkbox" checked={prontuario.consentimentos.gravacao === 'concedido'} onChange={(e) => void consentir('gravacao', e.target.checked)} /><Trans>Paciente autorizou a gravação</Trans></label>
      <label><input type="checkbox" checked={prontuario.consentimentos.analiseIa === 'concedido'} onChange={(e) => void consentir('analiseIa', e.target.checked)} /><Trans>Paciente autorizou a análise por IA local</Trans></label>
    </fieldset>
    {mensagem !== null && <p role="status">{traduzir(i18n, mensagem)}</p>}
  </>
}
