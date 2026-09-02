import MiniSearch, { type Options } from 'minisearch'
import type { Nota } from '../../entities/nota/nota'

export interface DocNota {
  id: string
  patientId: string
  texto: string
}

// `Options<DocNota>` sem `as const`: os tipos de `minisearch` querem `fields`/`storeFields`
// mutáveis. `construirIndice` e `carregarIndice` têm de reusar esta constante literalmente — opções
// separadas reidratariam um índice com campos diferentes dos indexados, e a busca mudaria.
export const OPCOES_INDICE: Options<DocNota> = { fields: ['texto'], storeFields: ['patientId'] }

/** Concatena o texto de todas as frases da nota (ordem de `nota.frases`, já em `ORDEM_SECOES`
 *  -- ver `entities/nota/nota.ts`) num único campo buscável. */
export function notaParaDoc(nota: Nota): DocNota {
  return {
    id: nota.id,
    patientId: nota.patientId,
    texto: nota.frases.map((frase) => frase.texto).join(' '),
  }
}

export function construirIndice(docs: readonly DocNota[]): MiniSearch<DocNota> {
  const indice = new MiniSearch<DocNota>(OPCOES_INDICE)
  indice.addAll(docs)
  return indice
}

export function serializarIndice(indice: MiniSearch<DocNota>): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(indice.toJSON()))
}

export function carregarIndice(json: Uint8Array): MiniSearch<DocNota> {
  return MiniSearch.loadJSON<DocNota>(new TextDecoder().decode(json), OPCOES_INDICE)
}

export type ResultadoBusca =
  | { estado: 'a-preparar' }
  | { estado: 'ocioso' }
  | { estado: 'pronto'; ids: readonly string[] }

// Os três estados não são intercambiáveis: `a-preparar` (índice ainda `null`) e `pronto` com
// `ids: []` parecem iguais na UI mas não são — confundi-los é o "sem resultados enganoso" que o
// critério 2 proíbe. `ocioso` (termo vazio) mostra a biblioteca inteira, não uma busca vazia.
export function buscar(indice: MiniSearch<DocNota> | null, termo: string): ResultadoBusca {
  if (indice === null) {
    return { estado: 'a-preparar' }
  }
  if (termo.trim() === '') {
    return { estado: 'ocioso' }
  }
  return { estado: 'pronto', ids: indice.search(termo).map((resultado) => String(resultado.id)) }
}
