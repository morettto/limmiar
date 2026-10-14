import type { Ancora } from '@limmiar/copilot'
import { webcrypto } from '@limmiar/crypto'

export type SecaoSoap = 'S' | 'O' | 'A' | 'P'

export interface ReferenciaBibliografica {
  readonly trechoId: string
  readonly titulo: string
  readonly autor: string
  readonly pagina: number
  readonly paragrafo: number
  readonly citacaoLiteral: string
  readonly transcriptId: string
  readonly revisaoTranscricao: number
  readonly frasePaciente: string
}

export interface FraseNota {
  readonly id: string
  readonly secao: SecaoSoap
  readonly texto: string
  readonly ancoras: readonly Ancora[]
  readonly referencias?: readonly ReferenciaBibliografica[]
}

// as const + tipo derivado, idioma de entities/consentimento/api.ts: nota.ts é `.ts` puro,
// fora do alcance de lingui/no-unlocalized-strings (que só varre `.tsx`).
export const ESTADO_PENDENTE = 'pendente'
export const ESTADO_ASSINADA = 'assinada'
export const ESTADOS_NOTA = [ESTADO_PENDENTE, ESTADO_ASSINADA] as const
export type EstadoNota = (typeof ESTADOS_NOTA)[number]

export interface Nota {
  readonly id: string
  readonly patientId: string
  readonly atendimentoId: string
  readonly revisao: number
  readonly frases: readonly FraseNota[]
  readonly estado: EstadoNota
}

// Exportada para EditorSoap.tsx/NotaDoAtendimento.tsx reusarem a ordem em vez de a redeclararem:
// repetir o literal num `.tsx` dispararia lingui/no-unlocalized-strings.
export const ORDEM_SECOES: readonly SecaoSoap[] = ['S', 'O', 'A', 'P']

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
export function serializarFrases(frases: readonly FraseNota[]) {
  return frases.map((frase) => ({
    secao: frase.secao,
    texto: frase.texto,
    ancoras: frase.ancoras.map((ancora) => ({ inicioMs: ancora.inicioMs, fimMs: ancora.fimMs })),
    ...(frase.referencias === undefined ? {} : { referencias: frase.referencias.map(referencia => ({
      trechoId: referencia.trechoId, titulo: referencia.titulo, autor: referencia.autor,
      pagina: referencia.pagina, paragrafo: referencia.paragrafo, citacaoLiteral: referencia.citacaoLiteral,
      transcriptId: referencia.transcriptId, revisaoTranscricao: referencia.revisaoTranscricao, frasePaciente: referencia.frasePaciente,
    })) }),
  }))
}

// Cobre atendimento, secção, texto e âncoras de cada frase, e revisão — exatamente o que a assinatura
// atesta (a nota é daquele atendimento). Os ids das frases ficam de fora de propósito. JSON.stringify de um literal com chaves sempre na mesma
// ordem é determinístico para o mesmo shape, logo não precisa de serializador próprio.
export function textoCanonico(nota: Nota): string {
  return JSON.stringify({
    atendimentoId: nota.atendimentoId,
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
