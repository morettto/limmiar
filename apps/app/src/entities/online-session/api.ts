import { request, type ProblemResult } from '../../shared/api/client'

export interface ConviteOnline {
  roomId: string
  professionalToken: string
  patientToken: string
  expiresAt: string
}

export async function criarSessaoOnline(baseUrl: string, accountId: string, accessToken: string, patientId: string): Promise<{ ok: true; convite: ConviteOnline } | ProblemResult> {
  const result = await request(baseUrl, 'POST', `/accounts/${accountId}/patients/${patientId}/online-sessions`, undefined, accessToken)
  if (!result.ok) return result
  return { ok: true, convite: await result.response.json() as ConviteOnline }
}

export async function encerrarSessaoOnline(baseUrl: string, accountId: string, accessToken: string, roomId: string): Promise<{ ok: true } | ProblemResult> {
  const result = await request(baseUrl, 'DELETE', `/accounts/${accountId}/online-sessions/${roomId}`, undefined, accessToken)
  return result.ok ? { ok: true } : result
}
