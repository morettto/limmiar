export type PatientRisk = 'elevado' | 'moderado' | 'baixo'

export interface SealedSummary {
  patientId: string
  wrappedDek: Uint8Array<ArrayBuffer>
  ciphertext: Uint8Array<ArrayBuffer>
}

export type SummaryResult =
  | { patientId: string; ok: true; name: string; risk: PatientRisk }
  | { patientId: string; ok: false }

export const RISK_ORDER: Record<PatientRisk, number> = { elevado: 0, moderado: 1, baixo: 2 }

const KNOWN_RISKS = new Set<PatientRisk>(['elevado', 'moderado', 'baixo'])

/** Fails closed: any malformed input (bad JSON, wrong shape, unknown risk, empty name) returns null, never throws, never defaults a risk. */
export function parseSummaryPlaintext(bytes: Uint8Array): { name: string; risk: PatientRisk } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }

  const { name, risk } = parsed as { name?: unknown; risk?: unknown }
  if (typeof name !== 'string' || name.length === 0) {
    return null
  }
  if (typeof risk !== 'string' || !KNOWN_RISKS.has(risk as PatientRisk)) {
    return null
  }

  return { name, risk: risk as PatientRisk }
}

/** Pure: does not mutate `results`. Ascending by risk, ties by name (pt-BR); ok:false items always sort last, stable among themselves. */
export function sortByRisk(results: SummaryResult[]): SummaryResult[] {
  return [...results].sort((a, b) => {
    if (a.ok && b.ok) {
      const riskDiff = RISK_ORDER[a.risk] - RISK_ORDER[b.risk]
      return riskDiff !== 0 ? riskDiff : a.name.localeCompare(b.name, 'pt-BR')
    }
    if (a.ok !== b.ok) {
      return a.ok ? -1 : 1
    }
    return 0
  })
}
