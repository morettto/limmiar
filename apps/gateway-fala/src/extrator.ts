export interface Extrator {
  readonly dimensao: number
  // null: o áudio não rendeu uma impressão de voz válida. Rejeita só se o próprio extrator quebrou.
  embutir(pcm: Float32Array): Promise<Float32Array | null>
  encerrar(): Promise<void>
}

type Resposta = { tipo: 'pronto'; dimensao: number } | { tipo: 'embedding'; embedding: Float32Array | null }

export interface TrabalhadorDeVoz {
  postMessage(pcm: Float32Array, transferiveis: ArrayBuffer[]): void
  on(evento: 'message', ouvinte: (resposta: Resposta) => void): unknown
  on(evento: 'error', ouvinte: (erro: Error) => void): unknown
  terminate(): Promise<number>
}

interface Tarefa { pcm: Float32Array; resolver(embedding: Float32Array | null): void; rejeitar(erro: Error): void }

// O TitaNet roda em threads próprias para não travar a retransmissão do áudio; cada uma carrega o modelo uma vez.
// Se uma thread cai, o extrator inteiro quebra e `aoQuebrar` decide (em produção, o processo sai e o orquestrador o reinicia).
export async function criarExtratorTitanet(opcoes: { modelo: string; threads: number; aoQuebrar(erro: Error): void },
  fabrica: (modelo: string) => TrabalhadorDeVoz): Promise<Extrator> {
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
      trabalhador.postMessage(tarefa.pcm, [tarefa.pcm.buffer as ArrayBuffer])
    }
  }

  const trabalhadores = await Promise.all(Array.from({ length: opcoes.threads }, () => new Promise<TrabalhadorDeVoz>((pronto, falhou) => {
    const trabalhador = fabrica(opcoes.modelo)
    trabalhador.on('error', (erro) => { falhou(erro); quebrar(erro) })
    trabalhador.on('message', (resposta) => {
      if (resposta.tipo === 'pronto') {
        dimensao = resposta.dimensao
        livres.push(trabalhador)
        pronto(trabalhador)
        return
      }
      const tarefa = emAndamento.get(trabalhador)!
      emAndamento.delete(trabalhador)
      livres.push(trabalhador)
      tarefa.resolver(resposta.embedding)
      despachar()
    })
  })))

  return {
    dimensao,
    embutir: (pcm) => quebrado ? Promise.reject(quebrado) : new Promise((resolver, rejeitar) => {
      fila.push({ pcm, resolver, rejeitar })
      despachar()
    }),
    encerrar: async () => { await Promise.all(trabalhadores.map((trabalhador) => trabalhador.terminate())) },
  }
}
