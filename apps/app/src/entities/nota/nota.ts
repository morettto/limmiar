import type { Afirmacao, Ancora } from '@limmiar/copilot'
import { webcrypto } from '@limmiar/crypto'

export type SecaoSoap = 'S' | 'O' | 'A' | 'P'

export interface FraseNota {
  readonly id: string
  readonly secao: SecaoSoap
  readonly texto: string
  readonly ancoras: readonly Ancora[]
}

export type EstadoNota = 'pendente' | 'assinada'

// Constantes (não literais inline): lingui/no-unlocalized-strings varre todo `.tsx` à
// procura de texto visível não traduzido; um `const` SCREAMING_SNAKE_CASE já está isento
// por convenção deste repo (ver eslint.config.mjs) -- mais barato do que alargar a lista de
// ignoreNames para um par de valores tão locais a este módulo. Movidas para aqui (fatia
// S08-06) porque `estado` passou a viver em `Nota`, não só em `ItemFila`/FilaAssinatura.
export const ESTADO_PENDENTE: EstadoNota = 'pendente'
export const ESTADO_ASSINADA: EstadoNota = 'assinada'

export interface Nota {
  readonly id: string
  readonly patientId: string
  readonly revisao: number
  readonly frases: readonly FraseNota[]
  readonly estado: EstadoNota
}

// Exportada (fatia 2, S08-01): EditorSoap.tsx/NotaPage.tsx reusam esta mesma ordem em vez
// de a redeclararem -- um `.tsx` a repetir o literal ['S', 'O', 'A', 'P'] dispararia
// lingui/no-unlocalized-strings (a checagem de texto visível só corre em `.tsx`; este
// ficheiro, puro `.ts`, está fora do seu alcance), e duplicar a ordem das secções por três
// ficheiros é o tipo de deriva que só precisa de um import para não acontecer.
export const ORDEM_SECOES: readonly SecaoSoap[] = ['S', 'O', 'A', 'P']

export function rascunhoParaNota(
  id: string,
  patientId: string,
  porSecao: Record<SecaoSoap, readonly Afirmacao[]>,
): Nota {
  const frases = ORDEM_SECOES.flatMap((secao) =>
    porSecao[secao].map((afirmacao, indice) => ({
      id: `${secao}-${indice}`,
      secao,
      texto: afirmacao.texto,
      ancoras: afirmacao.ancoras,
    })),
  )
  return { id, patientId, revisao: 0, frases, estado: ESTADO_PENDENTE }
}

// fraseId inexistente lança em vez de devolver a nota inalterada: um id que já não bate
// certo (secção reordenada, nota errada, bug de chamador) é um estado que quer falhar no
// ponto onde foi cometido, não persistir em silêncio uma edição que nunca aconteceu.
export function editarFrase(nota: Nota, fraseId: string, texto: string): Nota {
  const indice = nota.frases.findIndex((frase) => frase.id === fraseId)
  if (indice === -1) {
    throw new Error(`nota ${nota.id} não tem frase com id ${fraseId}`)
  }
  const frases = nota.frases.map((frase, i) => (i === indice ? { ...frase, texto } : frase))
  return { ...nota, revisao: nota.revisao + 1, frases }
}

// Forma comum a `textoCanonico` (abaixo) e `notaParaEntrada` (nota-crypto.ts): secção,
// texto e âncoras de cada frase, sem id da frase. Extraído porque os dois serializadores
// copiavam este map byte a byte -- um campo novo em `FraseNota` atualizado só num dos dois
// divergiria em silêncio, sem teste a apanhar. Cada chamador continua a decidir sozinho o
// que envolve isto (revisao/noteId/tipo): a saída dos dois não pode mudar um único byte,
// assinaturas já produzidas dependem disso.
export function serializarFrases(frases: readonly FraseNota[]): { secao: SecaoSoap; texto: string; ancoras: { inicioMs: number; fimMs: number }[] }[] {
  return frases.map((frase) => ({
    secao: frase.secao,
    texto: frase.texto,
    ancoras: frase.ancoras.map((ancora) => ({ inicioMs: ancora.inicioMs, fimMs: ancora.fimMs })),
  }))
}

// Cobre secção, texto e âncoras de cada frase, e revisão — exatamente o que a assinatura
// (fatia 4) tem de atestar. id da frase, id/patientId da nota ficam de fora de propósito:
// não fazem parte da superfície combinada aqui. JSON.stringify de um objeto literal com
// chaves sempre construídas na mesma ordem é determinístico para o mesmo shape, então não
// precisa de um serializador próprio.
export function textoCanonico(nota: Nota): string {
  return JSON.stringify({
    revisao: nota.revisao,
    frases: serializarFrases(nota.frases),
  })
}

// Reusa packages/crypto (webcrypto.sha256) em vez de chamar crypto.subtle.digest
// diretamente — esse pacote é o dono de todo wrapper de primitiva criptográfica no
// monorepo, e agora expõe SHA-256 nele por causa exatamente deste chamador.
export function digestNota(nota: Nota): Promise<Uint8Array<ArrayBuffer>> {
  return webcrypto.sha256(new TextEncoder().encode(textoCanonico(nota)))
}
