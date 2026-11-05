import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Trans } from '@lingui/react/macro'
import { useSession } from '../../entities/account/session-context'
import { VoiceSettings, type VoiceSettingsProps } from './VoiceSettings'
import { VoiceEnrollmentContext } from './enrollment-context'
import { temPerfilDeVoz } from './perfil-de-voz'
import './voice-onboarding.css'

export function VoiceEnrollmentGate({ children }: { children: ReactNode }) {
  const { sessao, kek, terminarSessao } = useSession()
  if (sessao?.role !== 'Professional' || !sessao.accessToken || !kek) return children
  return <VoiceOnboarding key={sessao.id} baseUrl={import.meta.env.VITE_API_BASE_URL ?? ''}
    accountId={sessao.id} accessToken={sessao.accessToken} kek={kek} onExit={terminarSessao}>{children}</VoiceOnboarding>
}

type Perfil = { status: 'verificando' | 'falha' | 'ausente' | 'pronto' }

export function VoiceOnboarding({ children, onExit, ...props }: VoiceSettingsProps & { children: ReactNode; onExit: () => void }) {
  const { baseUrl, accountId, kek } = props
  const [perfil, setPerfil] = useState<Perfil>({ status: 'verificando' })
  const [tentativa, setTentativa] = useState(0)
  // A renovação do token não pode repetir a verificação nem desmontar o consultório aberto.
  const accessToken = useRef(props.accessToken)
  accessToken.current = props.accessToken
  useEffect(() => {
    const abort = new AbortController()
    setPerfil({ status: 'verificando' })
    temPerfilDeVoz(baseUrl, accountId, accessToken.current, kek, abort.signal).then(
      existe => setPerfil({ status: existe ? 'pronto' : 'ausente' }),
      () => { if (!abort.signal.aborted) setPerfil({ status: 'falha' }) })
    return () => abort.abort()
  }, [baseUrl, accountId, kek, tentativa])
  const onReady = useCallback((ready: boolean) => setPerfil({ status: ready ? 'pronto' : 'ausente' }), [])
  const focusHeading = useCallback((heading: HTMLHeadingElement | null) => heading?.focus(), [])
  if (perfil.status === 'verificando') return <main className="workspace"><p role="status"><Trans>Verificando seu perfil de voz...</Trans></p></main>
  if (perfil.status === 'falha') return <main className="workspace"><p role="alert"><Trans>Não foi possível abrir seu perfil de voz. Tente novamente.</Trans></p>
    <button type="button" onClick={() => setTentativa(valor => valor + 1)}><Trans>Tentar novamente</Trans></button></main>
  return <VoiceEnrollmentContext value={onReady}>
    {perfil.status === 'pronto' ? children : <main className="voice-onboarding">
      <div className="vault-brand">Limmiar</div>
      <section className="voice-onboarding-intro">
        <p className="editorial-eyebrow"><Trans>Configuração obrigatória · cerca de 1 minuto</Trans></p>
        <h1 tabIndex={-1} ref={focusHeading}><Trans>Vamos reconhecer a sua voz</Trans></h1>
        <p><Trans>Antes do primeiro atendimento, precisamos distinguir sua fala da fala do paciente. Você só precisa fazer isso uma vez.</Trans></p>
        <ol>
          <li><Trans>Escolha um lugar silencioso e confira seu microfone.</Trans></li>
          <li><Trans>Permita o microfone e leia o texto em voz natural.</Trans></li>
          <li><Trans>Salve seu perfil para liberar os atendimentos.</Trans></li>
        </ol>
      </section>
      <VoiceSettings {...props} />
      <p className="voice-onboarding-footer"><Trans>Sem microfone agora? Volte quando puder concluir. Seu progresso na conta está salvo.</Trans></p>
      <button type="button" className="voice-onboarding-exit" onClick={onExit}><Trans>Sair da conta</Trans></button>
    </main>}
  </VoiceEnrollmentContext>
}
