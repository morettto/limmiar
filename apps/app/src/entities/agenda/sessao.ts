export const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000

export interface SessaoAgendada {
  readonly sessionId: string
  readonly patientId: string
  /** ISO 8601 — o StartsAt de ScheduledSessionListItem. */
  readonly inicioEm: string
  readonly duracaoMinutos: number
}

/** Pura. As que ainda não começaram, na mesma ordem do contrato (ORDER BY starts_at) --
 *  não reordena. Uma cancelada nunca chega aqui (o GET já as exclui). */
function porComecar(sessoes: readonly SessaoAgendada[], agora: Date): SessaoAgendada[] {
  const agoraMs = agora.getTime()
  return sessoes.filter((sessao) => new Date(sessao.inicioEm).getTime() >= agoraMs)
}

/** Pura. A primeira por começar; null se não houver. */
export function proximaSessao(sessoes: readonly SessaoAgendada[], agora: Date): SessaoAgendada | null {
  return porComecar(sessoes, agora)[0] ?? null
}

/** Pura. Conta as que ainda não começaram. A janela de 7 dias é do pedido ao backend, não
 *  recortada aqui de novo — ver README, "a janela é do pedido". */
export function sessoesNaSemana(sessoes: readonly SessaoAgendada[], agora: Date): number {
  return porComecar(sessoes, agora).length
}

// Fora de um `.tsx` (`entities/agenda/sessao.ts` é `.ts` puro), como `entities/nota/nota.ts` --
// os literais `'2-digit'` disparariam lingui/no-unlocalized-strings se vivessem no widget.
export function horaDaSessao(inicioEm: string, locale: string): string {
  return new Date(inicioEm).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}
