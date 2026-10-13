import { useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { criarConviteVinculo, revogarConvitesVinculo } from '../../entities/vinculo/api'
import { msg } from '@lingui/core/macro'
import { translateProblemCode } from '../../shared/api'
import { traduzir, type Texto } from '../../shared/i18n'
import { ConsentimentoPaciente } from './ConsentimentoPaciente'

const ACCESS_TOKEN_QUERY = 'token'

export interface PatientAccessProps {
  baseUrl: string
  accountId: string
  accessToken: string
  patientId: string
}

export function PatientAccess({ baseUrl, accountId, accessToken, patientId }: PatientAccessProps) {
  const { i18n } = useLingui()
  const [ocupado, setOcupado] = useState(false)
  const [mensagem, setMensagem] = useState<Texto | null>(null)
  const [convite, setConvite] = useState<{ href: string; expiraEm: string } | null>(null)

  async function executar(acao: () => Promise<void>) {
    setOcupado(true); setMensagem(null)
    try { await acao() } catch (erro) {
      setMensagem(erro instanceof Error ? erro.message : msg`Não foi possível concluir. Tente novamente.`)
    } finally { setOcupado(false) }
  }

  const convidar = () => executar(async () => {
    const result = await criarConviteVinculo(baseUrl, accountId, accessToken, patientId)
    if (!result.ok) throw new Error(translateProblemCode(result.code, result.params, i18n))
    const link = new URL('/auth/magic-link', window.location.origin)
    link.searchParams.set(ACCESS_TOKEN_QUERY, result.codigo)
    setConvite({ href: link.href, expiraEm: result.expiraEm })
  })

  const revogar = () => executar(async () => {
    const result = await revogarConvitesVinculo(baseUrl, accountId, accessToken, patientId)
    if (!result.ok) throw new Error(translateProblemCode(result.code, result.params, i18n))
    setConvite(null)
    setMensagem(msg`Links de acesso pendentes revogados.`)
  })

  return <details className="patient-permissions"><summary><Trans>Acesso e consentimentos</Trans></summary>
    <div className="mt-4">
      <button type="button" disabled={ocupado} onClick={() => void convidar()}><Trans>Gerar link privado de acesso</Trans></button>
      <button type="button" disabled={ocupado} onClick={() => void revogar()}><Trans>Revogar links de acesso pendentes</Trans></button>
      {mensagem !== null && <p role="status">{traduzir(i18n, mensagem)}</p>}
      {convite && <div>
        <label><Trans>Link de acesso do paciente</Trans><input readOnly value={convite.href} onFocus={(event) => event.target.select()} /></label>
        <p><Trans>Entregue este link diretamente ao paciente. Ele confirma o acesso com sua passkey.</Trans></p>
        <p><Trans>Válido até</Trans>{' '}{new Date(convite.expiraEm).toLocaleString(i18n.locale)}</p>
      </div>}
    </div>
    <ConsentimentoPaciente baseUrl={baseUrl} accountId={accountId} accessToken={accessToken} patientId={patientId} />
  </details>
}
