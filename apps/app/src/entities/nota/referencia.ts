import { ESTADO_ASSINADA, type Nota, type ReferenciaBibliografica } from './nota'

export interface PropostaReferencia {
  readonly patientId: string
  readonly inicioMs: number
  readonly fimMs: number
  readonly referencia: ReferenciaBibliografica
}

export function lerReferencia(valor: unknown): ReferenciaBibliografica | null {
  if (typeof valor !== 'object' || valor === null) return null
  const { trechoId, titulo, autor, pagina, paragrafo, citacaoLiteral, transcriptId, revisaoTranscricao, frasePaciente } = valor as Record<string, unknown>
  if ([trechoId, titulo, autor, citacaoLiteral, transcriptId, frasePaciente].some(item => typeof item !== 'string' || !item.trim()) ||
    typeof pagina !== 'number' || !Number.isSafeInteger(pagina) || pagina < 1 ||
    typeof paragrafo !== 'number' || !Number.isSafeInteger(paragrafo) || paragrafo < 1 ||
    typeof revisaoTranscricao !== 'number' || !Number.isSafeInteger(revisaoTranscricao) || revisaoTranscricao < 0) return null
  return { trechoId: trechoId as string, titulo: titulo as string, autor: autor as string, pagina, paragrafo,
    citacaoLiteral: citacaoLiteral as string, transcriptId: transcriptId as string, revisaoTranscricao, frasePaciente: frasePaciente as string }
}

export function adicionarReferencia(nota: Nota, proposta: PropostaReferencia, texto: string): Nota {
  if (nota.estado === ESTADO_ASSINADA || nota.patientId !== proposta.patientId || !lerReferencia(proposta.referencia) ||
    !Number.isFinite(proposta.inicioMs) || !Number.isFinite(proposta.fimMs) || proposta.inicioMs < 0 || proposta.fimMs < proposta.inicioMs) {
    throw new Error('Referência não corresponde à nota editável.')
  }
  if (nota.frases.some(frase => frase.referencias?.some(referencia => referencia.trechoId === proposta.referencia.trechoId &&
    referencia.transcriptId === proposta.referencia.transcriptId && referencia.revisaoTranscricao === proposta.referencia.revisaoTranscricao &&
    referencia.frasePaciente === proposta.referencia.frasePaciente))) return nota
  return { ...nota, revisao: nota.revisao + 1, frases: [...nota.frases, {
    id: crypto.randomUUID(), secao: 'A', texto, ancoras: [{ inicioMs: proposta.inicioMs, fimMs: proposta.fimMs }],
    referencias: [{ ...proposta.referencia }],
  }] }
}
