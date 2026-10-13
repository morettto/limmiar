import { request, type ProblemResult } from '../../shared/api'
import type { SessaoAgendada } from './sessao'

export type ListarSessoesResult = { ok: true; sessoes: SessaoAgendada[] } | ProblemResult
export type SalvarSessaoResult = { ok: true } | ProblemResult

export type AgendarSessaoResult = { ok: true; sessionId: string } | ProblemResult

export async function agendarSessao(baseUrl: string, accountId: string, accessToken: string,
  patientId: string, startsAt: string, durationMinutes: number): Promise<AgendarSessaoResult> {
  const result = await request(baseUrl, 'POST', `/accounts/${accountId}/agenda/sessions`,
    { patientId, startsAt, durationMinutes }, accessToken)
  if (!result.ok) return result
  const { sessionId } = (await result.response.json()) as { sessionId: string }
  return { ok: true, sessionId }
}

export function remarcarSessao(baseUrl: string, accountId: string, accessToken: string,
  sessionId: string, startsAt: string, durationMinutes: number): Promise<SalvarSessaoResult> {
  return request(baseUrl, 'PATCH', `/accounts/${accountId}/agenda/sessions/${sessionId}`,
    { startsAt, durationMinutes }, accessToken)
}

export function cancelarSessao(baseUrl: string, accountId: string, accessToken: string, sessionId: string): Promise<SalvarSessaoResult> {
  return request(baseUrl, 'DELETE', `/accounts/${accountId}/agenda/sessions/${sessionId}`, undefined, accessToken)
}

// de/ate viram `from`/`to` via toISOString + encodeURIComponent -- o backend faz parse
// de string, não liga direto a DateTimeOffset (ver Scheduling/README.md).
export async function listarSessoes(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  de: Date,
  ate: Date,
): Promise<ListarSessoesResult> {
  const from = encodeURIComponent(de.toISOString())
  const to = encodeURIComponent(ate.toISOString())
  const result = await request(
    baseUrl,
    'GET',
    `/accounts/${accountId}/agenda/sessions?from=${from}&to=${to}`,
    undefined,
    accessToken,
  )

  if (!result.ok) {
    return result
  }

  const body = (await result.response.json()) as {
    sessions: { sessionId: string; patientId: string; startsAt: string; durationMinutes: number }[]
  }
  return {
    ok: true,
    sessoes: body.sessions.map((sessao) => ({
      sessionId: sessao.sessionId,
      patientId: sessao.patientId,
      inicioEm: sessao.startsAt,
      duracaoMinutos: sessao.durationMinutes,
    })),
  }
}
