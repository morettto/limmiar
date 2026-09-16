import { describe, expect, it } from 'vitest'
import type { CheckIn } from '../../entities/checkin/checkin'
import type { SessaoAgendada } from '../../entities/agenda/sessao'
import { DIAS_ESPELHO, janelaDoEspelho, montarEspelho } from './espelho'

const PATIENT_ID = 'paciente-ana'

function checkin(dia: string): CheckIn {
  return { dia, sono: 3, ansiedade: 3, frase: null }
}

function sessao(p: { patientId: string; inicioEm: string }): SessaoAgendada {
  return { sessionId: crypto.randomUUID(), patientId: p.patientId, inicioEm: p.inicioEm, duracaoMinutos: 50 }
}

describe('montarEspelho', () => {
  it('a day without a shared check-in is an explicit gap, never interpolated', () => {
    const checkins = [checkin('2026-01-14'), checkin('2026-01-16')]

    const espelho = montarEspelho({ checkins, sessoes: [], patientId: PATIENT_ID, hoje: '2026-01-16' })

    const dia15 = espelho.dias.find((d) => d.dia === '2026-01-15')
    expect(dia15?.checkin).toBeNull()
  })

  it('a day with no session gets an empty array, not a missing field', () => {
    const espelho = montarEspelho({ checkins: [], sessoes: [], patientId: PATIENT_ID, hoje: '2026-01-16' })

    expect(espelho.dias.every((dia) => dia.sessoes.length === 0)).toBe(true)
  })

  it('produces DIAS_ESPELHO entries from the oldest to today', () => {
    const espelho = montarEspelho({ checkins: [], sessoes: [], patientId: PATIENT_ID, hoje: '2026-01-16' })

    expect(espelho.dias).toHaveLength(DIAS_ESPELHO)
    expect(espelho.dias[0]!.dia).toBe('2026-01-10')
    expect(espelho.dias[6]!.dia).toBe('2026-01-16')
  })

  it("a session for another patient never marks the timeline", () => {
    const minhaSessao = sessao({ patientId: PATIENT_ID, inicioEm: '2026-01-16T10:00:00.000Z' })
    const sessaoDeOutroPaciente = sessao({ patientId: 'outro-paciente', inicioEm: '2026-01-16T11:00:00.000Z' })

    const espelho = montarEspelho({
      checkins: [],
      sessoes: [minhaSessao, sessaoDeOutroPaciente],
      patientId: PATIENT_ID,
      hoje: '2026-01-16',
    })

    const hoje = espelho.dias.find((d) => d.dia === '2026-01-16')
    expect(hoje?.sessoes).toEqual([minhaSessao])
  })

  it('two sessions for the same patient on the same day both land in that day', () => {
    const primeira = sessao({ patientId: PATIENT_ID, inicioEm: '2026-01-16T10:00:00.000Z' })
    const segunda = sessao({ patientId: PATIENT_ID, inicioEm: '2026-01-16T18:00:00.000Z' })

    const espelho = montarEspelho({
      checkins: [],
      sessoes: [primeira, segunda],
      patientId: PATIENT_ID,
      hoje: '2026-01-16',
    })

    const hoje = espelho.dias.find((d) => d.dia === '2026-01-16')
    expect(hoje?.sessoes).toEqual([primeira, segunda])
  })

  it('a session lands on the local day of inicioEm, not the UTC one', () => {
    // 2026-01-16T23:30 local time (fixed offset via Date fields, not toISOString): UTC would
    // report the next day.
    const inicioLocal = new Date(2026, 0, 16, 23, 30)
    const minhaSessao = sessao({ patientId: PATIENT_ID, inicioEm: inicioLocal.toISOString() })

    const espelho = montarEspelho({
      checkins: [],
      sessoes: [minhaSessao],
      patientId: PATIENT_ID,
      hoje: '2026-01-16',
    })

    const hoje = espelho.dias.find((d) => d.dia === '2026-01-16')
    expect(hoje?.sessoes).toEqual([minhaSessao])
  })

  it('diasComCheckIn only counts days with a shared item, never a gap', () => {
    const checkins = [checkin('2026-01-14'), checkin('2026-01-16')]

    const espelho = montarEspelho({ checkins, sessoes: [], patientId: PATIENT_ID, hoje: '2026-01-16' })

    expect(espelho.diasComCheckIn).toBe(2)
  })

  it('a checkin outside the 7-day window is ignored', () => {
    const foraDaJanela = checkin('2026-01-01')

    const espelho = montarEspelho({ checkins: [foraDaJanela], sessoes: [], patientId: PATIENT_ID, hoje: '2026-01-16' })

    expect(espelho.diasComCheckIn).toBe(0)
    expect(espelho.dias.some((d) => d.dia === '2026-01-01')).toBe(false)
  })
})

describe('janelaDoEspelho', () => {
  it('covers today-6 (local midnight) through the end of today', () => {
    const agora = new Date(2026, 0, 16, 14, 30)

    const janela = janelaDoEspelho(agora)

    expect(janela.de).toEqual(new Date(2026, 0, 10, 0, 0, 0, 0))
    expect(janela.ate).toEqual(new Date(2026, 0, 17, 0, 0, 0, 0))
  })

  it('spans exactly 7 x 24h in a timezone without a DST shift (Brazil today)', () => {
    const agora = new Date(2026, 0, 16, 14, 30)

    const janela = janelaDoEspelho(agora)

    expect(janela.ate.getTime() - janela.de.getTime()).toBe(7 * 24 * 60 * 60 * 1000)
  })
})
