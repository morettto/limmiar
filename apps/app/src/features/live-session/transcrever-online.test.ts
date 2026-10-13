import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { transcreverAoVivo, type CapturaTranscricao, type TranscricaoAoVivo } from './transcrever-ao-vivo'
import { transcreverOnline } from './transcrever-online'

vi.mock('./transcrever-ao-vivo', () => ({ transcreverAoVivo: vi.fn() }))
const transcrever = vi.mocked(transcreverAoVivo)
const emprestada = (indice: number) => transcrever.mock.calls[indice]![4] as Extract<CapturaTranscricao, { trilhas: 'emprestadas' }>
const local = {} as MediaStream
const remoto = {} as MediaStream
const atualizar = vi.fn()
const falhar = vi.fn()
const encerrar = vi.fn(async () => {})
const pausar = vi.fn()
const resultado: TranscricaoAoVivo = { palavras: [{ texto: 'fala.', inicioMs: 0, fimMs: 500, locutor: 'speaker_0' }], finais: 1, estavelAteMs: 0 }
beforeEach(() => {
  transcrever.mockResolvedValue({ encerrar, pausar })
  vi.spyOn(performance, 'now').mockReturnValue(1000)
})
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })
describe('transcrição das origens online', () => {
  it('conserva mute nas trilhas originais, separa papéis e não espera fala do profissional para liberar o paciente', async () => {
    const abort = new AbortController()
    const sessao = await transcreverOnline(local, remoto, abort.signal, atualizar, falhar, 2000)
    expect(transcrever.mock.calls.map(call => call[0])).toEqual([local, remoto])
    expect(transcrever.mock.calls.map(call => call[4].trilhas)).toEqual(['emprestadas', 'emprestadas'])
    expect([emprestada(0).falante, emprestada(1).falante]).toEqual(['profissional', 'paciente'])
    transcrever.mock.calls[1]![2](resultado)
    expect(atualizar.mock.lastCall?.[0]).toEqual({ palavras: [{ ...resultado.palavras[0], locutor: 'online-paciente', inicioMs: 2000, fimMs: 2500 }], finais: 1, estavelAteMs: 2501 })
    transcrever.mock.calls[0]![2]({ ...resultado, palavras: [{ ...resultado.palavras[0]!, inicioMs: 100, fimMs: 100 }] })
    expect(atualizar.mock.lastCall?.[0].palavras.map((palavra: { locutor: string }) => palavra.locutor)).toEqual(['online-paciente', 'online-profissional'])
    sessao.pausar(true); expect(pausar).toHaveBeenCalledTimes(2)
    const fim = sessao.encerrar()
    expect(sessao.encerrar()).toBe(fim)
    await fim
    expect(encerrar).toHaveBeenCalledTimes(2)
    expect(transcrever.mock.calls[0]![1].aborted).toBe(true)
    abort.abort()
  })
  it('alinha o início real de cada captura e mantém silêncio anterior', async () => {
    const sessao = await transcreverOnline(local, remoto, new AbortController().signal, atualizar, falhar, 50)
    vi.mocked(performance.now).mockReturnValue(2500)
    emprestada(1).receberPcm!(new Float32Array(16000))
    emprestada(1).receberPcm!(new Float32Array(16000))
    transcrever.mock.calls[1]![2](resultado)
    expect(atualizar.mock.lastCall?.[0].palavras[0].inicioMs).toBe(550)
    vi.mocked(performance.now).mockReturnValue(900)
    emprestada(0).receberPcm!(new Float32Array(16000))
    transcrever.mock.calls[0]![2](resultado)
    expect(atualizar.mock.lastCall?.[0].palavras[0].inicioMs).toBe(50)
    await sessao.encerrar()
  })
  it('exibe hipóteses intermediárias sem liberar sua análise e usa apenas frases finalizadas do paciente', async () => {
    const sessao = await transcreverOnline(local, remoto, new AbortController().signal, atualizar, falhar, 50)
    transcrever.mock.calls[1]![2]({ ...resultado, finais: 0, estavelAteMs: 9000 })
    expect(atualizar.mock.lastCall?.[0].palavras).toHaveLength(1)
    expect(atualizar.mock.lastCall?.[0].estavelAteMs).toBe(50)
    transcrever.mock.calls[1]![2]({ ...resultado, palavras: [...resultado.palavras,
      { texto: 'Hipótese.', inicioMs: 700, fimMs: 1000, locutor: 'speaker_0' }], estavelAteMs: 0 })
    expect(atualizar.mock.lastCall?.[0].estavelAteMs).toBe(551)
    transcrever.mock.calls[0]![2]({ ...resultado, palavras: [{ ...resultado.palavras[0]!, fimMs: 10000 }] })
    expect(atualizar.mock.lastCall?.[0].estavelAteMs).toBe(551)
    await sessao.encerrar()
  })
  it('repassa o aviso de conexão de qualquer trilha, com a queda na frente do atraso', async () => {
    const sessao = await transcreverOnline(local, remoto, new AbortController().signal, atualizar, falhar, 0)
    transcrever.mock.calls[0]![2]({ ...resultado, aviso: 'atrasada' })
    expect(atualizar.mock.lastCall?.[0].aviso).toBe('atrasada')
    transcrever.mock.calls[1]![2]({ ...resultado, aviso: 'reconectando' })
    expect(atualizar.mock.lastCall?.[0].aviso).toBe('reconectando')
    transcrever.mock.calls[1]![2](resultado)
    expect(atualizar.mock.lastCall?.[0].aviso).toBe('atrasada')
    transcrever.mock.calls[0]![2](resultado)
    expect('aviso' in atualizar.mock.lastCall![0]).toBe(false)
    await sessao.encerrar()
  })
  it('cancela ambas as entradas e informa apenas a primeira falha', async () => {
    const abort = new AbortController()
    await transcreverOnline(local, remoto, abort.signal, atualizar, falhar, 0)
    const erro = new Error('entrada perdida')
    transcrever.mock.calls[0]![3](erro)
    transcrever.mock.calls[1]![3](erro)
    expect(falhar).toHaveBeenCalledOnce()
    expect(falhar).toHaveBeenCalledWith(erro)
    expect(transcrever.mock.calls[1]![1].aborted).toBe(true)
    abort.abort()
  })
  it('fecha a primeira entrada se a segunda não iniciar e rejeita commit falho', async () => {
    transcrever.mockRejectedValueOnce(new Error('sem serviço'))
    await expect(transcreverOnline(local, remoto, new AbortController().signal, atualizar, falhar, 0)).rejects.toThrow('sem serviço')
    transcrever.mockClear()
    const sessao = await transcreverOnline(local, remoto, new AbortController().signal, atualizar, falhar, 0)
    encerrar.mockRejectedValueOnce(new Error('commit falhou'))
    await expect(sessao.encerrar()).rejects.toThrow('commit falhou')
    expect(transcrever.mock.calls[0]![1].aborted).toBe(true)
  })
  it('propaga cancelamento prévio ao transporte antes de abrir captura', async () => {
    const abort = new AbortController(); abort.abort()
    transcrever.mockImplementationOnce(async (_stream, signal) => { expect(signal.aborted).toBe(true); throw new DOMException('cancelado', 'AbortError') })
    await expect(transcreverOnline(local, remoto, abort.signal, atualizar, falhar, 0)).rejects.toThrow('cancelado')
  })
  it('o primeiro relato de uma trilha não traz palavras da outra e cada trilha só alinha o primeiro bloco', async () => {
    const sessao = await transcreverOnline(local, remoto, new AbortController().signal, atualizar, falhar, 50)
    transcrever.mock.calls[0]![2](resultado)
    expect(atualizar.mock.lastCall?.[0].palavras.map((palavra: { locutor: string }) => palavra.locutor)).toEqual(['online-profissional'])
    transcrever.mock.calls[1]![2](resultado)
    expect(atualizar.mock.lastCall?.[0].palavras).toHaveLength(2)

    vi.mocked(performance.now).mockReturnValue(3000)
    emprestada(0).receberPcm!(new Float32Array(1600))
    vi.mocked(performance.now).mockReturnValue(9000)
    emprestada(0).receberPcm!(new Float32Array(1600))
    emprestada(1).receberPcm!(new Float32Array(1600))
    transcrever.mock.calls[0]![2](resultado)
    transcrever.mock.calls[1]![2](resultado)
    const palavras = atualizar.mock.lastCall?.[0].palavras as { locutor: string; inicioMs: number }[]
    expect(palavras.map((palavra) => [palavra.locutor, palavra.inicioMs])).toEqual([['online-profissional', 1950], ['online-paciente', 7950]])
    await sessao.encerrar()
  })

  it('palavras que começam juntas saem na ordem em que terminam', async () => {
    const sessao = await transcreverOnline(local, remoto, new AbortController().signal, atualizar, falhar, 0)
    transcrever.mock.calls[0]![2]({ ...resultado, palavras: [{ texto: 'comprida', inicioMs: 100, fimMs: 900, locutor: 'x' }, { texto: 'curta', inicioMs: 100, fimMs: 300, locutor: 'x' }] })
    expect(atualizar.mock.lastCall?.[0].palavras.map((palavra: { texto: string }) => palavra.texto)).toEqual(['curta', 'comprida'])
    await sessao.encerrar()
  })

  it('o aviso mais grave vale mesmo vindo da primeira trilha', async () => {
    const sessao = await transcreverOnline(local, remoto, new AbortController().signal, atualizar, falhar, 0)
    transcrever.mock.calls[1]![2]({ ...resultado, aviso: 'atrasada' })
    transcrever.mock.calls[0]![2]({ ...resultado, aviso: 'reconectando' })
    expect(atualizar.mock.lastCall?.[0].aviso).toBe('reconectando')
    await sessao.encerrar()
  })

  it('o segundo bloco de áudio de uma trilha não refaz o alinhamento já feito', async () => {
    const sessao = await transcreverOnline(local, remoto, new AbortController().signal, atualizar, falhar, 0)
    vi.mocked(performance.now).mockReturnValue(2000)
    emprestada(1).receberPcm!(new Float32Array(16000))
    vi.mocked(performance.now).mockReturnValue(5000)
    emprestada(1).receberPcm!(new Float32Array(16000))
    transcrever.mock.calls[1]![2](resultado)
    expect(atualizar.mock.lastCall?.[0].palavras[0].inicioMs).toBe(0)
    await sessao.encerrar()
  })

  it('solta o ouvinte de cancelamento ao encerrar e ao falhar na abertura', async () => {
    const controle = new AbortController()
    const remover = vi.spyOn(controle.signal, 'removeEventListener')
    const sessao = await transcreverOnline(local, remoto, controle.signal, atualizar, falhar, 0)
    await sessao.encerrar()
    expect(remover).toHaveBeenCalledWith('abort', expect.any(Function))

    const outro = new AbortController()
    const removerOutro = vi.spyOn(outro.signal, 'removeEventListener')
    transcrever.mockRejectedValueOnce(new Error('sem serviço'))
    await expect(transcreverOnline(local, remoto, outro.signal, atualizar, falhar, 0)).rejects.toThrow('sem serviço')
    expect(removerOutro).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})
