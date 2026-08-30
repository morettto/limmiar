import { request, type ProblemResult } from '../../shared/api'

export type Finalidade = 'gravacao' | 'analiseIa'
export type Decisao = 'concedido' | 'revogado'
// Fonte unica do union. O array `as const` e o tipo derivado dele evitam a lista escrita duas
// vezes -- quem acrescentar uma variante aqui muda tipo e parser na mesma linha.
export const ESTADOS_CONSENTIMENTO = ['pendente', 'concedido', 'revogado'] as const
export type EstadoConsentimento = (typeof ESTADOS_CONSENTIMENTO)[number]

// Fronteira de confianca: entrada nao confiavel (query string do andaime e2e, corpo de resposta).
// Qualquer valor fora do union -- incluindo ausente -- cai no estado mais restritivo, o mesmo
// default que o servidor usa sem eventos (Api.Consent.ConsentState.Fold).
export function parseEstadoConsentimento(value: unknown): EstadoConsentimento {
  return ESTADOS_CONSENTIMENTO.includes(value as EstadoConsentimento) ? (value as EstadoConsentimento) : 'pendente'
}

export interface ConsentimentosDoPaciente {
  gravacao: EstadoConsentimento
  analiseIa: EstadoConsentimento
}

export type RegistrarConsentimentoResult =
  | { ok: true; finalidade: Finalidade; decisao: Decisao; registradoEm: string }
  | ProblemResult

export async function registrarConsentimento(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  patientId: string,
  params: { finalidade: Finalidade; decisao: Decisao },
): Promise<RegistrarConsentimentoResult> {
  const result = await request(
    baseUrl,
    'POST',
    `/accounts/${accountId}/patients/${patientId}/consents`,
    { purpose: params.finalidade, decision: params.decisao },
    accessToken,
  )

  if (!result.ok) {
    return result
  }

  const body = (await result.response.json()) as { purpose: Finalidade; decision: Decisao; recordedAt: string }
  return { ok: true, finalidade: body.purpose, decisao: body.decision, registradoEm: body.recordedAt }
}

export type ObterConsentimentosResult = { ok: true; consentimentos: ConsentimentosDoPaciente } | ProblemResult

export async function obterConsentimentos(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  patientId: string,
): Promise<ObterConsentimentosResult> {
  const result = await request(
    baseUrl,
    'GET',
    `/accounts/${accountId}/patients/${patientId}/consents`,
    undefined,
    accessToken,
  )

  if (!result.ok) {
    return result
  }

  const consentimentos = (await result.response.json()) as ConsentimentosDoPaciente
  return { ok: true, consentimentos }
}
