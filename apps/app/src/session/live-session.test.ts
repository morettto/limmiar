import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeEngine } from '@limmiar/audio'
import type { AsrLoopStats, RunAsrLoopOptions, TranscriptionEngine, TranscriptionSegment } from '@limmiar/audio'
import type { SessaoEvento } from '@limmiar/session'
import { criarSegmentStore } from './segment-store'
import { ligarSessao, type DispositivoGpu, type LigarSessaoOpcoes } from './live-session'
import type { WriteSealed } from './chunk-store'

const runAsrLoopMock = vi.fn<(opts: RunAsrLoopOptions) => Promise<AsrLoopStats>>()

vi.mock('@limmiar/audio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@limmiar/audio')>()
  return {
    ...actual,
    runAsrLoop: (opts: RunAsrLoopOptions) => runAsrLoopMock(opts),
  }
})

const SESSION_ID = 'sessao-1'

class FakeMediaRecorder extends EventTarget {
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  start = vi.fn(() => {
    this.state = 'recording'
  })
  pause = vi.fn(() => {
    this.state = 'paused'
  })
  resume = vi.fn(() => {
    this.state = 'recording'
  })
  stop = vi.fn(() => {
    this.state = 'inactive'
    this.dispatchEvent(new Event('stop'))
  })
}

let recorders: FakeMediaRecorder[] = []

function dispatchChunk(recorder: FakeMediaRecorder, data: Blob): void {
  const event = new Event('dataavailable') as Event & { data: Blob }
  event.data = data
  recorder.dispatchEvent(event)
}

function criarFaixa(): MediaStreamTrack & EventTarget {
  const target = new EventTarget()
  return Object.assign(target, { stop: vi.fn() }) as unknown as MediaStreamTrack & EventTarget
}

function criarStreamFalso(tracks: (MediaStreamTrack & EventTarget)[] = [criarFaixa()]): MediaStream {
  return { getTracks: () => tracks } as unknown as MediaStream
}

function writeOk(): { write: WriteSealed; chamadas: unknown[] } {
  const chamadas: unknown[] = []
  const write: WriteSealed = async (sessionId, seq, sealed) => {
    chamadas.push([sessionId, seq, sealed])
  }
  return { write, chamadas }
}

function writeQueFalha(): WriteSealed {
  return async () => {
    throw new Error('opfs indisponivel')
  }
}

function storageFalso(quota: number, usage: number): StorageManager {
  return { estimate: async () => ({ quota, usage }) } as unknown as StorageManager
}

