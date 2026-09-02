import MiniSearch, { type AsPlainObject, type Options } from 'minisearch'
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
