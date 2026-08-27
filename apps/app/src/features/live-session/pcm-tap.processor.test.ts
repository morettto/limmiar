import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHUNK_FRAMES, attachRing, available, createRingSab } from '@limmiar/audio'

type ProcessorCtor = new (options: { processorOptions: { sab: SharedArrayBuffer } }) => {
  process(inputs: Float32Array[][]): boolean
}

// `PcmTap` extends the global `AudioWorkletProcessor` and self-registers via
// `registerProcessor` at module-eval time — both globals are stubbed before
// a fresh import (precedente `worker-client.test.ts:57-71`), and the stub of
// `registerProcessor` captures the constructor the module hands it.
async function carregarPcmTap(): Promise<{ ctor: ProcessorCtor; nomeRegistado: string | undefined }> {
  let ctor: ProcessorCtor | undefined
  let nomeRegistado: string | undefined
  vi.stubGlobal('AudioWorkletProcessor', class {})
  vi.stubGlobal('registerProcessor', (nome: string, klass: unknown) => {
    nomeRegistado = nome
    ctor = klass as ProcessorCtor
  })
  vi.resetModules()
  await import('./pcm-tap.processor.ts')
  if (!ctor) throw new Error('registerProcessor não foi chamado')
  return { ctor, nomeRegistado }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pcm-tap.processor', () => {
  it('regista-se como "pcm-tap"', async () => {
    const { nomeRegistado } = await carregarPcmTap()
    expect(nomeRegistado).toBe('pcm-tap')
  })

  it('acumula 40 quanta de 128 frames e empurra no ring quando o bloco não é silêncio', async () => {
    const { ctor: PcmTap } = await carregarPcmTap()
    const sab = createRingSab(65536)
    const ring = attachRing(sab)
    const tap = new PcmTap({ processorOptions: { sab } })

    const quantumAlto = new Float32Array(128).fill(0.5) // acima do threshold de silêncio
    for (let i = 0; i < 40; i++) {
      expect(tap.process([[quantumAlto]])).toBe(true)
    }

    expect(available(ring)).toBe(CHUNK_FRAMES)
  })

  it('bloco silencioso é descartado pelo gate — nada é empurrado no ring', async () => {
    const { ctor: PcmTap } = await carregarPcmTap()
    const sab = createRingSab(65536)
    const ring = attachRing(sab)
    const tap = new PcmTap({ processorOptions: { sab } })

    const quantumSilencioso = new Float32Array(128) // zeros
    for (let i = 0; i < 40; i++) {
      tap.process([[quantumSilencioso]])
    }

    expect(available(ring)).toBe(0)
  })

  it('inputs ausente (sem faixa ligada) devolve true sem escrever', async () => {
    const { ctor: PcmTap } = await carregarPcmTap()
    const sab = createRingSab(65536)
    const ring = attachRing(sab)
    const tap = new PcmTap({ processorOptions: { sab } })

    expect(tap.process([])).toBe(true)

    expect(available(ring)).toBe(0)
  })
})
