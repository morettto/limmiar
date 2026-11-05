import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FalhaServicoInsight } from './falha-insight'
import { criarFilaInsights } from './fila-insights'
import type { ConsultaInsight, ResultadoInsight } from './insight'

const fala: ConsultaInsight = { id: 'fala', frase: 'Não durmo.', contexto: [], fimMs: 1000 }
const falaEm = (id: string, fimMs: number): ConsultaInsight => ({ id, frase: `Frase ${id}.`, contexto: [], fimMs })
const resultado: ResultadoInsight = { cartoes: [], clarificar: false, alerta_risco: false, completo: true, juiz: 'v1' }
const emEspera = () => {
  const resolver: ((r: ResultadoInsight) => void)[] = []
  const consultar = vi.fn((_consulta: ConsultaInsight, _signal: AbortSignal) => new Promise<ResultadoInsight>((resolve) => resolver.push(resolve)))
  return { consultar, resolver, ids: () => consultar.mock.calls.map(([consulta]) => consulta.id) }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
describe('fila de insights ao vivo', () => {
  it('consulta na hora a fala mais nova ainda fresca, sem cancelar a que está em curso, e adia a de mais de 15 s', async () => {
    const { consultar, resolver, ids } = emEspera()
    const fila = criarFilaInsights(consultar, vi.fn(), vi.fn())
    fila.atualizar([falaEm('a', 10_000)], 10_001)
    expect(ids()).toEqual(['a'])
    // c chega por último, mas é mais antiga que d (papel decidido tarde): a ordem é a do fim da fala
    const falas = [falaEm('a', 10_000), falaEm('b', 9_000), falaEm('d', 25_000), falaEm('c', 22_000)]
    fila.atualizar(falas, 25_001)
    expect(consultar.mock.calls[0]![1].aborted).toBe(false)
    for (const indice of [0, 1, 2]) { resolver[indice]!(resultado); await vi.advanceTimersByTimeAsync(1) }
    expect(ids()).toEqual(['a', 'd', 'c'])
    fila.atualizar(falas, undefined)
    expect(ids()).toEqual(['a', 'd', 'c', 'b'])
    fila.encerrar()
  })
  it('a idade vale até 15 s inclusive, no relógio da conversa', () => {
    const { consultar, ids } = emEspera()
    const fila = criarFilaInsights(consultar, vi.fn(), vi.fn())
    fila.atualizar([falaEm('x', 0)], 15_001)
    expect(ids()).toEqual([])
    fila.atualizar([falaEm('x', 0)], 15_000)
    expect(ids()).toEqual(['x'])
    fila.encerrar()
  })
  it('depois da gravação, as falas adiadas vão da mais antiga à mais nova', async () => {
    const { consultar, resolver, ids } = emEspera()
    const fila = criarFilaInsights(consultar, vi.fn(), vi.fn())
    const falas = [falaEm('p1', 10_000), falaEm('p2', 20_000), falaEm('p3', 30_000)]
    fila.atualizar(falas, 60_000)
    expect(ids()).toEqual([])
    fila.atualizar(falas, undefined)
    for (const indice of [0, 1]) { resolver[indice]!(resultado); await vi.advanceTimersByTimeAsync(1) }
    expect(ids()).toEqual(['p1', 'p2', 'p3'])
    fila.encerrar()
  })
  it('consulta apenas uma vez a mesma fala e contexto', async () => {
    const consultar = vi.fn(async () => resultado)
    const atualizar = vi.fn()
    const fila = criarFilaInsights(consultar, atualizar, vi.fn())
    fila.atualizar([fala], 1001)
    await vi.advanceTimersByTimeAsync(1)
    expect(atualizar).toHaveBeenLastCalledWith(fala.id, resultado, fala)
    fila.atualizar([fala], 1001)
    await vi.advanceTimersByTimeAsync(1000)
    expect(consultar).toHaveBeenCalledOnce()
    fila.encerrar()
  })
  it('a fala corrigida cancela a sua consulta, descarta resposta obsoleta e consulta só o texto mais recente', async () => {
    const { consultar, resolver } = emEspera()
    const atualizar = vi.fn()
    const falhar = vi.fn()
    const fila = criarFilaInsights(consultar, atualizar, falhar)
    fila.atualizar([fala], 1001)
    fila.atualizar([{ ...fala, frase: 'Não durmo bem', fimMs: 1500 }], 1501)
    fila.atualizar([{ ...fala, frase: 'Não durmo bem desde ontem', fimMs: 2000 }], 2001)
    expect(consultar.mock.calls[0]![1].aborted).toBe(true)
    resolver[0]!(resultado); await vi.advanceTimersByTimeAsync(1)
    expect(atualizar.mock.calls.every(([, item]) => item === null)).toBe(true)
    expect(consultar).toHaveBeenCalledTimes(2)
    expect(consultar.mock.lastCall?.[0].frase).toBe('Não durmo bem desde ontem')
    expect(falhar).not.toHaveBeenCalled()
    fila.encerrar()
  })
  it.each(['retirada', 'encerrar', 'erro-obsoleto'])('cancela análise e não publica resultados ao %s', async (modo) => {
    let resolver!: (resultado: ResultadoInsight) => void
    let rejeitar!: (erro: Error) => void
    const consultar = vi.fn<(consulta: ConsultaInsight, signal: AbortSignal) => Promise<ResultadoInsight>>()
      .mockImplementation(() => new Promise((resolve, reject) => { resolver = resolve; rejeitar = reject }))
    const atualizar = vi.fn()
    const falhar = vi.fn()
    const fila = criarFilaInsights(consultar, atualizar, falhar)
    fila.atualizar([fala], 1001)
    if (modo === 'encerrar') fila.encerrar()
    else fila.atualizar([], 1001)
    expect(consultar.mock.calls[0]![1].aborted).toBe(true)
    if (modo === 'erro-obsoleto') rejeitar(new Error('antigo'))
    else resolver(resultado)
    await vi.advanceTimersByTimeAsync(1000)
    expect(atualizar.mock.calls.every(([, item]) => item === null)).toBe(true)
    expect(falhar).not.toHaveBeenCalled()
    fila.encerrar()
  })
  it('informa falha vigente sem repetir indefinidamente a mesma consulta', async () => {
    const consultar = vi.fn().mockRejectedValue(new Error('indisponível'))
    const falhar = vi.fn()
    const fila = criarFilaInsights(consultar, vi.fn(), falhar)
    fila.atualizar([fala], 1001); await vi.advanceTimersByTimeAsync(1500)
    fila.atualizar([fala], 1001); await vi.advanceTimersByTimeAsync(1500)
    expect(falhar).toHaveBeenCalledExactlyOnceWith('sem_analise', fala)
    expect(consultar).toHaveBeenCalledOnce()
    fila.encerrar()
  })
})

describe('falhas do serviço', () => {
  const fora = () => new FalhaServicoInsight('fora')
  const chamadas = (consultar: { mock: { calls: unknown[][] } }) => consultar.mock.calls.length
  beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(0.5) })

  it('serviço fora: tenta a mesma fala de novo após uma fração aleatória de um teto que dobra até 30 s', async () => {
    const consultar = vi.fn().mockRejectedValue(fora())
    const atualizar = vi.fn()
    const falhar = vi.fn()
    const fila = criarFilaInsights(consultar, atualizar, falhar)
    fila.atualizar([fala], 1001)
    expect(chamadas(consultar)).toBe(1)
    for (const [espera, total] of [[500, 2], [1000, 3], [2000, 4], [4000, 5], [8000, 6], [15000, 7], [15000, 8]] as const) {
      await vi.advanceTimersByTimeAsync(espera - 1)
      expect(chamadas(consultar)).toBe(total - 1)
      await vi.advanceTimersByTimeAsync(1)
      expect(chamadas(consultar)).toBe(total)
    }
    expect(falhar).toHaveBeenCalledTimes(8)
    expect(falhar).toHaveBeenLastCalledWith('fora', fala)
    expect(atualizar).not.toHaveBeenCalled()
    fila.encerrar()
  })

  it('depois de uma resposta do serviço o teto recomeça de 1 s', async () => {
    const consultar = vi.fn().mockRejectedValueOnce(fora()).mockRejectedValueOnce(fora()).mockResolvedValueOnce(resultado)
      .mockRejectedValueOnce(fora()).mockResolvedValue(resultado)
    const fila = criarFilaInsights(consultar, vi.fn(), vi.fn())
    const apos = async (ms: number, total: number) => { await vi.advanceTimersByTimeAsync(ms); expect(chamadas(consultar)).toBe(total) }
    fila.atualizar([fala], 1001)
    await apos(499, 1); await apos(1, 2); await apos(1000, 3)
    fila.atualizar([fala, { ...fala, id: 'nova' }], 1001)
    expect(chamadas(consultar)).toBe(4)
    await apos(499, 4); await apos(1, 5)
    fila.encerrar()
  })

  it('fala nova durante a espera não fura a espera', async () => {
    const consultar = vi.fn().mockRejectedValueOnce(fora()).mockResolvedValue(resultado)
    const fila = criarFilaInsights(consultar, vi.fn(), vi.fn())
    fila.atualizar([fala], 1001); await vi.advanceTimersByTimeAsync(1)
    fila.atualizar([fala, { ...fala, id: 'nova' }], 1001)
    await vi.advanceTimersByTimeAsync(498)
    expect(chamadas(consultar)).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(consultar.mock.calls.map(([consulta]) => consulta.id)).toEqual(['fala', 'fala', 'nova'])
    fila.encerrar()
  })

  it('copiloto não liberado: não repete a fala, retira o resultado e avisa; a fala seguinte tenta de novo', async () => {
    const consultar = vi.fn().mockRejectedValueOnce(new FalhaServicoInsight('nao_liberado')).mockResolvedValue(resultado)
    const atualizar = vi.fn()
    const falhar = vi.fn()
    const fila = criarFilaInsights(consultar, atualizar, falhar)
    fila.atualizar([fala], 1001); await vi.advanceTimersByTimeAsync(40_000)
    expect(chamadas(consultar)).toBe(1)
    expect(falhar).toHaveBeenCalledExactlyOnceWith('nao_liberado', fala)
    expect(atualizar).toHaveBeenLastCalledWith('fala', null, fala)
    fila.atualizar([fala, { ...fala, id: 'nova' }], 1001)
    expect(consultar.mock.lastCall![0].id).toBe('nova')
    fila.encerrar()
  })
})
