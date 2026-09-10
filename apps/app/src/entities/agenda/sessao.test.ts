import { afterEach, describe, expect, it, vi } from 'vitest'
import { horaDaSessao, proximaSessao, sessoesNaSemana, type SessaoAgendada } from './sessao'

function sessao(overrides: Partial<SessaoAgendada> = {}): SessaoAgendada {
  return {
    sessionId: 's-1',
    patientId: 'p-1',
    inicioEm: '2026-09-10T15:30:00Z',
    duracaoMinutos: 50,
    canceladaEm: null,
    ...overrides,
  }
}

const AGORA = new Date('2026-09-10T10:00:00Z')

describe('proximaSessao', () => {
  it('vazio devolve null', () => {
    expect(proximaSessao([], AGORA)).toBeNull()
  })

  it('devolve a de menor inicioEm que ainda não passou', () => {
    const maisCedo = sessao({ sessionId: 's-cedo', inicioEm: '2026-09-10T12:00:00Z' })
    const maisTarde = sessao({ sessionId: 's-tarde', inicioEm: '2026-09-10T18:00:00Z' })

    expect(proximaSessao([maisTarde, maisCedo], AGORA)).toEqual(maisCedo)
  })

  it('mantém a mais cedo já encontrada quando a próxima candidata é mais tarde', () => {
    const maisCedo = sessao({ sessionId: 's-cedo', inicioEm: '2026-09-10T12:00:00Z' })
    const maisTarde = sessao({ sessionId: 's-tarde', inicioEm: '2026-09-10T18:00:00Z' })

    expect(proximaSessao([maisCedo, maisTarde], AGORA)).toEqual(maisCedo)
  })

  it('salta sessão cancelada mesmo sendo a mais cedo', () => {
    const cancelada = sessao({
      sessionId: 's-cancelada',
      inicioEm: '2026-09-10T11:00:00Z',
      canceladaEm: '2026-09-09T00:00:00Z',
    })
    const seguinte = sessao({ sessionId: 's-seguinte', inicioEm: '2026-09-10T13:00:00Z' })

    expect(proximaSessao([cancelada, seguinte], AGORA)).toEqual(seguinte)
  })

  it('salta sessão já passada', () => {
    const passada = sessao({ sessionId: 's-passada', inicioEm: '2026-09-10T09:00:00Z' })

    expect(proximaSessao([passada], AGORA)).toBeNull()
  })
})

describe('sessoesNaSemana', () => {
  it('conta só as sessões não canceladas dentro da janela de 7 dias', () => {
    const dentro = sessao({ sessionId: 's-dentro', inicioEm: '2026-09-12T10:00:00Z' })
    const foraDaJanela = sessao({ sessionId: 's-fora', inicioEm: '2026-09-18T10:00:00Z' })
    const cancelada = sessao({
      sessionId: 's-cancelada',
      inicioEm: '2026-09-13T10:00:00Z',
      canceladaEm: '2026-09-09T00:00:00Z',
    })

    expect(sessoesNaSemana([dentro, foraDaJanela, cancelada], AGORA)).toBe(1)
  })

  it('sem sessões devolve 0', () => {
    expect(sessoesNaSemana([], AGORA)).toBe(0)
  })
})

describe('horaDaSessao', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // TZ pinada (Brasil não observa DST desde 2019 -- UTC-3 o ano inteiro) para o valor
  // esperado não depender do fuso da máquina que corre o teste. Hora E minuto de um só
  // dígito (08:05, não 15:30): só assim `'2-digit'` -> `'numeric'` muda a string de saída.
  it('formata só hora:minuto no locale pedido', () => {
    vi.stubEnv('TZ', 'America/Sao_Paulo')

    expect(horaDaSessao('2026-09-10T11:05:00Z', 'pt-BR')).toBe('08:05')
  })
})
