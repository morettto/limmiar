import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { capturarPerfil } from './capturar-perfil'
import { criarExtratorVoz } from '../../entities/voz/extrator'
import { capturarPcm } from '../../shared/audio/capturar-pcm'
import { dynamicActivate } from '../../shared/i18n'

beforeAll(async () => dynamicActivate('pt-BR'))

vi.mock('../../entities/voz/extrator', () => ({ criarExtratorVoz: vi.fn() }))
vi.mock('../../shared/audio/capturar-pcm', () => ({ capturarPcm: vi.fn() }))
const encerrar = vi.fn()
const cancelar = vi.fn()
const parar = vi.fn()
const extrair = vi.fn(async (_pcm: Float32Array) => new Array(192).fill(0.1))
const permissao = vi.fn(async () => ({ getTracks: () => [{ stop: parar }] }))
const progresso = vi.fn()
let receber: (pcm: Float32Array) => void
let falhar: () => void
beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: permissao }, configurable: true })
  vi.mocked(criarExtratorVoz).mockResolvedValue({ extrair, encerrar })
  vi.mocked(capturarPcm).mockImplementation(async (_stream, _signal, onPcm, onErro) => {
    receber = onPcm; falhar = onErro
    return { cancelar, encerrar: async () => {}, pausar: () => {} }
  })
})
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })
async function pronto(abort = new AbortController()) {
  const resultado = capturarPerfil(abort.signal, progresso)
  await vi.waitFor(() => expect(capturarPcm).toHaveBeenCalled())
  return { resultado, abort }
}

