import { attachRing, createRingSab, runAsrLoop } from '@limmiar/audio'
import type { TranscriptionEngine } from '@limmiar/audio'
import type { CryptoKey } from '@limmiar/crypto'
import type { SessaoEvento } from '@limmiar/session'
import { persistChunk } from './chunk-store'
import type { WriteSealed } from './chunk-store'
import { ligarTap } from './pcm-tap'
import type { SegmentStore } from './segment-store'

/** Só o que `live-session` usa de um `GPUDevice` — evita @webgpu/types (não instalado)
 *  e torna o duplo de teste um objeto de uma propriedade. */
export interface DispositivoGpu {
  readonly lost: Promise<unknown>
}

export interface LigarSessaoOpcoes {
  stream: MediaStream
  dek: CryptoKey
  sessionId: string
  gpu?: DispositivoGpu
  storage: StorageManager
  write: WriteSealed
  engine: TranscriptionEngine
  segmentos: SegmentStore
  enviar: (evento: SessaoEvento) => void
  timesliceMs?: number
}

export interface SessaoAoVivo {
  pausar(): void
  retomar(): void
  /** Idempotente. Envia ENCERRAR, drena, envia FILA_DRENADA, larga o hardware. */
  encerrar(): Promise<void>
}

const DEFAULT_TIMESLICE_MS = 5000

// Capacidade do ring best-effort (tomada B): potência de 2, >= janela padrão de
// runAsrLoop (5 * CHUNK_FRAMES = 25600 frames, ~1.6s @16kHz), com folga para
// pushes chegarem antes do próximo pull. 65536 frames ~= 4.1s de margem.
const RING_CAPACITY_FRAMES = 65536

/** Único adapter mundo-real→`SessaoEvento` da captura ao vivo. */
export function ligarSessao(opcoes: LigarSessaoOpcoes): SessaoAoVivo {
  const {
    stream,
    dek,
    sessionId,
    gpu,
    storage,
    write,
    engine,
    segmentos,
    enviar,
    timesliceMs = DEFAULT_TIMESLICE_MS,
  } = opcoes

  const tracks = stream.getTracks()
  const abort = new AbortController()
  const ring = attachRing(createRingSab(RING_CAPACITY_FRAMES))
  // Falha do tap não derruba a sessão (decisão 10 do desenho da fatia 4): um
  // desligar no-op mantém a invariante da tomada B ("best-effort, pode
  // dropar") mesmo quando o browser não tem AudioWorklet/SAB.
  const desligarTap = ligarTap(stream, ring).catch(() => () => {})

  let seq = 0
  // Fila de escrita encadeada (decisão 13): garante ordem de `seq` e que a
  // tomada A nunca perde um chunk, mesmo com writes concorrentes.
  let fila: Promise<void> = Promise.resolve()
  let encerrando: Promise<void> | undefined

  const recorder = new MediaRecorder(stream)

  function onDataAvailable(event: BlobEvent): void {
    const blob = event.data
    const currentSeq = seq++
    // A cadeia nunca pode rejeitar: uma rejeição envenenaria `fila` para
    // sempre e todo chunk futuro seria descartado em silêncio, quebrando o
    // invariante "tomada A nunca perde". Por isso o catch de fallback (falha
    // de storage.estimate()) também está protegido.
    fila = fila.then(async () => {
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        await persistChunk(write, dek, sessionId, currentSeq, bytes)
        enviar({ type: 'CHUNK_PERSISTIDO' })
      } catch {
        try {
          const { quota, usage } = await storage.estimate()
          enviar({ type: 'DISCO_CHEIO', bytesLivres: (quota ?? 0) - (usage ?? 0) })
        } catch {
          enviar({ type: 'DISCO_CHEIO', bytesLivres: 0 })
        }
      }
    })
  }
  recorder.addEventListener('dataavailable', onDataAvailable)
  recorder.start(timesliceMs)

  function onTrackEnded(): void {
    enviar({ type: 'MICROFONE_REVOGADO' })
  }
  tracks.forEach((track) => track.addEventListener('ended', onTrackEnded))

  gpu?.lost.then(() => enviar({ type: 'GPU_PERDIDA' }))

  engine.warmup().then(
    () => enviar({ type: 'MODELO_PRONTO' }),
    () => enviar({ type: 'GPU_PERDIDA' }),
  )

  const asrLoopDone = runAsrLoop({
    ring,
    engine,
    signal: abort.signal,
    onSegments: (segments) => {
      segmentos.acrescentar(segments)
    },
    // ponytail: stats descartadas; ligar a indicador de "ASR atrasado" quando a UI o pedir
    onStats: () => {},
  })

  function onOffline(): void {
    enviar({ type: 'REDE_CAIU' })
  }
  function onOnline(): void {
    enviar({ type: 'REDE_VOLTOU' })
  }
  function onVisibilityChange(): void {
    if (document.hidden) enviar({ type: 'DISPOSITIVO_SUSPENSO' })
  }
  window.addEventListener('offline', onOffline)
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisibilityChange)

  return {
    pausar() {
      recorder.pause()
      enviar({ type: 'PAUSAR' })
    },
    retomar() {
      recorder.resume()
      enviar({ type: 'RETOMAR' })
    },
    async encerrar() {
      if (encerrando) return encerrando

      encerrando = (async () => {
        enviar({ type: 'ENCERRAR' })

        // Decisão 10: listeners de 'ended' saem antes do stop() das faixas,
        // para não disparar MICROFONE_REVOGADO espúrio no encerramento normal.
        // Listener de 'dataavailable' fica ativo até depois de drenar para processar último chunk.
        tracks.forEach((track) => track.removeEventListener('ended', onTrackEnded))
        window.removeEventListener('offline', onOffline)
        window.removeEventListener('online', onOnline)
        document.removeEventListener('visibilitychange', onVisibilityChange)

        const parado = new Promise<void>((resolve) => {
          recorder.addEventListener('stop', () => resolve(), { once: true })
        })
        recorder.stop()
        await parado
        await fila
        recorder.removeEventListener('dataavailable', onDataAvailable)

        abort.abort()
        try {
          // Tomada B é best-effort ("pode dropar") — uma falha do motor de ASR
          // não pode impedir o resto do encerramento (fecho do engine, largar
          // o hardware, FILA_DRENADA da tomada A, que é autoritativa).
          await asrLoopDone
        } catch {
          // engolida deliberadamente: sem SessaoEvento para falha de ASR na
          // tabela de mapeamento (decisão de desenho), e o microfone precisa
          // fechar mesmo assim.
        }
        await engine.close()

        const desligar = await desligarTap
        desligar()
        tracks.forEach((track) => track.stop())

        enviar({ type: 'FILA_DRENADA' })
      })()

      return encerrando
    },
  }
}
