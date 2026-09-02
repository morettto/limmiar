import MiniSearch, { type AsPlainObject, type Options } from 'minisearch'
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

/** `id:revisao` de cada nota, ordenados -- a ordem de `notas` não pode mudar a impressão.
 *  Valor vive dentro do blob selado (envelope de `serializarIndice`); nunca sai daí. */
export function impressaoDigital(notas: readonly Nota[]): string {
  return notas
    .map((nota) => `${nota.id}:${nota.revisao}`)
    .sort()
    .join('|')
}

export function construirIndice(docs: readonly DocNota[]): MiniSearch<DocNota> {
  const indice = new MiniSearch<DocNota>(OPCOES_INDICE)
  indice.addAll(docs)
  return indice
}

export function serializarIndice(indice: MiniSearch<DocNota>, impressao: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify({ impressao, indice: indice.toJSON() }))
}

/** `null` quando a impressão do envelope não bate com `impressao` -- inclui um blob antigo
 *  sem envelope (`impressao === undefined`), que cai no mesmo `!==` sem ramo especial. */
export function carregarIndice(json: Uint8Array, impressao: string): MiniSearch<DocNota> | null {
  const envelope = JSON.parse(new TextDecoder().decode(json)) as { impressao?: string; indice: AsPlainObject }
  if (envelope.impressao !== impressao) {
    return null
  }
  // `loadJS`, não `loadJSON`: o objeto já foi parseado acima, não voltamos a stringify-lo.
  return MiniSearch.loadJS<DocNota>(envelope.indice, OPCOES_INDICE)
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