describe('amostra do profissional somente em memória', () => {
  it('captura exatamente 15s, compara os três trechos e limpa todos os vetores e recursos', async () => {
    const vetores = [new Array(192).fill(0.1), new Array(192).fill(0.2), new Array(192).fill(0.3)]
    const janelas: number[][] = []
    vetores.forEach((vetor) => extrair.mockImplementationOnce(async (pcm: Float32Array) => { janelas.push([pcm.length, pcm[0]!, pcm[pcm.length - 1]!]); return vetor }))
    const { resultado } = await pronto()
    expect(permissao).toHaveBeenCalledWith({ audio: true })
    expect(vi.mocked(capturarPcm).mock.calls[0]![4]).toEqual({ trilhas: 'proprias' })
    receber(new Float32Array(80000).fill(0.1))
    expect(progresso).toHaveBeenLastCalledWith(5)
    await vi.advanceTimersByTimeAsync(0)
    expect(extrair).not.toHaveBeenCalled()
    const resto = new Float32Array(160010).fill(0.2)
    resto.fill(0.3, 80000)
    receber(resto)
    const perfil = await resultado
    expect(janelas).toEqual([[80000, Math.fround(0.1), Math.fround(0.1)], [80000, Math.fround(0.2), Math.fround(0.2)], [80000, Math.fround(0.3), Math.fround(0.3)]])
    expect(perfil.length).toBe(192)
    expect(Math.hypot(...perfil)).toBeCloseTo(1)
    expect(perfil.every((valor) => Math.abs(valor - 1 / Math.sqrt(192)) < 1e-9)).toBe(true)
    expect(progresso).toHaveBeenLastCalledWith(15)
    expect(extrair).toHaveBeenCalledTimes(3)
    expect(extrair.mock.calls.every(([pcm]) => pcm.every((valor: number) => valor === 0))).toBe(true)
    expect(vetores.every((vetor) => vetor.every((valor) => valor === 0))).toBe(true)
    expect(encerrar).toHaveBeenCalledOnce(); expect(parar).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each([
    ['silencio', 'A amostra não contém fala suficiente.'],
    ['mudanca1', 'A voz variou durante a amostra (similaridade 0.00).'],
    ['mudanca2', 'A voz variou durante a amostra (similaridade 0.00).'],
    ['mudanca3', 'A voz variou durante a amostra (similaridade 0.28).'],
    ['inferencia', 'extrator falhou'],
  ])('recusa %s sem armazenar perfil', async (etapa, motivo) => {
    const a = [1, ...new Array(191).fill(0)]
    const b = [0, 1, ...new Array(190).fill(0)]
    if (etapa === 'mudanca1') extrair.mockResolvedValueOnce(a).mockResolvedValueOnce(b).mockResolvedValueOnce(a)
    if (etapa === 'mudanca2') extrair.mockResolvedValueOnce(a).mockResolvedValueOnce(a).mockResolvedValueOnce(b)
    if (etapa === 'mudanca3') {
      const c = [0.8, 0.6, ...new Array(190).fill(0)]
      const d = [0.8, -0.6, ...new Array(190).fill(0)]
      extrair.mockResolvedValueOnce(a).mockResolvedValueOnce(c).mockResolvedValueOnce(d)
    }
    if (etapa === 'inferencia') extrair.mockRejectedValueOnce(new Error('extrator falhou'))
    const { resultado } = await pronto()
    const verifica = expect(resultado).rejects.toThrow(new Error(motivo))
    receber(new Float32Array(240000).fill(etapa === 'silencio' ? 0 : 0.1))
    await verifica
    expect(encerrar).toHaveBeenCalledOnce(); expect(parar).toHaveBeenCalled()
  })
  it.each([
    ['cancelar', { name: 'AbortError', message: 'Cancelado' }],
    ['interromper', { message: 'O microfone foi interrompido.' }],
    ['timeout', { message: 'O microfone não concluiu a captura.' }],
  ])('encerra captura em %s', async (etapa, motivo) => {
    const { resultado, abort } = await pronto()
    const verifica = expect(resultado).rejects.toMatchObject(motivo)
    if (etapa === 'cancelar') abort.abort()
    if (etapa === 'interromper') falhar()
    if (etapa === 'timeout') await vi.advanceTimersByTimeAsync(45000)
    await verifica
    expect(encerrar).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
  })
  it('deixa de ouvir o cancelamento quando termina', async () => {
    const abort = new AbortController()
    const remover = vi.spyOn(abort.signal, 'removeEventListener')
    const { resultado } = await pronto(abort)
    receber(new Float32Array(240000).fill(0.1))
    await resultado
    expect(remover).toHaveBeenCalledWith('abort', expect.any(Function))
  })
  it('amostra com energia baixa demais é recusada mesmo que a soma seja grande', async () => {
    const { resultado } = await pronto()
    const verifica = expect(resultado).rejects.toThrow(new Error('A amostra não contém fala suficiente.'))
    receber(new Float32Array(240000).fill(0.002))
    await verifica
    expect(extrair).not.toHaveBeenCalled()
  })
  it('aceita vozes cuja menor similaridade é exatamente o limiar', async () => {
    const a = [1, ...new Array(191).fill(0)]
    const b = [0.5, 0.5, 0.5, 0.5, ...new Array(188).fill(0)]
    extrair.mockResolvedValueOnce(a).mockResolvedValueOnce(b).mockResolvedValueOnce([...a])
    const { resultado } = await pronto()
    receber(new Float32Array(240000).fill(0.1))
    expect((await resultado).length).toBe(192)
  })
  it('recusa permissão negada e falha de abertura do áudio', async () => {
    permissao.mockRejectedValueOnce(new Error('permissão negada'))
    await expect(capturarPerfil(new AbortController().signal, progresso)).rejects.toThrow('permissão')
    vi.mocked(capturarPcm).mockRejectedValueOnce(new Error('áudio indisponível'))
    await expect(capturarPerfil(new AbortController().signal, progresso)).rejects.toThrow('áudio')
    expect(encerrar).toHaveBeenCalledTimes(2)
  })
  it.each(['cancelar', 'timeout'])('para permissão tardia após %s sem iniciar captura', async (etapa) => {
    let liberar!: (stream: { getTracks(): { stop: typeof parar }[] }) => void
    permissao.mockImplementationOnce(() => new Promise((resolve) => { liberar = resolve }))
    const abort = new AbortController()
    const resultado = capturarPerfil(abort.signal, progresso)
    const verifica = expect(resultado).rejects.toThrow()
    await vi.waitFor(() => expect(permissao).toHaveBeenCalled())
    if (etapa === 'cancelar') abort.abort()
    else await vi.advanceTimersByTimeAsync(45000)
    await verifica
    liberar({ getTracks: () => [{ stop: parar }] })
    await Promise.resolve()
    expect(parar).toHaveBeenCalledOnce()
    expect(capturarPcm).not.toHaveBeenCalled()
  })
  it('recusa cancelamento entre preparar o modelo e abrir o microfone', async () => {
    const abort = new AbortController()
    vi.mocked(criarExtratorVoz).mockImplementationOnce(async () => { abort.abort(); return { extrair, encerrar } })
    await expect(capturarPerfil(abort.signal, progresso)).rejects.toThrow()
    expect(permissao).not.toHaveBeenCalled()
    expect(encerrar).toHaveBeenCalledOnce()
  })
})
