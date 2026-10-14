import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useBlocker, useNavigate } from '@tanstack/react-router'
import { Trans, useLingui } from '@lingui/react/macro'
import type { CryptoKey } from '@limmiar/crypto'
import { ABA_INSIGHTS, ABA_NOTA, FORMATO_DATA_ATENDIMENTO, type AbaDoAtendimento, type Atendimento } from '../../entities/atendimento/atendimento'
import type { PropostaReferencia } from '../../entities/nota/referencia'
import { SessionReview } from '../../features/live-session/SessionReview'
import { NotaDoAtendimento } from '../../features/nota-editor/NotaDoAtendimento'
import { EstadoDoAtendimento } from '../../features/prontuario/EstadoDoAtendimento'
import { useProntuario } from '../../features/prontuario/prontuario-context'
import { useBloquearNavegacao } from '../../widgets/app-shell/bloqueio'
import { ConsentimentoPaciente } from '../../widgets/patient-care/ConsentimentoPaciente'
import { OnlineSession } from '../../widgets/online-session/OnlineSession'
import { encerrarAtendimento } from '../../features/prontuario/encerrar-atendimento'
import { msg } from '@lingui/core/macro'
import { traduzir, type Texto } from '../../shared/i18n'

// eslint-disable-next-line lingui/no-unlocalized-strings -- ARIA token, not copy.
const paginaAtual = (ativa: boolean) => (ativa ? 'page' : undefined)

export interface AtendimentoPageProps {
  baseUrl: string
  accountId: string
  accessToken: string
  kek: CryptoKey
  patientId: string
  atendimentoId: string
  aba: AbaDoAtendimento
}

export function AtendimentoPage(props: AtendimentoPageProps) {
  const { prontuario } = useProntuario()
  const atendimento = prontuario.atendimentos.find(item => item.id === props.atendimentoId)
  if (atendimento === undefined) {
    return <main className="workspace">
      <p role="alert"><Trans>Não encontramos esta sessão na pasta do paciente.</Trans></p>
      <Link to="/pacientes/$patientId" params={{ patientId: props.patientId }}><Trans>Voltar à pasta do paciente</Trans></Link>
    </main>
  }
  return <Sessao key={atendimento.id} {...props} atendimento={atendimento} />
}

