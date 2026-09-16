import { describe, expect, it } from 'vitest'
import { comPartilha, type EstadoPartilha } from '../../entities/partilha/partilha'
import type { Vinculo } from '../../entities/vinculo/api'
import { chaveDoVinculo, destinatarios } from './partilha'

const PACIENTE_ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'
const PROFISSIONAL_ACCOUNT_ID = '22222222-2222-2222-2222-222222222222'
const OUTRA_PACIENTE_ACCOUNT_ID = '99999999-9999-9999-9999-999999999999'

function vinculo(overrides: Partial<Vinculo> = {}): Vinculo {
  return {
    profissionalAccountId: PROFISSIONAL_ACCOUNT_ID,
    pacienteAccountId: PACIENTE_ACCOUNT_ID,
    patientId: 'patient-1',
    vinculadoEm: '2026-09-14T10:00:00Z',
    chavePublicaDoPar: new Uint8Array(32).fill(7),
    ...overrides,
  }
}

describe('chaveDoVinculo', () => {
  it('combina profissionalAccountId e vinculadoEm, então um vínculo novo nunca herda a chave de um antigo', () => {
    const antigo = vinculo({ vinculadoEm: '2026-01-01T00:00:00Z' })
    const novo = vinculo({ vinculadoEm: '2026-09-14T10:00:00Z' })

    expect(chaveDoVinculo(antigo)).not.toBe(chaveDoVinculo(novo))
    expect(chaveDoVinculo(novo)).toBe(`${PROFISSIONAL_ACCOUNT_ID}|2026-09-14T10:00:00Z`)
  })
})

describe('destinatarios', () => {
  it('inclui só vínculos da paciente, com o toggle ativo e chave pública conhecida', () => {
    const ativoComChave = vinculo({ profissionalAccountId: PROFISSIONAL_ACCOUNT_ID })
    const semToggle = vinculo({ profissionalAccountId: 'sem-toggle' })
    const semChave = vinculo({ profissionalAccountId: 'sem-chave', chavePublicaDoPar: null })
    const deOutraPaciente = vinculo({ profissionalAccountId: 'outra-paciente', pacienteAccountId: OUTRA_PACIENTE_ACCOUNT_ID })

    let estado: EstadoPartilha = {}
    estado = comPartilha(estado, chaveDoVinculo(ativoComChave), 'checkin', true)
    estado = comPartilha(estado, chaveDoVinculo(semChave), 'checkin', true)
    estado = comPartilha(estado, chaveDoVinculo(deOutraPaciente), 'checkin', true)
    // semToggle nunca passa por comPartilha: fica com o toggle desligado.

    const resultado = destinatarios(estado, [ativoComChave, semToggle, semChave, deOutraPaciente], PACIENTE_ACCOUNT_ID, 'checkin')

    expect(resultado).toEqual([ativoComChave])
  })

  it('devolve [] quando nenhum vínculo tem o toggle ativo', () => {
    const v = vinculo()
    const resultado = destinatarios({}, [v], PACIENTE_ACCOUNT_ID, 'checkin')

    expect(resultado).toEqual([])
  })
})
