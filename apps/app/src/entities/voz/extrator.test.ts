import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { criarExtratorVoz } from './extrator'
import { MODELO_VOZ } from './modelo'
import { dynamicActivate } from '../../shared/i18n'

beforeAll(async () => dynamicActivate('pt-BR'))

const construcoes: unknown[][] = []
let worker: { onmessage(evento: { data: unknown }): void; onerror(): void; onmessageerror(): void; terminate: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> }
const embedding = new Array(192).fill(0.1)
beforeEach(() => {
  construcoes.length = 0
  vi.useFakeTimers()
  vi.stubGlobal('Worker', class {
    onmessage = () => {}; onerror = () => {}; onmessageerror = () => {}
    terminate = vi.fn(); postMessage = vi.fn()
    constructor(...argumentos: unknown[]) { worker = this; construcoes.push(argumentos) }
  })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

async function iniciar() {
  const abort = new AbortController()
  const pronto = criarExtratorVoz(abort.signal)
  worker.onmessage({ data: { tipo: 'pronto', modelo: MODELO_VOZ } })
  return { abort, extrator: await pronto }
}

describe('extrator de voz no navegador', () => {
  it('extrai com transferência de uma cópia e mantém o áudio original intacto', async () => {
    const { extrator } = await iniciar()
    const pcm = new Float32Array(32000).fill(0.5)
    const extraido = extrator.extrair(pcm)
    const [mensagem, transferidos] = worker.postMessage.mock.calls[0]!
    expect(mensagem.pcm).not.toBe(pcm)
    expect(transferidos).toEqual([mensagem.pcm.buffer])
    worker.onmessage({ data: { tipo: 'embedding', id: 999, embedding } })
    worker.onmessage({ data: { tipo: 'embedding', id: mensagem.id, embedding } })
    expect(await extraido).toEqual(embedding)
    expect(pcm[0]).toBe(0.5)
    extrator.encerrar(); extrator.encerrar()
    worker.onmessage({ data: { tipo: 'erro' } })
    expect(worker.terminate).toHaveBeenCalledOnce()
    await expect(extrator.extrair(pcm)).rejects.toMatchObject({ name: 'AbortError', message: 'Cancelado' })
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cancelamento anterior à inicialização não cria o worker', async () => {
    const abort = new AbortController(); abort.abort()
    await expect(criarExtratorVoz(abort.signal)).rejects.toMatchObject({ name: 'AbortError', message: 'Cancelado' })
    expect(construcoes).toEqual([])
  })
  it.each([
    ['cancelar', 'Cancelado'], ['erro', 'Não foi possível reconhecer a voz localmente.'], ['mensagem', 'Não foi possível reconhecer a voz localmente.'],
    ['modelo', 'Não foi possível reconhecer a voz localmente.'], ['timeout', 'Não foi possível reconhecer a voz localmente.'],
  ])('encerra inicialização em %s', async (etapa, motivo) => {
    const abort = new AbortController()
    const pronto = criarExtratorVoz(abort.signal)
    const verifica = expect(pronto).rejects.toThrow(motivo)
    if (etapa === 'cancelar') abort.abort()
    if (etapa === 'erro') worker.onerror()
    if (etapa === 'mensagem') worker.onmessageerror()
    if (etapa === 'modelo') worker.onmessage({ data: { tipo: 'pronto', modelo: 'errado' } })
    if (etapa === 'timeout') await vi.advanceTimersByTimeAsync(60000)
    await verifica
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each([
    ['cancelar', 'Cancelado'], ['timeout', 'Não foi possível reconhecer a voz localmente.'], ['erro', 'Não foi possível reconhecer a voz localmente.'],
    ['postMessage', 'Não foi possível reconhecer a voz localmente.'], ['invalido', 'Não foi possível reconhecer a voz localmente.'],
  ])('recusa inferência e encerra os recursos em %s', async (etapa, motivo) => {
    const { abort, extrator } = await iniciar()
    if (etapa === 'postMessage') worker.postMessage.mockImplementation(() => { throw new Error('falha') })
    const extraido = extrator.extrair(new Float32Array(32000))
    const verifica = expect(extraido).rejects.toThrow(motivo)
    if (etapa === 'cancelar') abort.abort()
    if (etapa === 'timeout') await vi.advanceTimersByTimeAsync(15000)
    if (etapa === 'erro') worker.onmessage({ data: { tipo: 'erro', id: 1 } })
    if (etapa === 'invalido') worker.onmessage({ data: { tipo: 'embedding', id: 1, embedding: [NaN] } })
    await verifica
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each([31999, 240001, NaN, 2])('recusa PCM inválido %s antes de enviá-lo', async (valor) => {
    const { extrator } = await iniciar()
    const pcm = valor > 2 ? new Float32Array(valor) : new Float32Array(32000).fill(valor)
    await expect(extrator.extrair(pcm)).rejects.toThrow('inválida')
    expect(worker.postMessage).not.toHaveBeenCalled()
    extrator.encerrar()
  })
  it('limita ao intervalo [-1, 1] um pico que passa de 1 por pouco', async () => {
    const { extrator } = await iniciar()
    const extraido = expect(extrator.extrair(new Float32Array(32000).fill(1.2))).rejects.toThrow('Cancelado')
    const enviado = worker.postMessage.mock.calls[0][0].pcm as Float32Array
    expect(Math.max(...enviado)).toBe(1)
    extrator.encerrar()
    await extraido
  })
  it.each([null, 'x', { tipo: 'embedding', id: '1', embedding }])('recusa mensagem fora do contrato %j', async (data) => {
    const pronto = criarExtratorVoz(new AbortController().signal)
    const verifica = expect(pronto).rejects.toThrow()
    worker.onmessage({ data })
    await verifica
  })
  it('abre o worker de identidade de voz como módulo e solta o ouvinte de cancelamento ao fechar', async () => {
    const abort = new AbortController()
    const remover = vi.spyOn(abort.signal, 'removeEventListener')
    const pronto = criarExtratorVoz(abort.signal)
    worker.onmessage({ data: { tipo: 'pronto', modelo: MODELO_VOZ } })
    const extrator = await pronto
    expect(construcoes).toEqual([['/models/voice-identity/worker.js', { type: 'module' }]])
    extrator.encerrar()
    expect(remover).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('numera as inferências a partir de 1 e aceita os limites do áudio', async () => {
    const { extrator } = await iniciar()
    const limite = new Float32Array(240000).fill(1.5)
    void extrator.extrair(limite).catch(() => {})
    void extrator.extrair(new Float32Array(32000)).catch(() => {})
    expect(worker.postMessage.mock.calls.map(([mensagem]) => mensagem.id)).toEqual([1, 2])
    expect(worker.postMessage.mock.calls[0]![0].pcm).toHaveLength(240000)
    extrator.encerrar()
  })

  it('recusa um áudio com uma única amostra fora do limite no meio de amostras boas', async () => {
    const { extrator } = await iniciar()
    const pcm = new Float32Array(32000).fill(0.5)
    pcm[100] = 1.6
    await expect(extrator.extrair(pcm)).rejects.toThrow('inválida')
    const pcmComNaN = new Float32Array(32000).fill(0.5)
    pcmComNaN[100] = Number.NaN
    await expect(extrator.extrair(pcmComNaN)).rejects.toThrow('inválida')
    expect(worker.postMessage).not.toHaveBeenCalled()
    extrator.encerrar()
  })

  it('limita também o pico negativo ao intervalo [-1, 1]', async () => {
    const { extrator } = await iniciar()
    const extraido = expect(extrator.extrair(new Float32Array(32000).fill(-1.2))).rejects.toThrow('Cancelado')
    const enviado = worker.postMessage.mock.calls[0]![0].pcm as Float32Array
    expect(Math.min(...enviado)).toBe(-1)
    expect(Math.max(...enviado)).toBe(-1)
    extrator.encerrar()
    await extraido
  })

  it('um segundo aviso de pronto, um embedding antes da hora ou um tipo desconhecido derrubam o extrator', async () => {
    const aberto = criarExtratorVoz(new AbortController().signal)
    let resolvido = false
    void aberto.then(() => { resolvido = true }, () => {})
    worker.onmessage({ data: { tipo: 'embedding', modelo: MODELO_VOZ, id: 1, embedding } })
    await Promise.resolve()
    expect(resolvido).toBe(false)
    worker.onmessage({ data: { tipo: 'pronto', modelo: MODELO_VOZ } })
    const extrator = await aberto
    const pendente = expect(extrator.extrair(new Float32Array(32000))).rejects.toThrow('Não foi possível reconhecer a voz localmente.')
    worker.onmessage({ data: { tipo: 'pronto', modelo: MODELO_VOZ } })
    await pendente
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('um tipo desconhecido com id e embedding válidos também derruba o extrator', async () => {
    const { extrator } = await iniciar()
    const pendente = expect(extrator.extrair(new Float32Array(32000))).rejects.toThrow('Não foi possível reconhecer a voz localmente.')
    worker.onmessage({ data: { tipo: 'outro', id: 1, embedding } })
    await pendente
  })
})
