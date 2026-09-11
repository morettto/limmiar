import { request, type ProblemResult } from '../../shared/api'
import type { SessaoAgendada } from './sessao'

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000

export type ListarSessoesResult = { ok: true; sessoes: SessaoAgendada[] } | ProblemResult

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

/** `listarSessoes` com a janela fixa `[agora, agora + 7 dias)` já montada. */
export function listarSessoesDaSemana(
  baseUrl: string,
  accountId: string,
  accessToken: string,
  agora: Date,
): Promise<ListarSessoesResult> {
  return listarSessoes(baseUrl, accountId, accessToken, agora, new Date(agora.getTime() + SETE_DIAS_MS))
}
