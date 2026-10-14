export interface SegmentoVoz { start: number; end: number; speaker: number }

export interface Extrator {
  readonly dimensao: number
  embutir(pcm: Float32Array): Promise<Float32Array | null>
  segmentar(pcm: Float32Array): Promise<SegmentoVoz[]>
  encerrar(): Promise<void>
}

export type PedidoVoz = { tipo: 'embedding' | 'segmentos'; pcm: Float32Array }
type Resposta = { tipo: 'pronto'; dimensao: number } | { tipo: 'embedding'; embedding: Float32Array | null } |
  { tipo: 'segmentos'; segmentos: SegmentoVoz[] }

export interface TrabalhadorDeVoz {
  postMessage(pedido: PedidoVoz, transferiveis: ArrayBuffer[]): void
  on(evento: 'message', ouvinte: (resposta: Resposta) => void): unknown
  on(evento: 'error', ouvinte: (erro: Error) => void): unknown
  terminate(): Promise<number>
}

interface BaseTarefa { pcm: Float32Array; rejeitar(erro: Error): void }
type Tarefa = BaseTarefa & ({ tipo: 'embedding'; resolver(embedding: Float32Array | null): void } |
  { tipo: 'segmentos'; resolver(segmentos: SegmentoVoz[]): void })

export async function criarExtratorTitanet(opcoes: { modelo: string; modeloSegmentacao: string; threads: number; aoQuebrar(erro: Error): void },
  fabrica: (modelo: string, modeloSegmentacao: string) => TrabalhadorDeVoz): Promise<Extrator> {
  const livres: TrabalhadorDeVoz[] = []
  const emAndamento = new Map<TrabalhadorDeVoz, Tarefa>()
  const fila: Tarefa[] = []
  let quebrado: Error | undefined
  let dimensao = 0

  function quebrar(erro: Error) {
    if (quebrado) return
    quebrado = erro
    for (const tarefa of [...emAndamento.values(), ...fila]) tarefa.rejeitar(erro)
    emAndamento.clear()
    fila.length = 0
    opcoes.aoQuebrar(erro)
  }

  function despachar() {
    while (fila.length > 0 && livres.length > 0) {
      const tarefa = fila.shift()!
      const trabalhador = livres.shift()!
      emAndamento.set(trabalhador, tarefa)
      trabalhador.postMessage({ tipo: tarefa.tipo, pcm: tarefa.pcm }, [tarefa.pcm.buffer as ArrayBuffer])
    }
  }

  const trabalhadores = await Promise.all(Array.from({ length: opcoes.threads }, () => new Promise<TrabalhadorDeVoz>((pronto, falhou) => {
    const trabalhador = fabrica(opcoes.modelo, opcoes.modeloSegmentacao)
    trabalhador.on('error', (erro) => { falhou(erro); quebrar(erro) })
    trabalhador.on('message', (resposta) => {
      if (resposta.tipo === 'pronto') {
        dimensao = resposta.dimensao
        livres.push(trabalhador)
        pronto(trabalhador)
        return
      }
      const tarefa = emAndamento.get(trabalhador)!
      if (tarefa.tipo === 'embedding' && resposta.tipo === 'embedding') tarefa.resolver(resposta.embedding)
      else if (tarefa.tipo === 'segmentos' && resposta.tipo === 'segmentos') tarefa.resolver(resposta.segmentos)
      else { quebrar(new Error('Resposta incompatível do extrator de voz.')); return }
      emAndamento.delete(trabalhador)
      livres.push(trabalhador)
      despachar()
    })
  })))

  return {
    dimensao,
    embutir: (pcm) => quebrado ? Promise.reject(quebrado) : new Promise((resolver, rejeitar) => {
      fila.push({ tipo: 'embedding', pcm, resolver, rejeitar })
      despachar()
    }),
    segmentar: (pcm) => quebrado ? Promise.reject(quebrado) : new Promise((resolver, rejeitar) => {
      fila.push({ tipo: 'segmentos', pcm, resolver, rejeitar })
      despachar()
    }),
    encerrar: async () => { await Promise.all(trabalhadores.map((trabalhador) => trabalhador.terminate())) },
  }
}
