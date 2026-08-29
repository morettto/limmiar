import { request, type ProblemResult } from '../../shared/api'

export type Finalidade = 'gravacao' | 'analiseIa'
export type Decisao = 'concedido' | 'revogado'
export type EstadoConsentimento = 'pendente' | 'concedido' | 'revogado'

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