async function realDek(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

function opcoesBase(overrides: Partial<LigarSessaoOpcoes> = {}): Promise<LigarSessaoOpcoes> {
  return realDek().then((dek) => ({
    stream: criarStreamFalso(),
    dek,
    sessionId: SESSION_ID,
    storage: storageFalso(1000, 0),
    write: writeOk().write,
    engine: fakeEngine(),
    segmentos: criarSegmentStore(),
    enviar: vi.fn(),
    ...overrides,
  }))
}

beforeEach(() => {
  recorders = []
  vi.stubGlobal(
    'MediaRecorder',
    vi.fn().mockImplementation(function FakeConstructor() {
      const recorder = new FakeMediaRecorder()
      recorders.push(recorder)
      return recorder
    }),
  )
  runAsrLoopMock.mockReset()
  runAsrLoopMock.mockImplementation(
    ({ signal }) =>
      new Promise<AsrLoopStats>((resolve) => {
        signal.addEventListener(
          'abort',
          () => resolve({ rtf: 0, droppedFrames: 0, windows: 0 }),
          { once: true },
        )
      }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ligarSessao — tomada A (MediaRecorder → OPFS)', () => {
  it('persiste um chunk e envia CHUNK_PERSISTIDO quando write() resolve', async () => {
    const { write, chamadas } = writeOk()
    const enviar = vi.fn()
    const opcoes = await opcoesBase({ write, enviar })

    ligarSessao(opcoes)
    dispatchChunk(recorders[0]!, new Blob([new Uint8Array([1, 2, 3])]))
    await vi.waitFor(() => expect(chamadas).toHaveLength(1))

    expect(enviar).toHaveBeenCalledWith({ type: 'CHUNK_PERSISTIDO' })
  })

  it('envia DISCO_CHEIO com bytesLivres = quota - usage quando write() rejeita', async () => {
    const enviar = vi.fn()
    const opcoes = await opcoesBase({
      write: writeQueFalha(),
      storage: storageFalso(1000, 400),
      enviar,
    })

    ligarSessao(opcoes)
    dispatchChunk(recorders[0]!, new Blob([new Uint8Array([9])]))

    await vi.waitFor(() =>
      expect(enviar).toHaveBeenCalledWith({ type: 'DISCO_CHEIO', bytesLivres: 600 }),
    )
  })

  it('trata quota/usage ausentes como 0 (bytesLivres = 0)', async () => {
    const enviar = vi.fn()
    const opcoes = await opcoesBase({
      write: writeQueFalha(),
      storage: { estimate: async () => ({}) } as unknown as StorageManager,
      enviar,
    })

    ligarSessao(opcoes)
    dispatchChunk(recorders[0]!, new Blob([new Uint8Array([9])]))

    await vi.waitFor(() =>
      expect(enviar).toHaveBeenCalledWith({ type: 'DISCO_CHEIO', bytesLivres: 0 }),
    )
  })

  it('write() e storage.estimate() rejeitam no mesmo chunk → DISCO_CHEIO com bytesLivres=0, e a fila continua para o chunk seguinte', async () => {
    const enviar = vi.fn()
    const write: WriteSealed = async (_sessionId, seq) => {
      if (seq === 0) throw new Error('opfs indisponivel')
    }
    const opcoes = await opcoesBase({
      write,
      storage: { estimate: async () => { throw new Error('estimate indisponivel') } } as unknown as StorageManager,
      enviar,
    })

    ligarSessao(opcoes)
    dispatchChunk(recorders[0]!, new Blob([new Uint8Array([1])])) // seq 0: write e estimate falham
    dispatchChunk(recorders[0]!, new Blob([new Uint8Array([2])])) // seq 1: write ok

    await vi.waitFor(() =>
      expect(enviar).toHaveBeenCalledWith({ type: 'DISCO_CHEIO', bytesLivres: 0 }),
    )
    await vi.waitFor(() => expect(enviar).toHaveBeenCalledWith({ type: 'CHUNK_PERSISTIDO' }))
  })

  it('preserva a ordem de seq mesmo com writes concorrentes (fila encadeada)', async () => {
    const chamadas: number[] = []
    const write: WriteSealed = async (_sessionId, seq) => {
      // O segundo write "atrasa" mais que o primeiro — sem fila, chegaria fora de ordem.
      await new Promise((resolve) => setTimeout(resolve, seq === 0 ? 10 : 0))
      chamadas.push(seq)
    }
    const opcoes = await opcoesBase({ write })

    ligarSessao(opcoes)
    dispatchChunk(recorders[0]!, new Blob([new Uint8Array([1])]))
    dispatchChunk(recorders[0]!, new Blob([new Uint8Array([2])]))

    await vi.waitFor(() => expect(chamadas).toHaveLength(2))
    expect(chamadas).toEqual([0, 1])
  })
})

describe('ligarSessao — sentinelas', () => {
  it('track "ended" → MICROFONE_REVOGADO', async () => {
    const faixa = criarFaixa()
    const enviar = vi.fn()
    const opcoes = await opcoesBase({ stream: criarStreamFalso([faixa]), enviar })

    ligarSessao(opcoes)
    faixa.dispatchEvent(new Event('ended'))

    expect(enviar).toHaveBeenCalledWith({ type: 'MICROFONE_REVOGADO' })
  })

  it('gpu.lost resolve → GPU_PERDIDA', async () => {
    const enviar = vi.fn()
    const gpu: DispositivoGpu = { lost: Promise.resolve() }
    const opcoes = await opcoesBase({ gpu, enviar })

    ligarSessao(opcoes)

    await vi.waitFor(() => expect(enviar).toHaveBeenCalledWith({ type: 'GPU_PERDIDA' }))
  })

  it('sem gpu (undefined) → nunca envia GPU_PERDIDA por essa via', async () => {
    const enviar = vi.fn()
    const opcoes = await opcoesBase({ enviar })

    ligarSessao(opcoes)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(enviar).not.toHaveBeenCalledWith({ type: 'GPU_PERDIDA' })
  })

  it('engine.warmup() resolve → MODELO_PRONTO', async () => {
    const enviar = vi.fn()
    const opcoes = await opcoesBase({ engine: fakeEngine(), enviar })

    ligarSessao(opcoes)

    await vi.waitFor(() => expect(enviar).toHaveBeenCalledWith({ type: 'MODELO_PRONTO' }))
  })

  it('engine.warmup() rejeita → GPU_PERDIDA', async () => {
    const enviar = vi.fn()
    const engine: TranscriptionEngine = {
      warmup: async () => {
        throw new Error('sem GPU')
      },
      transcribe: async () => [],
      close: async () => {},
    }
    const opcoes = await opcoesBase({ engine, enviar })

    ligarSessao(opcoes)

    await vi.waitFor(() => expect(enviar).toHaveBeenCalledWith({ type: 'GPU_PERDIDA' }))
  })

  it('window "offline" → REDE_CAIU', async () => {
    const enviar = vi.fn()
    const opcoes = await opcoesBase({ enviar })

    ligarSessao(opcoes)
    window.dispatchEvent(new Event('offline'))

    expect(enviar).toHaveBeenCalledWith({ type: 'REDE_CAIU' })
  })

  it('window "online" → REDE_VOLTOU', async () => {
    const enviar = vi.fn()
    const opcoes = await opcoesBase({ enviar })

    ligarSessao(opcoes)
    window.dispatchEvent(new Event('online'))

    expect(enviar).toHaveBeenCalledWith({ type: 'REDE_VOLTOU' })
  })

  it('document "visibilitychange" com document.hidden → DISPOSITIVO_SUSPENSO', async () => {
    const enviar = vi.fn()
    const opcoes = await opcoesBase({ enviar })
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)

    ligarSessao(opcoes)
    document.dispatchEvent(new Event('visibilitychange'))

    expect(enviar).toHaveBeenCalledWith({ type: 'DISPOSITIVO_SUSPENSO' })
  })

  it('document "visibilitychange" com document.hidden=false → nada', async () => {
    const enviar = vi.fn()
    const opcoes = await opcoesBase({ enviar })
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)

    ligarSessao(opcoes)
    document.dispatchEvent(new Event('visibilitychange'))

    expect(enviar).not.toHaveBeenCalledWith({ type: 'DISPOSITIVO_SUSPENSO' })
  })
})

describe('ligarSessao — controller', () => {
  it('pausar() chama recorder.pause() e envia PAUSAR', async () => {
    const enviar = vi.fn()
    const opcoes = await opcoesBase({ enviar })

    const controller = ligarSessao(opcoes)
    controller.pausar()

    expect(recorders[0]!.pause).toHaveBeenCalledOnce()
    expect(enviar).toHaveBeenCalledWith({ type: 'PAUSAR' })
  })

  it('retomar() chama recorder.resume() e envia RETOMAR', async () => {
    const enviar = vi.fn()
    const opcoes = await opcoesBase({ enviar })

    const controller = ligarSessao(opcoes)
    controller.retomar()

    expect(recorders[0]!.resume).toHaveBeenCalledOnce()
    expect(enviar).toHaveBeenCalledWith({ type: 'RETOMAR' })
  })

  it('encerrar() envia ENCERRAR, drena a fila, para o recorder e as faixas, e envia FILA_DRENADA', async () => {
    const enviar = vi.fn<(evento: SessaoEvento) => void>()
    const engine: TranscriptionEngine = { warmup: async () => {}, transcribe: async () => [], close: vi.fn(async () => {}) }
    const faixa = criarFaixa()
    const opcoes = await opcoesBase({ stream: criarStreamFalso([faixa]), engine, enviar })

    const controller = ligarSessao(opcoes)
    await controller.encerrar()

    const ordemTipos = enviar.mock.calls.map(([evento]) => evento.type)
    expect(ordemTipos.indexOf('ENCERRAR')).toBeLessThan(ordemTipos.indexOf('FILA_DRENADA'))
    expect(recorders[0]!.stop).toHaveBeenCalledOnce()
    expect(faixa.stop).toHaveBeenCalledOnce()
    expect(engine.close).toHaveBeenCalledOnce()
    expect(enviar).toHaveBeenCalledWith({ type: 'FILA_DRENADA' })
  })

  it('encerrar() é idempotente — segunda chamada não repete os efeitos', async () => {
    const enviar = vi.fn()
    const opcoes = await opcoesBase({ enviar })

    const controller = ligarSessao(opcoes)
    await controller.encerrar()
    const chamadasAntes = enviar.mock.calls.length
    await controller.encerrar()

    expect(recorders[0]!.stop).toHaveBeenCalledOnce()
    expect(enviar.mock.calls.length).toBe(chamadasAntes)
  })

  it('encerrar() remove o listener de "ended" antes de parar as faixas — sem MICROFONE_REVOGADO espúrio', async () => {
    const enviar = vi.fn()
    const faixa = criarFaixa()
    const opcoes = await opcoesBase({ stream: criarStreamFalso([faixa]), enviar })

    const controller = ligarSessao(opcoes)
    await controller.encerrar()
    enviar.mockClear()
    faixa.dispatchEvent(new Event('ended'))

    expect(enviar).not.toHaveBeenCalledWith({ type: 'MICROFONE_REVOGADO' })
  })

  it('runAsrLoop rejeita (falha da tomada B) → encerrar() ainda fecha o engine, larga o hardware e envia FILA_DRENADA', async () => {
    const enviar = vi.fn<(evento: SessaoEvento) => void>()
    const engine: TranscriptionEngine = { warmup: async () => {}, transcribe: async () => [], close: vi.fn(async () => {}) }
    const faixa = criarFaixa()
    runAsrLoopMock.mockImplementation(
      ({ signal }) =>
        new Promise<AsrLoopStats>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('motor caiu')), { once: true })
        }),
    )
    const opcoes = await opcoesBase({ stream: criarStreamFalso([faixa]), engine, enviar })

    const controller = ligarSessao(opcoes)
    await expect(controller.encerrar()).resolves.toBeUndefined()

    expect(engine.close).toHaveBeenCalledOnce()
    expect(faixa.stop).toHaveBeenCalledOnce()
    expect(enviar).toHaveBeenCalledWith({ type: 'FILA_DRENADA' })
  })

  it('encerrar() aguarda o último chunk (ondataavailable pós-stop) antes de drenar', async () => {
    const { write, chamadas } = writeOk()
    const enviar = vi.fn()
    const opcoes = await opcoesBase({ write, enviar })

    const controller = ligarSessao(opcoes)
    const recorder = recorders[0]!
    // Simula o comportamento real do MediaRecorder: o `stop()` dispara um
    // último "dataavailable" antes do evento "stop".
    recorder.stop.mockImplementationOnce(() => {
      dispatchChunk(recorder, new Blob([new Uint8Array([7])]))
      recorder.state = 'inactive'
      recorder.dispatchEvent(new Event('stop'))
    })

    await controller.encerrar()

    expect(chamadas).toHaveLength(1)
  })
})

