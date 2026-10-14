export interface Atendimento {
  readonly id: string
  readonly patientId: string
  readonly agendamentoId: string
  readonly iniciadoEm: string
  readonly encerradoEm?: string
}

export interface EncerramentoAtendimento {
  atendimentoId: string
  encerradoEm: string
  autorId: string
}

export function encerramentoParaEntrada(encerramento: EncerramentoAtendimento): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify({ tipo: 'encerramento-atendimento', ...encerramento }))
}

export function lerEncerramento(bytes: Uint8Array<ArrayBuffer>): EncerramentoAtendimento | null {
  let valor: unknown
  try { valor = JSON.parse(new TextDecoder().decode(bytes)) } catch { return null }
  if (typeof valor !== 'object' || valor === null) return null
  const { tipo, atendimentoId, encerradoEm, autorId } = valor as Record<string, unknown>
  if (tipo !== 'encerramento-atendimento' || !naoVazio(atendimentoId) || !naoVazio(autorId) ||
    typeof encerradoEm !== 'string' || !Number.isFinite(Date.parse(encerradoEm))) return null
  return { atendimentoId, encerradoEm, autorId }
}

export function atendimentoParaEntrada(atendimento: Atendimento): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify({ tipo: 'atendimento', atendimentoId: atendimento.id,
    agendamentoId: atendimento.agendamentoId, iniciadoEm: atendimento.iniciadoEm }))
}

// Abas da página da sessão (`?aba=`): constantes, porque um .tsx não escreve o literal sem o lint de i18n.
export const ABA_INSIGHTS = 'insights'
export const ABA_NOTA = 'nota'
export type AbaDoAtendimento = typeof ABA_INSIGHTS | typeof ABA_NOTA

// Fora de um .tsx: os literais de Intl dispararam lingui/no-unlocalized-strings dentro da tela.
export const FORMATO_DATA_ATENDIMENTO: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }

const naoVazio =(valor: unknown): valor is string => typeof valor === 'string' && valor.trim() !== ''

export function lerAtendimento(bytes: Uint8Array<ArrayBuffer>, patientId: string): Atendimento | null {
  let body: unknown
  try { body = JSON.parse(new TextDecoder().decode(bytes)) } catch { return null }
  if (typeof body !== 'object' || body === null) return null
  const { tipo, atendimentoId, agendamentoId, iniciadoEm } = body as Record<string, unknown>
  if (tipo !== 'atendimento' || !naoVazio(atendimentoId) || !naoVazio(agendamentoId) ||
    typeof iniciadoEm !== 'string' || !Number.isFinite(Date.parse(iniciadoEm))) return null
  return { id: atendimentoId, patientId, agendamentoId, iniciadoEm }
}
