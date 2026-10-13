import { useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { abrirMicrofone } from '../../entities/consentimento/microfone'
import { conectarChamada, type ChamadaOnline, type EstadoChamada, type PapelChamada } from './chamada'

export interface OnlineCallProps {
  baseUrl: string
  roomId: string
  token: string
  papel: PapelChamada
  onStreams?(local: MediaStream, remoto: MediaStream): void
  onState?(state: EstadoChamada): void
  antesDeEncerrar?(): Promise<void>
}

export function OnlineCall({ baseUrl, roomId, token, papel, onStreams, onState, antesDeEncerrar }: OnlineCallProps) {
  const { t } = useLingui()
  const [estado, setEstado] = useState<EstadoChamada | null>(null)
  const [autorizada, setAutorizada] = useState(false)
  const [mudo, setMudo] = useState(false)
  const [erro, setErro] = useState(false)
  const [finalizando, setFinalizando] = useState(false)
  const [remoto, setRemoto] = useState<MediaStream | null>(null)
  const abort = useRef<AbortController | null>(null)
  const chamada = useRef<ChamadaOnline | null>(null)
  const local = useRef<MediaStream | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  // Stryker disable next-line BooleanLiteral: equivalent, the effect below sets the flag before any async work.
  const montado = useRef(true)

  // Stryker disable ArrayDeclaration: equivalent, any constant dependency list runs the effect once.
  useEffect(() => {
    montado.current = true
    return () => { montado.current = false; chamada.current?.sair(); abort.current?.abort() }
  }, [])
  // Stryker restore ArrayDeclaration
  useEffect(() => {
    if (!autorizada && estado !== null && estado !== 'encerrada') {
      // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal state key; displayed status is translated.
      chamada.current?.encerrar(); abort.current!.abort(); setEstado('encerrada')
    }
  }, [autorizada, estado])
  useEffect(() => {
    const player = audio.current!
    player.srcObject = remoto
    if (remoto) void player.play().catch(() => {})
    return () => { player.srcObject = null }
  }, [remoto])
  useEffect(() => {
    if (estado !== null) onState?.(estado)
    if (estado === 'conectada' && local.current && remoto) onStreams?.(local.current, remoto)
  }, [estado, remoto, onStreams, onState])

  async function entrar() {
    const controller = new AbortController()
    abort.current?.abort(); abort.current = controller
    chamada.current = null
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal state key; displayed status is translated.
    setEstado('conectando'); setErro(false); setMudo(false); setRemoto(null)
    try {
      // eslint-disable-next-line lingui/no-unlocalized-strings -- Explicit consent token for the microphone port.
      const result = await abrirMicrofone('concedido')
      // Stryker disable next-line ConditionalExpression,StringLiteral: equivalent, `result.microfone` off a refusal throws into the same catch.
      if (!result.ok) throw new Error('Microphone permission required')
      if (controller.signal.aborted) { result.microfone.stream.getTracks().forEach(track => track.stop()); return }
      local.current = result.microfone.stream
      chamada.current = await conectarChamada({ baseUrl, roomId, token, papel, stream: result.microfone.stream, signal: controller.signal,
        estado: state => { if (!controller.signal.aborted) setEstado(state) },
        receber: stream => { if (!controller.signal.aborted) setRemoto(stream) },
        falhar: () => { if (!controller.signal.aborted) setErro(true) },
      })
    } catch {
      resultCleanup()
      // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal state key; displayed status is translated.
      if (!controller.signal.aborted) { setErro(true); setEstado('interrompida') }
    }
  }
  function resultCleanup() { local.current?.getTracks().forEach(track => track.stop()) }
  async function encerrar() {
    setFinalizando(true)
    try { await antesDeEncerrar?.() }
    catch { setErro(true) }
    finally {
      chamada.current?.encerrar(); abort.current!.abort()
      // eslint-disable-next-line lingui/no-unlocalized-strings -- Internal state key; displayed status is translated.
      setEstado('encerrada'); setRemoto(null)
    }
  }
  async function reconectar() {
    setErro(false)
    // Stryker disable next-line ConditionalExpression,BlockStatement: equivalent, `reconectar` off a null call throws into the catch that also re-enters.
    if (!chamada.current) { await entrar(); return }
    try { await chamada.current.reconectar() }
    catch { if (montado.current) await entrar() }
  }
  const mensagens: Record<EstadoChamada, string> = {
    conectando: t`Conectando a sessão online...`, aguardando: t`Aguardando o outro participante.`, conectada: t`Sessão online conectada.`,
    interrompida: t`Conexão interrompida. Tente reconectar.`, encerrada: t`Sessão online encerrada.`,
  }
  return <section className="workspace-card" aria-label={t`Chamada online`}>
    <h2><Trans>Sessão online</Trans></h2>
    <p><Trans>O áudio usa conexão cifrada e não é salvo. Você pode desligar o microfone ou encerrar a qualquer momento.</Trans></p>
    <label><input type="checkbox" checked={autorizada} disabled={estado === 'encerrada'} onChange={event => setAutorizada(event.target.checked)} />
      <Trans>Autorizo o uso do microfone e a transcrição nesta sessão online. O áudio segue ao servidor de transcrição, só em memória, e não é gravado.</Trans></label>
    {estado === null && <button type="button" className="button-primary" disabled={!autorizada} onClick={() => void entrar()}><Trans>Entrar na sessão online</Trans></button>}
    {estado !== null && <p role="status">{mensagens[estado]}</p>}
    {erro && <p role="alert"><Trans>Não foi possível conectar. Confira o convite, permita o microfone e tente novamente.</Trans></p>}
    {estado === 'interrompida' && <button type="button" disabled={!autorizada || finalizando} onClick={() => void reconectar()}><Trans>Reconectar sessão online</Trans></button>}
    {(estado === 'conectada' || estado === 'aguardando') && <button type="button" aria-pressed={mudo} onClick={() => {
      chamada.current!.silenciar(!mudo); setMudo(!mudo)
    }}>{mudo ? <Trans>Ligar meu microfone</Trans> : <Trans>Desligar meu microfone</Trans>}</button>}
    {estado !== null && estado !== 'encerrada' && <button type="button" disabled={finalizando} onClick={() => void encerrar()}><Trans>Encerrar sessão online</Trans></button>}
    {mudo && <p><Trans>Seu microfone está desligado.</Trans></p>}
    <audio ref={audio} autoPlay controls aria-label={t`Áudio do outro participante`} />
  </section>
}
