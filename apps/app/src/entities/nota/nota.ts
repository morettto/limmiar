import type { Afirmacao, Ancora } from '@limmiar/copilot'
import { webcrypto } from '@limmiar/crypto'

export type SecaoSoap = 'S' | 'O' | 'A' | 'P'

export interface FraseNota {
  readonly id: string
  readonly secao: SecaoSoap
  readonly texto: string
  readonly ancoras: readonly Ancora[]
}

// EstadoNota deriva das constantes, não o inverso -- anotá-las como EstadoNota é o que as
// alargava. Idioma de entities/consentimento/api.ts: lingui/no-unlocalized-strings só varre `.tsx`.
export const ESTADO_PENDENTE = 'pendente'
export const ESTADO_ASSINADA = 'assinada'
export const ESTADOS_NOTA = [ESTADO_PENDENTE, ESTADO_ASSINADA] as const
export type EstadoNota = (typeof ESTADOS_NOTA)[number]

export interface Nota {
  readonly id: string
  readonly patientId: string
  readonly revisao: number
  readonly frases: readonly FraseNota[]
  readonly estado: EstadoNota
}

// Exportada (fatia 2, S08-01): EditorSoap.tsx/NotaPage.tsx reusam esta ordem em vez de a
// redeclararem — repetir o literal num `.tsx` dispararia lingui/no-unlocalized-strings, e a ordem
// das secções duplicada por três ficheiros é deriva à espera de acontecer.
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

// Forma comum a `textoCanonico` (abaixo) e `notaParaEntrada` (nota-crypto.ts): secção, texto e
// âncoras de cada frase, sem id. Extraído porque os dois copiavam o map byte a byte e divergiriam
// em silêncio; a saída não pode mudar um byte, há assinaturas que dependem disso.
export function serializarFrases(frases: readonly FraseNota[]): { secao: SecaoSoap; texto: string; ancoras: { inicioMs: number; fimMs: number }[] }[] {
  return frases.map((frase) => ({
    secao: frase.secao,
    texto: frase.texto,
    ancoras: frase.ancoras.map((ancora) => ({ inicioMs: ancora.inicioMs, fimMs: ancora.fimMs })),
  }))
}

// Cobre secção, texto e âncoras de cada frase, e revisão — exatamente o que a assinatura atesta.
// Os ids ficam de fora de propósito. JSON.stringify de um literal com chaves sempre na mesma
// ordem é determinístico para o mesmo shape, logo não precisa de serializador próprio.
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
