import { useCallback, useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { criarSessaoOnline, encerrarSessaoOnline, type ConviteOnline } from '../../entities/online-session/api'
import { OnlineCall } from '../../features/online-call/OnlineCall'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { translateProblemCode } from '../../shared/api'
import { SessionReview, type SessionReviewProps } from '../../features/live-session/SessionReview'

export interface OnlineSessionProps {
  baseUrl: string
  accountId: string
  accessToken: string
  patientId: string
  kek: SessionReviewProps['kek']
  paciente: SessionReviewProps['paciente']
  atendimentoId: SessionReviewProps['atendimentoId']
  transcricao?: SessionReviewProps['transcricao']
  onPendingChange(pending: boolean): void
  onSaved?: SessionReviewProps['onSaved']
  onPropostaReferencia?: SessionReviewProps['onPropostaReferencia']
}

export function OnlineSession({ baseUrl, accountId, accessToken, patientId, kek, paciente, atendimentoId, transcricao, onPendingChange, onSaved, onPropostaReferencia }: OnlineSessionProps) {
  const { i18n, t } = useLingui()
  const [convite, setConvite] = useState<ConviteOnline | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<MessageDescriptor | null>(null)
  const [encerrada, setEncerrada] = useState(false)
  const [conectada, setConectada] = useState(false)
  const [fluxos, setFluxos] = useState<{ local: MediaStream | null; remoto: MediaStream | null }>({ local: null, remoto: null })
  const [transcricaoPendente, setTranscricaoPendente] = useState(false)
  const finalizarTranscricao = useRef<(() => Promise<void>) | null>(null)
  // Stryker disable next-line ArrayDeclaration: equivalent, a callback with no dependencies keeps one identity either way.
  const prepararEncerramento = useCallback((finalizar: () => Promise<void>) => { finalizarTranscricao.current = finalizar }, [])
  // Stryker disable next-line ArrayDeclaration: equivalent, a callback with no dependencies keeps one identity either way.
  const antesDeEncerrar = useCallback(async () => { await finalizarTranscricao.current?.() }, [])
  // Stryker disable ArrayDeclaration: equivalent, a callback with no dependencies keeps one identity either way.
  const receberFluxos = useCallback((local: MediaStream, remoto: MediaStream) => {
    setFluxos(anteriores => anteriores.local === local && anteriores.remoto === remoto ? anteriores : { local, remoto })
  }, [])
  // Stryker restore ArrayDeclaration
  const encerramentoAutomatico = useRef<string | null>(null)
  useEffect(() => { onPendingChange(ocupado || transcricaoPendente || (convite !== null && !encerrada)) }, [convite, ocupado, encerrada, transcricaoPendente, onPendingChange])
  async function criar() {
    setOcupado(true); setErro(null)
    try {
      const result = await criarSessaoOnline(baseUrl, accountId, accessToken, patientId)
      if (!result.ok) throw new Error(translateProblemCode(result.code, result.params, i18n))
      setConvite(result.convite)
    } catch { setErro(msg`Não foi possível criar o convite da sessão online.`) }
    finally { setOcupado(false) }
  }
  async function encerrar() {
    setOcupado(true); setErro(null)
    try {
      await antesDeEncerrar()
      const result = await encerrarSessaoOnline(baseUrl, accountId, accessToken, convite!.roomId)
      if (!result.ok && result.code !== 'link.invite_not_found') throw new Error(translateProblemCode(result.code, result.params, i18n))
      setEncerrada(true)
    } catch { setErro(msg`Não foi possível revogar o convite. Tente encerrar novamente.`) }
    finally { setOcupado(false) }
  }
  const link = new URL('/session/online', location.origin)
  if (convite) link.hash = new URLSearchParams({ room: convite.roomId, token: convite.patientToken }).toString()
  return <section aria-label={t`Convite da sessão online`}>
    {!convite && <button type="button" className="button-primary" disabled={ocupado} onClick={() => void criar()}><Trans>Gerar convite de sessão online</Trans></button>}
    {erro !== null && <p role="alert">{i18n._(erro)}</p>}
    {convite && !encerrada && <>
      <label><Trans>Link privado da sessão online</Trans><input readOnly value={link.href} onFocus={event => event.target.select()} /></label>
      <p><Trans>Entregue este link diretamente ao paciente. Nome e contato não são solicitados.</Trans></p>
      {/* eslint-disable-next-line lingui/no-unlocalized-strings -- Role required by the call protocol. */}
      <OnlineCall baseUrl={baseUrl} roomId={convite.roomId} token={convite.professionalToken} papel="professional"
        onStreams={receberFluxos} antesDeEncerrar={antesDeEncerrar}
        onState={state => {
          setConectada(state === 'conectada')
          if (state === 'encerrada' && encerramentoAutomatico.current !== convite.roomId) {
            encerramentoAutomatico.current = convite.roomId
            void encerrar()
          }
        }} />
      <button type="button" disabled={ocupado} onClick={() => void encerrar()}><Trans>Encerrar e revogar convite online</Trans></button>
    </>}
    {encerrada && <p role="status"><Trans>Convite online encerrado.</Trans></p>}
    {convite && <SessionReview baseUrl={baseUrl} accountId={accountId} accessToken={accessToken} kek={kek} paciente={paciente} atendimentoId={atendimentoId} transcricao={transcricao}
      online={{ ...fluxos, ativa: conectada && !encerrada }} onPendingChange={setTranscricaoPendente} prepararEncerramento={prepararEncerramento} onSaved={onSaved} onPropostaReferencia={onPropostaReferencia} />}
  </section>
}