function Sessao({ baseUrl, accountId, accessToken, kek, patientId, atendimentoId, aba, atendimento }: AtendimentoPageProps & { atendimento: Atendimento }) {
  const { i18n, t } = useLingui()
  const { prontuario, recarregar } = useProntuario()
  const navigate = useNavigate()
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Values of the session modality contract.
  const [tipoSessao, setTipoSessao] = useState<'presencial' | 'online'>('presencial')
  // Gravação em curso ou transcrição sem salvar: o único estado que trava a saída desta página.
  const [pendente, setPendente] = useState(false)
  const [propostaReferencia, setPropostaReferencia] = useState<PropostaReferencia | null>(null)
  const [falhaRecarga, setFalhaRecarga] = useState(false)
  const [finalizando, setFinalizando] = useState(false)
  const [preparando, setPreparando] = useState(false)
  const [encerrada, setEncerrada] = useState(atendimento.encerradoEm !== undefined)
  const [avisoEncerramento, setAvisoEncerramento] = useState<Texto | null>(null)
  const pararCaptura = useRef<() => Promise<void>>(null)
  const salvarNota = useRef<() => Promise<void>>(null)
  const tituloRef = useRef<HTMLHeadingElement>(null)
  const tipoSessaoId = useId()

  const transcricoes = useMemo(() => prontuario.transcricoes.filter(item => item.id === atendimentoId), [prontuario.transcricoes, atendimentoId])
  const transcricao = transcricoes.at(-1)
  // Com transcrição salva a modalidade não se escolhe mais: uma gravação por sessão.
  const [abriuComTranscricao] = useState(transcricao !== undefined)
  const paciente = useMemo(() => ({ id: patientId, nome: prontuario.nome, dek: prontuario.dek,
    consentimentos: prontuario.consentimentos, transcricoes: prontuario.transcricoes }), [patientId, prontuario])
  const data = i18n.date(atendimento.iniciadoEm, FORMATO_DATA_ATENDIMENTO)

  // Stryker disable next-line ArrayDeclaration: equivalent, a callback with no dependencies keeps one identity either way.
  const receberPendencias = useCallback((emCurso: boolean) => { setPendente(emCurso); if (emCurso) setPropostaReferencia(null) }, [])
  // Stryker disable next-line ArrayDeclaration: equivalent, a callback with no dependencies keeps one identity either way.
  const descartarProposta = useCallback(() => setPropostaReferencia(null), [])
  const atualizarProntuario = useCallback(() => { setFalhaRecarga(false); recarregar().catch(() => setFalhaRecarga(true)) }, [recarregar])
  const irParaAba = useCallback((destino: AbaDoAtendimento) => navigate({
    to: '/pacientes/$patientId/sessoes/$atendimentoId', params: { patientId, atendimentoId }, search: { aba: destino },
  }), [navigate, patientId, atendimentoId])
  const proporReferencia = useCallback((proposta: PropostaReferencia) => { setPropostaReferencia(proposta); void irParaAba(ABA_NOTA) }, [irParaAba])
  const abrirTranscricao = useCallback(() => void irParaAba(ABA_INSIGHTS), [irParaAba])
  const registrarCaptura = useCallback((parar: () => Promise<void>) => { pararCaptura.current = parar }, [])
  const registrarNota = useCallback((salvar: () => Promise<void>) => { salvarNota.current = salvar }, [])

  async function encerrar() {
    setFinalizando(true); setAvisoEncerramento(null)
    try {
      if (pendente) {
        await pararCaptura.current?.()
        await irParaAba(ABA_INSIGHTS)
        setAvisoEncerramento(msg`Captura encerrada. Confira e salve a transcrição antes de encerrar a sessão.`)
        return
      }
      await salvarNota.current!()
      await encerrarAtendimento(baseUrl, accountId, accessToken, patientId, atendimentoId, prontuario.dek)
      await recarregar()
      setEncerrada(true)
      setAvisoEncerramento(msg`Sessão encerrada. Os registros estão salvos. A nota permanece disponível para revisão e assinatura.`)
    } catch (erro) {
      setAvisoEncerramento(erro instanceof Error ? erro.message : msg`Não foi possível encerrar a sessão. Tente novamente.`)
    } finally { setFinalizando(false) }
  }

  useBloquearNavegacao(pendente)
  useBlocker({
    shouldBlockFn: ({ current, next }) => current.pathname !== next.pathname && !window.confirm(t`Há uma gravação ou alterações sem salvar. Sair agora as descarta. Deseja sair?`),
    disabled: !pendente,
    enableBeforeUnload: false,
  })

  // Stryker disable next-line ArrayDeclaration: equivalent, any constant dependency list runs the effect once.
  useEffect(() => { tituloRef.current!.focus() }, [])

  return <main id="app-shell" className="workspace">
    <header>
      <nav aria-label={t`Você está em`}>
        <ol className="flex list-none flex-wrap items-center gap-2 p-0">
          <li><Link to="/pacientes"><Trans>Pacientes</Trans></Link></li>
          <li><Link to="/pacientes/$patientId" params={{ patientId }}>{prontuario.nome}</Link></li>
          <li aria-current="page"><Trans>Sessão de {data}</Trans></li>
        </ol>
      </nav>
      <h1 ref={tituloRef} tabIndex={-1}><Trans>Sessão de {data}</Trans></h1>
      <EstadoDoAtendimento atendimentoId={atendimentoId} />
      <div className="my-4 flex flex-wrap gap-3">
        {!encerrada && <button type="button" className="button-primary" disabled={finalizando || preparando || (tipoSessao === 'online' && pendente)} onClick={() => void encerrar()}><Trans>Encerrar sessão</Trans></button>}
        {encerrada && <p role="status"><Trans>Sessão encerrada</Trans></p>}
      </div>
      {avisoEncerramento !== null && <p role="status">{traduzir(i18n, avisoEncerramento)}</p>}
    </header>
    <nav aria-label={t`Seções da sessão`} className="flex gap-4">
      <Link to="/pacientes/$patientId/sessoes/$atendimentoId" params={{ patientId, atendimentoId }} search={{ aba: ABA_INSIGHTS }} aria-current={paginaAtual(aba === ABA_INSIGHTS)}><Trans>Insights</Trans></Link>
      <Link to="/pacientes/$patientId/sessoes/$atendimentoId" params={{ patientId, atendimentoId }} search={{ aba: ABA_NOTA }} aria-current={paginaAtual(aba === ABA_NOTA)}><Trans>Nota</Trans></Link>
    </nav>
    {falhaRecarga && <p role="alert"><Trans>Não foi possível atualizar o prontuário. Recarregue a página.</Trans></p>}
    <div hidden={aba !== ABA_INSIGHTS}>
      <section className="workspace-card" aria-label={t`Consentimento e tipo de sessão`}>
        <ConsentimentoPaciente baseUrl={baseUrl} accountId={accountId} accessToken={accessToken} patientId={patientId} />
        {!abriuComTranscricao && !encerrada && <>
          <label htmlFor={tipoSessaoId}><Trans>Tipo de sessão</Trans></label><select id={tipoSessaoId} disabled={pendente} value={tipoSessao} onChange={event => setTipoSessao(event.target.value as 'presencial' | 'online')}>
            <option value="presencial"><Trans>Presencial, com microfone compartilhado</Trans></option>
            <option value="online"><Trans>Online, com conexão do paciente</Trans></option>
          </select>
        </>}
      </section>
      {tipoSessao === 'online' && !abriuComTranscricao
        ? <OnlineSession baseUrl={baseUrl} accountId={accountId} accessToken={accessToken} patientId={patientId} kek={kek} paciente={paciente} atendimentoId={atendimentoId} transcricao={transcricao}
          onPendingChange={receberPendencias} onSaved={atualizarProntuario} onPropostaReferencia={proporReferencia} atendimentoEncerrado={encerrada} bloqueada={finalizando} />
        : <SessionReview baseUrl={baseUrl} accessToken={accessToken} accountId={accountId} kek={kek} paciente={paciente} atendimentoId={atendimentoId} transcricao={transcricao}
          onPendingChange={receberPendencias} onSaved={atualizarProntuario} onPropostaReferencia={proporReferencia}
          prepararEncerramento={registrarCaptura} encerrada={encerrada} bloqueada={finalizando} onPreparingChange={setPreparando} />}
    </div>
    <div hidden={aba !== ABA_NOTA}>
      <NotaDoAtendimento baseUrl={baseUrl} accountId={accountId} accessToken={accessToken} patientId={patientId} atendimentoId={atendimentoId} dek={prontuario.dek}
        nota={prontuario.notas.find(nota => nota.atendimentoId === atendimentoId)} transcricoes={transcricoes} analiseAutorizada={prontuario.consentimentos.analiseIa === 'concedido'}
        ativa={aba === ABA_NOTA} propostaReferencia={propostaReferencia} onDescartarProposta={descartarProposta} onAbrirTranscricao={abrirTranscricao} onSaved={atualizarProntuario}
        prepararSalvamento={registrarNota} bloqueada={finalizando} />
    </div>
  </main>
}
