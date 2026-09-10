const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000

export interface SessaoAgendada {
  readonly sessionId: string
  readonly patientId: string
  /** ISO 8601 — o StartsAt de ScheduledSessionResponse. */
  readonly inicioEm: string
  readonly duracaoMinutos: number
  /** ScheduledSessionResponse.CancelledAt. */
  readonly canceladaEm: string | null
}

/** Pura. A de menor inicioEm que ainda não passou e não está cancelada; null se não houver. */
export function proximaSessao(sessoes: readonly SessaoAgendada[], agora: Date): SessaoAgendada | null {
  const agoraMs = agora.getTime()
  const candidatas = sessoes.filter(
    (sessao) => sessao.canceladaEm === null && new Date(sessao.inicioEm).getTime() >= agoraMs,
  )
  if (candidatas.length === 0) {
    return null
  }
  return candidatas.reduce((menor, atual) =>
    new Date(atual.inicioEm).getTime() < new Date(menor.inicioEm).getTime() ? atual : menor,
  )
}

/** Pura. Conta as não canceladas entre agora e agora + 7d. É o KPI, não uma vista de agenda. */
export function sessoesNaSemana(sessoes: readonly SessaoAgendada[], agora: Date): number {
  const agoraMs = agora.getTime()
  const limiteMs = agoraMs + SETE_DIAS_MS
  return sessoes.filter((sessao) => {
    if (sessao.canceladaEm !== null) {
      return false
    }
    const inicioMs = new Date(sessao.inicioEm).getTime()
    return inicioMs >= agoraMs && inicioMs < limiteMs
  }).length
}

// Fora de um `.tsx` (`entities/agenda/sessao.ts` é `.ts` puro), como `entities/nota/nota.ts` --
// os literais `'2-digit'` disparariam lingui/no-unlocalized-strings se vivessem no widget.
export function horaDaSessao(inicioEm: string, locale: string): string {
  return new Date(inicioEm).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}