describe('ligarSessao — asr-loop → segmentos', () => {
  it('onSegments do asr-loop chega à UI via segmentos.acrescentar (useSyncExternalStore)', async () => {
    const segmentos = criarSegmentStore()
    const aoMudar = vi.fn()
    segmentos.subscribe(aoMudar)
    const opcoes = await opcoesBase({ segmentos })

    ligarSessao(opcoes)
    await vi.waitFor(() => expect(runAsrLoopMock).toHaveBeenCalled())
    const chamada = runAsrLoopMock.mock.calls[0]![0]
    const segmentosFalsos: TranscriptionSegment[] = [{ startMs: 0, endMs: 100, text: 'oi' }]

    await chamada.onSegments(segmentosFalsos)

    expect(segmentos.getSnapshot()).toEqual(segmentosFalsos)
    expect(aoMudar).toHaveBeenCalledOnce()
  })

  it('onStats do asr-loop é no-op nesta fatia', async () => {
    const opcoes = await opcoesBase()

    ligarSessao(opcoes)
    await vi.waitFor(() => expect(runAsrLoopMock).toHaveBeenCalled())
    const chamada = runAsrLoopMock.mock.calls[0]![0]

    expect(chamada.onStats({ rtf: 0.5, droppedFrames: 0, windows: 1 })).toBeUndefined()
  })

  it('passa engine e signal recebidos a runAsrLoop, e aborta o signal ao encerrar', async () => {
    const engine = fakeEngine()
    const opcoes = await opcoesBase({ engine })

    const controller = ligarSessao(opcoes)
    await vi.waitFor(() => expect(runAsrLoopMock).toHaveBeenCalled())
    const chamada = runAsrLoopMock.mock.calls[0]![0]
    expect(chamada.engine).toBe(engine)
    expect(chamada.signal.aborted).toBe(false)

    await controller.encerrar()

    expect(chamada.signal.aborted).toBe(true)
  })
})
