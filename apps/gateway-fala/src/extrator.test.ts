import { describe, expect, it, vi } from 'vitest'
import { criarExtratorTitanet, type PedidoVoz, type SegmentoVoz, type TrabalhadorDeVoz } from './extrator.ts'
import { esperar } from './test-support/falsos.ts'

type Resposta = Parameters<Parameters<TrabalhadorDeVoz['on']>[1]>[0]

class TrabalhadorFalso implements TrabalhadorDeVoz {
  recebidos: PedidoVoz[] = []
  encerrado = false
  private ouvinteMensagem: ((resposta: Resposta) => void) | undefined
  private ouvinteErro: ((erro: Error) => void) | undefined

  postMessage(pedido: PedidoVoz): void { this.recebidos.push(pedido) }
  on(evento: string, ouvinte: unknown): void {
    if (evento === 'message') this.ouvinteMensagem = ouvinte as (resposta: Resposta) => void
    else this.ouvinteErro = ouvinte as (erro: Error) => void
  }
  terminate(): Promise<number> { this.encerrado = true; return Promise.resolve(0) }
  pronto(dimensao = 192): void { (this.ouvinteMensagem as (resposta: unknown) => void)({ tipo: 'pronto', dimensao }) }
  responder(embedding: Float32Array | null): void { (this.ouvinteMensagem as (resposta: unknown) => void)({ tipo: 'embedding', embedding }) }
  segmentos(segmentos: SegmentoVoz[]): void { (this.ouvinteMensagem as (resposta: unknown) => void)({ tipo: 'segmentos', segmentos }) }
  cair(erro: Error): void { this.ouvinteErro?.(erro) }
}

async function montar(threads: number) {
  const trabalhadores: TrabalhadorFalso[] = []
  const aoQuebrar = vi.fn()
  const promessa = criarExtratorTitanet({ modelo: '/m.onnx', modeloSegmentacao: '/s.onnx', threads, aoQuebrar }, (modelo, segmentação) => {
    expect(modelo).toBe('/m.onnx')
    expect(segmentação).toBe('/s.onnx')
    const trabalhador = new TrabalhadorFalso()
    trabalhadores.push(trabalhador)
    return trabalhador
  })
  trabalhadores.forEach((trabalhador) => trabalhador.pronto())
  return { extrator: await promessa, trabalhadores, aoQuebrar }
}

describe('criarExtratorTitanet', () => {
  it('espera todas as threads carregarem o modelo e informa a dimensão', async () => {
    const { extrator, trabalhadores } = await montar(2)
    expect(trabalhadores).toHaveLength(2)
    expect(extrator.dimensao).toBe(192)
  })

  it('entrega o áudio a uma thread livre e devolve o embedding dela', async () => {
    const { extrator, trabalhadores } = await montar(2)
    const primeira = extrator.embutir(new Float32Array([1, 2]))
    const segunda = extrator.embutir(new Float32Array([3]))
    expect(trabalhadores.map((trabalhador) => trabalhador.recebidos.length)).toEqual([1, 1])
    trabalhadores[0]!.responder(Float32Array.of(0.5))
    trabalhadores[1]!.responder(null)
    expect(await primeira).toEqual(Float32Array.of(0.5))
    expect(await segunda).toBeNull()
  })

  it('enfileira quando todas as threads estão ocupadas', async () => {
    const { extrator, trabalhadores } = await montar(1)
    const a = extrator.embutir(new Float32Array([1]))
    const b = extrator.embutir(new Float32Array([2]))
    expect(trabalhadores[0]!.recebidos).toHaveLength(1)
    trabalhadores[0]!.responder(Float32Array.of(1))
    await a
    expect(trabalhadores[0]!.recebidos).toHaveLength(2)
    trabalhadores[0]!.responder(Float32Array.of(2))
    expect(await b).toEqual(Float32Array.of(2))
  })

  it('quebra tudo se uma thread cai: rejeita o que está em andamento e na fila e avisa uma vez', async () => {
    const { extrator, trabalhadores, aoQuebrar } = await montar(1)
    const emAndamento = extrator.embutir(new Float32Array([1]))
    const naFila = extrator.embutir(new Float32Array([2]))
    const queda = new Error('caiu')
    trabalhadores[0]!.cair(queda)
    trabalhadores[0]!.cair(new Error('de novo'))
    await expect(emAndamento).rejects.toBe(queda)
    await expect(naFila).rejects.toBe(queda)
    await expect(extrator.embutir(new Float32Array([3]))).rejects.toBe(queda)
    expect(aoQuebrar).toHaveBeenCalledTimes(1)
  })

  it('falha ao criar se uma thread cai antes de ficar pronta', async () => {
    const trabalhadores: TrabalhadorFalso[] = []
    const aoQuebrar = vi.fn()
    const promessa = criarExtratorTitanet({ modelo: '/m.onnx', modeloSegmentacao: '/s.onnx', threads: 1, aoQuebrar }, () => {
      const trabalhador = new TrabalhadorFalso()
      trabalhadores.push(trabalhador)
      return trabalhador
    })
    await esperar()
    trabalhadores[0]!.cair(new Error('modelo ausente'))
    await expect(promessa).rejects.toThrow('modelo ausente')
    expect(aoQuebrar).toHaveBeenCalledTimes(1)
  })

  it('segmentação e embeddings compartilham fila e preservam o tipo do resultado', async () => {
    const { extrator, trabalhadores } = await montar(1)
    const a = extrator.segmentar(Float32Array.of(1))
    const b = extrator.embutir(Float32Array.of(2))
    const c = extrator.segmentar(Float32Array.of(3))
    expect(trabalhadores[0]!.recebidos[0]!.tipo).toBe('segmentos')
    const segmentos = [{ start: 0.2, end: 1.2, speaker: 0 }]
    trabalhadores[0]!.segmentos(segmentos)
    expect(await a).toEqual(segmentos)
    expect(trabalhadores[0]!.recebidos[1]!.tipo).toBe('embedding')
    trabalhadores[0]!.responder(null)
    expect(await b).toBeNull()
    trabalhadores[0]!.segmentos([])
    expect(await c).toEqual([])
  })

  it('rejeita segmentação em andamento e na fila quando o trabalhador falha', async () => {
    const { extrator, trabalhadores } = await montar(1)
    const a = extrator.segmentar(Float32Array.of(1))
    const b = extrator.segmentar(Float32Array.of(2))
    const erro = new Error('segmentador falhou')
    trabalhadores[0]!.cair(erro)
    await expect(a).rejects.toBe(erro)
    await expect(b).rejects.toBe(erro)
    await expect(extrator.segmentar(Float32Array.of(3))).rejects.toBe(erro)
  })

  it.each(['embedding', 'segmentos'] as const)('resposta incompatível com pedido %s quebra o extrator', async tipo => {
    const { extrator, trabalhadores, aoQuebrar } = await montar(1)
    const resultado = tipo === 'embedding' ? extrator.embutir(Float32Array.of(1)) : extrator.segmentar(Float32Array.of(1))
    if (tipo === 'embedding') trabalhadores[0]!.segmentos([])
    else trabalhadores[0]!.responder(null)
    await expect(resultado).rejects.toThrow('Resposta incompatível')
    expect(aoQuebrar).toHaveBeenCalledOnce()
  })

  it('encerra todas as threads', async () => {
    const { extrator, trabalhadores } = await montar(2)
    await extrator.encerrar()
    expect(trabalhadores.every((trabalhador) => trabalhador.encerrado)).toBe(true)
  })
})
