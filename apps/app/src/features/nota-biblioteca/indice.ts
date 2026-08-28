import MiniSearch, { type Options } from 'minisearch'
import type { Nota } from '../../entities/nota/nota'

export interface DocNota {
  id: string
  patientId: string
  texto: string
}

// `Options<DocNota>` (não `as const`) de propósito: os tipos de `minisearch` querem
// `fields`/`storeFields` mutáveis (`string[]`), e uma tupla `readonly` de `as const` não é
// atribuível a isso. Mesmo sem `as const`, isto continua a ser uma única constante
// exportada -- `construirIndice` e `carregarIndice` (abaixo) têm de a reusar literalmente,
// nunca redeclarar `{ fields: [...], storeFields: [...] }` cada um a seu lado: o teste de
// roundtrip (construir -> serializar -> carregar -> buscar) é o que trava esse invariante --
// separar as opções faria o `carregarIndice` reidratar um índice cujos campos indexados/
// guardados não batem com os que `construirIndice` de facto usou, e a busca por um termo
// que só existe fora do campo indexado passaria a devolver algo diferente do que devolvia
// antes de serializar.
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

// Os três estados não são intercambiáveis: `a-preparar` (índice ainda `null`, nada para
// mostrar) e `pronto` com `ids: []` (índice existe, buscou, não achou nada) parecem "sem
// resultado" na UI, mas são estados diferentes -- confundi-los é exatamente o "sem
// resultados enganoso" que o critério de aceite 2 proíbe (mostrar "nada encontrado"
// enquanto o índice ainda nem carregou). `ocioso` (termo vazio) é o terceiro, distinto dos
// outros dois: mostra a biblioteca inteira, não uma busca vazia.
export function buscar(indice: MiniSearch<DocNota> | null, termo: string): ResultadoBusca {
  if (indice === null) {
    return { estado: 'a-preparar' }
  }
  if (termo.trim() === '') {
    return { estado: 'ocioso' }
  }
  return { estado: 'pronto', ids: indice.search(termo).map((resultado) => String(resultado.id)) }
}
