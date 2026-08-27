import { describe, expect, it } from 'vitest'
import { parseSummaryPlaintext, sortByRisk, type SummaryResult } from './patient-summary'

describe('parseSummaryPlaintext', () => {
  it('decodes valid { name, risk } JSON', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ name: 'Maria da Silva', risk: 'elevado' }))
    expect(parseSummaryPlaintext(bytes)).toEqual({ name: 'Maria da Silva', risk: 'elevado' })
  })

  it('returns null for invalid JSON (never throws)', () => {
    const bytes = new TextEncoder().encode('{not json')
    expect(parseSummaryPlaintext(bytes)).toBeNull()
  })

  it('returns null when risk is not one of the 3 known values', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ name: 'Maria da Silva', risk: 'extremo' }))
    expect(parseSummaryPlaintext(bytes)).toBeNull()
  })

  it('returns null when name is an empty string', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ name: '', risk: 'baixo' }))
    expect(parseSummaryPlaintext(bytes)).toBeNull()
  })

  it('returns null when name is missing', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ risk: 'baixo' }))
    expect(parseSummaryPlaintext(bytes)).toBeNull()
  })

  it('returns null when the top-level JSON value is not an object', () => {
    const bytes = new TextEncoder().encode(JSON.stringify('nome solto'))
    expect(parseSummaryPlaintext(bytes)).toBeNull()
  })
})

describe('sortByRisk', () => {
  it('orders elevado before moderado before baixo', () => {
    const results: SummaryResult[] = [
      { patientId: 'p-baixo', ok: true, name: 'Zeca', risk: 'baixo' },
      { patientId: 'p-elevado', ok: true, name: 'Ana', risk: 'elevado' },
      { patientId: 'p-moderado', ok: true, name: 'Bruno', risk: 'moderado' },
    ]
    expect(sortByRisk(results).map((r) => r.patientId)).toEqual(['p-elevado', 'p-moderado', 'p-baixo'])
  })

  it('breaks ties within the same risk by name (pt-BR locale compare)', () => {
    const results: SummaryResult[] = [
      { patientId: 'p-zeca', ok: true, name: 'Zeca', risk: 'elevado' },
      { patientId: 'p-amelia', ok: true, name: 'Amélia', risk: 'elevado' },
      { patientId: 'p-bruno', ok: true, name: 'Bruno', risk: 'elevado' },
    ]
    expect(sortByRisk(results).map((r) => r.patientId)).toEqual(['p-amelia', 'p-bruno', 'p-zeca'])
  })

  it('puts every ok:false item last, after all ok:true, preserving their relative order', () => {
    const results: SummaryResult[] = [
      { patientId: 'p-fail-1', ok: false },
      { patientId: 'p-baixo', ok: true, name: 'Zeca', risk: 'baixo' },
      { patientId: 'p-fail-2', ok: false },
      { patientId: 'p-elevado', ok: true, name: 'Ana', risk: 'elevado' },
    ]
    expect(sortByRisk(results).map((r) => r.patientId)).toEqual([
      'p-elevado',
      'p-baixo',
      'p-fail-1',
      'p-fail-2',
    ])
  })

  it('does not mutate the input array', () => {
    const results: SummaryResult[] = [
      { patientId: 'p-baixo', ok: true, name: 'Zeca', risk: 'baixo' },
      { patientId: 'p-elevado', ok: true, name: 'Ana', risk: 'elevado' },
    ]
    const original = [...results]
    sortByRisk(results)
    expect(results).toEqual(original)
  })
})
