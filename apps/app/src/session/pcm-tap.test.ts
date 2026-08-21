import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachRing, createRingSab } from '@limmiar/audio'
import { ligarTap } from './pcm-tap'

// Evita depender da resolução real de `?worker&url` no transform do vitest —
// só o valor do especificador (uma string de URL) importa a `ligarTap`.
vi.mock('./pcm-tap.processor.ts?worker&url', () => ({ default: 'blob:pcm-tap' }))

interface NoFalso {
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

function contextoFalso() {
  const addModule = vi.fn(async () => {})
  const resume = vi.fn(async () => {})
  const close = vi.fn(async () => {})
  const source: NoFalso = { connect: vi.fn(), disconnect: vi.fn() }
  const createMediaStreamSource = vi.fn(() => source)

  class AudioContextFalso {
    sampleRate: number
    audioWorklet = { addModule }
    resume = resume
    close = close
    createMediaStreamSource = createMediaStreamSource
    constructor(opcoes: { sampleRate: number }) {
      this.sampleRate = opcoes.sampleRate
    }
  }

  return { AudioContextFalso, addModule, resume, close, source, createMediaStreamSource }
}

function noDeWorkletFalso() {
  const node: NoFalso = { connect: vi.fn(), disconnect: vi.fn() }
  const chamadas: { ctx: unknown; nome: string; opcoes: Record<string, unknown> }[] = []

  class AudioWorkletNodeFalso {
    connect = node.connect
    disconnect = node.disconnect
    constructor(ctx: unknown, nome: string, opcoes: Record<string, unknown>) {
      chamadas.push({ ctx, nome, opcoes })
    }
  }

  return { AudioWorkletNodeFalso, node, chamadas }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ligarTap', () => {
  it('monta AudioContext@16k → source → AudioWorkletNode com o sab no processorOptions, sem ligar ao destination', async () => {
    const { AudioContextFalso, addModule, resume, source, createMediaStreamSource } = contextoFalso()
    const { AudioWorkletNodeFalso, chamadas } = noDeWorkletFalso()
    vi.stubGlobal('AudioContext', AudioContextFalso)
    vi.stubGlobal('AudioWorkletNode', AudioWorkletNodeFalso)
    const sab = createRingSab(8)
    const ring = attachRing(sab)
    const stream = {} as MediaStream

    await ligarTap(stream, ring)

    expect(addModule).toHaveBeenCalledWith('blob:pcm-tap')
    expect(resume).toHaveBeenCalledOnce()
    expect(createMediaStreamSource).toHaveBeenCalledWith(stream)
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0]!.nome).toBe('pcm-tap')
    expect(chamadas[0]!.opcoes).toMatchObject({
      processorOptions: { sab },
      channelCount: 1,
      channelCountMode: 'explicit',
      numberOfOutputs: 0,
    })
    expect(source.connect).toHaveBeenCalledOnce()
  })

  it('devolve um desligar que desconecta source e node e fecha o contexto', async () => {
    const { AudioContextFalso, close, source } = contextoFalso()
    const { AudioWorkletNodeFalso, node } = noDeWorkletFalso()
    vi.stubGlobal('AudioContext', AudioContextFalso)
    vi.stubGlobal('AudioWorkletNode', AudioWorkletNodeFalso)
    const ring = attachRing(createRingSab(8))

    const desligar = await ligarTap({} as MediaStream, ring)
    desligar()

    expect(source.disconnect).toHaveBeenCalledOnce()
    expect(node.disconnect).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it('rejeita quando o browser não tem AudioWorklet (addModule falha)', async () => {
    const { AudioContextFalso, addModule } = contextoFalso()
    addModule.mockRejectedValueOnce(new Error('sem AudioWorklet'))
    vi.stubGlobal('AudioContext', AudioContextFalso)
    const ring = attachRing(createRingSab(8))

    await expect(ligarTap({} as MediaStream, ring)).rejects.toThrow('sem AudioWorklet')
  })
})
