import { afterEach, describe, expect, it, vi } from 'vitest'

type Processor = { port: { onmessage(): void }; process(inputs: Float32Array[][]): boolean }
async function carregar(taxa?: number) {
  const enviar = vi.fn()
  let Ctor!: new () => Processor
  vi.stubGlobal('AudioWorkletProcessor', class { port = { postMessage: enviar } })
  vi.stubGlobal('registerProcessor', (nome: string, ctor: typeof Ctor) => { expect(nome).toBe('realtime-pcm'); Ctor = ctor })
  if (taxa !== undefined) vi.stubGlobal('sampleRate', taxa)
  vi.resetModules()
  await import('./realtime-pcm.processor')
  return { processor: new Ctor(), enviar }
}
afterEach(() => vi.unstubAllGlobals())
describe('PCM ao vivo', () => {
  it('reduz 48 kHz e 44,1 kHz para 16 kHz pela média por área, sem perder o ritmo', async () => {
    const { processor, enviar } = await carregar(48000)
    const bloco = new Float32Array(3 * 1280)
    for (let i = 0; i < bloco.length; i++) bloco[i] = i % 3 === 0 ? 0.3 : i % 3 === 1 ? 0.6 : 0.9
    for (let i = 0; i < bloco.length; i += 128) processor.process([[bloco.subarray(i, Math.min(i + 128, bloco.length))]])
    expect(enviar.mock.calls[0]![0].pcm).toHaveLength(1280)
    expect(enviar.mock.calls[0]![0].pcm[0]).toBeCloseTo(0.6, 5)
    vi.unstubAllGlobals()
    const quebrado = await carregar(44100)
    const entrada = new Float32Array(44100).fill(0.5)
    for (let i = 0; i < entrada.length; i += 128) quebrado.processor.process([[entrada.subarray(i, Math.min(i + 128, entrada.length))]])
    quebrado.processor.port.onmessage()
    const total = quebrado.enviar.mock.calls.filter(([m]) => m.pcm).reduce((soma, [m]) => soma + m.pcm.length, 0)
    expect(total).toBe(16000)
  })
  it('preserva silêncio, ordem e as amostras finais antes da confirmação de drenagem', async () => {
    const { processor, enviar } = await carregar()
    processor.process([[new Float32Array(1279)]])
    expect(enviar).not.toHaveBeenCalled()
    processor.process([[new Float32Array([0.75, -0.5, 0.25])]])
    expect(enviar.mock.calls[0]![0].pcm).toHaveLength(1280)
    expect(enviar.mock.calls[0]![0].pcm[1279]).toBe(0.75)
    expect(enviar.mock.calls[0]![1]).toEqual([enviar.mock.calls[0]![0].pcm.buffer])
    processor.port.onmessage()
    expect(enviar.mock.calls[1]![0].pcm).toEqual(new Float32Array([-0.5, 0.25]))
    expect(enviar.mock.calls[2]![0]).toEqual({ type: 'drained' })
    expect(processor.process([[new Float32Array([1])]])).toBe(false)
  })
  it('não inventa amostras ao finalizar um bloco completo e mantém o relógio quando falta um canal', async () => {
    const { processor, enviar } = await carregar()
    for (let i = 0; i < 10; i++) expect(processor.process([])).toBe(true)
    expect(enviar.mock.calls[0]![0].pcm).toEqual(new Float32Array(1280))
    processor.port.onmessage()
    expect(enviar).toHaveBeenCalledTimes(2)
  })
})
