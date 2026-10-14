import { ORDEM_SECOES, ESTADO_PENDENTE, type Nota, type SecaoSoap } from './nota'
import { lerReferencia } from './referencia'

export function lerNota(bytes: Uint8Array, patientId: string): Nota | null {
  let valor: unknown = null
  try { valor = JSON.parse(new TextDecoder().decode(bytes)) } catch { /* texto que não é JSON continua null e é recusado abaixo */ }
  if (!valor) return null
  const { tipo, noteId, atendimentoId, revisao, frases } = valor as Record<string, unknown>
  if (tipo !== 'nota' || typeof noteId !== 'string' || noteId === '' || typeof atendimentoId !== 'string' || atendimentoId === '' ||
    !Number.isSafeInteger(revisao) || (revisao as number) < 0 || !Array.isArray(frases)) return null
  const itens: Nota['frases'][number][] = []
  for (const [indice, frase] of frases.entries()) {
    if (!frase) return null
    const { secao, texto, ancoras, referencias } = frase as Record<string, unknown>
    if (!ORDEM_SECOES.includes(secao as SecaoSoap) || typeof texto !== 'string' || !Array.isArray(ancoras)) return null
    const marcas: { inicioMs: number; fimMs: number }[] = []
    for (const ancora of ancoras) {
      if (!ancora) return null
      const { inicioMs, fimMs } = ancora as Record<string, unknown>
      if (!Number.isFinite(inicioMs) || !Number.isFinite(fimMs) || (inicioMs as number) < 0 || (fimMs as number) < (inicioMs as number)) return null
      marcas.push({ inicioMs: inicioMs as number, fimMs: fimMs as number })
    }
    const fontes = []
    if (referencias !== undefined) {
      if (!Array.isArray(referencias)) return null
      for (const valor of referencias) {
        const referencia = lerReferencia(valor)
        if (referencia === null) return null
        fontes.push(referencia)
      }
    }
    itens.push({ id: `${secao}-${indice}`, secao: secao as SecaoSoap, texto, ancoras: marcas,
      ...(referencias === undefined ? {} : { referencias: fontes }) })
  }
  return { id: noteId, patientId, atendimentoId, revisao: revisao as number, frases: itens, estado: ESTADO_PENDENTE }
}
