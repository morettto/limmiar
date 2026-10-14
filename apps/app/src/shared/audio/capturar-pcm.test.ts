import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { capturarPcm } from './capturar-pcm'
import { dynamicActivate } from '../i18n'

beforeAll(async () => dynamicActivate('pt-BR'))

const adicionar = vi.fn(async () => {})
const retomar = vi.fn(async () => {})
const fechar = vi.fn(async () => {})
const desconectar = vi.fn()
const conectar = vi.fn()
const enviar = vi.fn()
const construcoesNo: unknown[][] = []
let node: { port: { onmessage: (event: { data: object }) => void; postMessage: typeof enviar }; disconnect: typeof desconectar; onprocessorerror(): void }
let track: EventTarget & { stop: ReturnType<typeof vi.fn>; enabled: boolean }
let microfone: MediaStream
const receber = vi.fn()
const falhar = vi.fn()
beforeEach(async () => {
  construcoesNo.length = 0
  vi.stubGlobal('AudioContext', class {
    audioWorklet = { addModule: adicionar }
    resume = retomar
    close = fechar
    createMediaStreamSource = vi.fn(() => ({ connect: conectar, disconnect: desconectar }))
  })
  vi.stubGlobal('AudioWorkletNode', class {
    port = { postMessage: enviar, onmessage: () => {} }
    disconnect = desconectar
    onprocessorerror = () => {}
    constructor(...argumentos: unknown[]) { node = this; construcoesNo.push(argumentos) }
  })
  track = Object.assign(new EventTarget(), { stop: vi.fn(), enabled: true })
  microfone = { getTracks: () => [track], getAudioTracks: () => [{ getSettings: () => ({ sampleRate: 48000 }) }] } as unknown as MediaStream
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks() })
describe('capturar PCM', () => {
  it('abre o contexto na taxa do microfone e, sem taxa conhecida, na taxa padrão do aparelho', async () => {
    const criados: unknown[] = []
    vi.stubGlobal('AudioContext', class {
      audioWorklet = { addModule: adicionar }
      resume = retomar
      close = fechar
      createMediaStreamSource = vi.fn(() => ({ connect: conectar, disconnect: desconectar }))
      constructor(opcoes?: unknown) { criados.push(opcoes) }
    })
    const sinais = [new AbortController(), new AbortController(), new AbortController()]
    const semTaxa = { getTracks: () => [track], getAudioTracks: () => [{ getSettings: () => ({}) }] } as unknown as MediaStream
    const semTrilha = { getTracks: () => [track], getAudioTracks: () => [] } as unknown as MediaStream
    await capturarPcm(microfone, sinais[0]!.signal, receber, falhar, { trilhas: 'emprestadas' })
    await capturarPcm(semTaxa, sinais[1]!.signal, receber, falhar, { trilhas: 'emprestadas' })
    await capturarPcm(semTrilha, sinais[2]!.signal, receber, falhar, { trilhas: 'emprestadas' })
    expect(criados).toEqual([{ sampleRate: 48000 }, undefined, undefined])
    sinais.forEach((sinal) => sinal.abort())
  })
  it('libera o contexto emprestado sem parar a trilha e respeita seu estado de mute', async () => {
    const ended = vi.fn()
    const captura = await capturarPcm(microfone, new AbortController().signal, receber, falhar, { trilhas: 'emprestadas', aoEncerrarTrilha: ended })
    track.enabled = false
    node.port.onmessage({ data: { pcm: new Float32Array(128) } })
    expect(track.enabled).toBe(false)
    track.dispatchEvent(new Event('ended'))
    expect(ended).toHaveBeenCalledOnce(); expect(falhar).not.toHaveBeenCalled()
    captura.cancelar()
    expect(track.stop).not.toHaveBeenCalled()
    expect(fechar).toHaveBeenCalledOnce()
    track.dispatchEvent(new Event('ended'))
    expect(ended).toHaveBeenCalledOnce()
  })
  it('envia silêncio e cauda, pausa sem comprimir tempo e encerra de maneira idempotente', async () => {
    const captura = await capturarPcm(microfone, new AbortController().signal, receber, falhar, { trilhas: 'proprias' })
    node.port.onmessage({ data: { pcm: new Float32Array(128) } })
    expect(receber).toHaveBeenCalledWith(new Float32Array(128))
    node.port.onmessage({ data: { type: 'ignorado' } })
    node.port.onmessage({ data: { type: 'drained' } })
    captura.pausar(true); expect(track.enabled).toBe(false)
    captura.pausar(false); expect(track.enabled).toBe(true)
    const fim = captura.encerrar()
    expect(captura.encerrar()).toBe(fim)
    expect(enviar).toHaveBeenCalledWith({ type: 'stop' })
    node.port.onmessage({ data: { pcm: new Float32Array([0.5]) } })
    node.port.onmessage({ data: { type: 'drained' } })
    await fim
    captura.cancelar()
    node.port.onmessage({ data: { pcm: new Float32Array([1]) } })
    expect(receber).toHaveBeenCalledTimes(2)
    expect(fechar).toHaveBeenCalledOnce()
    expect(track.stop).toHaveBeenCalledOnce()
    track.dispatchEvent(new Event('ended'))
    expect(falhar).not.toHaveBeenCalled()
  })
  it('informa perda do microfone e falha da thread de áudio', async () => {
    const abort = new AbortController()
    await capturarPcm(microfone, abort.signal, receber, falhar, { trilhas: 'proprias' })
    node.onprocessorerror()
    track.dispatchEvent(new Event('ended'))
    expect(falhar).toHaveBeenCalledTimes(2)
    abort.abort()
    expect(track.stop).toHaveBeenCalledOnce()
  })
  it('fecha áudio e trilhas quando o worklet não confirma a cauda', async () => {
    vi.useFakeTimers()
    const captura = await capturarPcm(microfone, new AbortController().signal, receber, falhar, { trilhas: 'proprias' })
    const fim = captura.encerrar()
    const verifica = expect(fim).rejects.toThrow('não concluiu')
    await vi.advanceTimersByTimeAsync(5000)
    await verifica
    expect(track.stop).toHaveBeenCalledOnce()
  })
  it.each(['antes', 'modulo', 'retomar', 'rejeicao'])('libera recursos ao cancelar ou falhar em %s', async (etapa) => {
    const abort = new AbortController()
    if (etapa === 'antes') abort.abort()
    if (etapa === 'modulo') adicionar.mockImplementationOnce(async () => abort.abort())
    if (etapa === 'retomar') retomar.mockImplementationOnce(async () => abort.abort())
    if (etapa === 'rejeicao') adicionar.mockRejectedValueOnce(new Error('worklet indisponível'))
    const resultado = expect(capturarPcm(microfone, abort.signal, receber, falhar, { trilhas: 'proprias' }))
    if (etapa === 'rejeicao') await resultado.rejects.toThrow('worklet indisponível')
    else await resultado.rejects.toMatchObject({ name: 'AbortError', message: 'Cancelado' })
    expect(track.stop).toHaveBeenCalledOnce()
    expect(fechar).toHaveBeenCalledOnce()
    if (etapa === 'antes' || etapa === 'modulo') expect(retomar).not.toHaveBeenCalled()
    if (etapa !== 'rejeicao') expect(construcoesNo).toEqual([])
  })
  it('cria o nó de captura mono, sem saída, e deixa de ouvir o cancelamento ao fechar', async () => {
    const abort = new AbortController()
    const remover = vi.spyOn(abort.signal, 'removeEventListener')
    const captura = await capturarPcm(microfone, abort.signal, receber, falhar, { trilhas: 'proprias' })
    expect(construcoesNo).toEqual([[expect.anything(), 'realtime-pcm', { channelCount: 1, channelCountMode: 'explicit', numberOfOutputs: 0 }]])
    captura.cancelar()
    expect(remover).toHaveBeenCalledWith('abort', expect.any(Function))
  })
  it('só a confirmação de cauda termina o encerramento', async () => {
    const captura = await capturarPcm(microfone, new AbortController().signal, receber, falhar, { trilhas: 'proprias' })
    let terminou = false
    void captura.encerrar().then(() => { terminou = true })
    node.port.onmessage({ data: { type: 'ignorado' } })
    await Promise.resolve()
    expect(terminou).toBe(false)
    node.port.onmessage({ data: { type: 'drained' } })
    await vi.waitFor(() => expect(terminou).toBe(true))
  })
  it('cancela uma drenagem pendente sem deixar timeout ou áudio abertos', async () => {
    vi.useFakeTimers()
    const abort = new AbortController()
    const captura = await capturarPcm(microfone, abort.signal, receber, falhar, { trilhas: 'proprias' })
    const fim = captura.encerrar()
    abort.abort()
    await fim
    expect(vi.getTimerCount()).toBe(0)
  })
})
