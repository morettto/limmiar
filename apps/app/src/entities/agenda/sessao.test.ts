import { afterEach, describe, expect, it, vi } from 'vitest'
import { contarPorComecar, horaDaSessao, proximaSessao, type SessaoAgendada } from './sessao'

function sessao(overrides: Partial<SessaoAgendada> = {}): SessaoAgendada {
  return {
    sessionId: 's-1',
    patientId: 'p-1',
    inicioEm: '2026-09-10T15:30:00Z',
    duracaoMinutos: 50,
    ...overrides,
  }
}

const AGORA = new Date('2026-09-10T10:00:00Z')

describe('proximaSessao', () => {
  it('vazio devolve null', () => {
    expect(proximaSessao([], AGORA)).toBeNull()
  })

  // Entrada já ordenada por starts_at (contrato do GET) -- proximaSessao confia na ordem
  // do servidor, não ordena de novo.
  it('entrada ordenada devolve a primeira que ainda não começou', () => {
    const primeira = sessao({ sessionId: 's-cedo', inicioEm: '2026-09-10T12:00:00Z' })
    const segunda = sessao({ sessionId: 's-tarde', inicioEm: '2026-09-10T18:00:00Z' })

    expect(proximaSessao([primeira, segunda], AGORA)).toEqual(primeira)
  })

  it('salta sessão já passada', () => {
    const passada = sessao({ sessionId: 's-passada', inicioEm: '2026-09-10T09:00:00Z' })
    const seguinte = sessao({ sessionId: 's-seguinte', inicioEm: '2026-09-10T13:00:00Z' })

    expect(proximaSessao([passada, seguinte], AGORA)).toEqual(seguinte)
  })
})

describe('contarPorComecar', () => {
  // A janela de 7 dias é do pedido ao backend (listarSessoesDaSemana), não recortada de
  // novo aqui -- uma sessão a 8 dias ainda conta, porque isto só filtra o que já começou.
  it('conta as sessões que ainda não começaram, mesmo fora de 7 dias', () => {
    const dentro = sessao({ sessionId: 's-dentro', inicioEm: '2026-09-12T10:00:00Z' })
    const a8dias = sessao({ sessionId: 's-8-dias', inicioEm: '2026-09-18T10:00:00Z' })

    expect(contarPorComecar([dentro, a8dias], AGORA)).toBe(2)
  })

  it('sem sessões devolve 0', () => {
    expect(contarPorComecar([], AGORA)).toBe(0)
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
