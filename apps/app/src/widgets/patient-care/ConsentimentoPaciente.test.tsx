import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { dynamicActivate, i18n } from '../../shared/i18n'
import * as consentimentos from '../../entities/consentimento/api'
import type { ConsentimentosDoPaciente } from '../../entities/consentimento/api'
import type { Prontuario } from '../../features/prontuario/abrir-prontuario'
import { ProntuarioContext } from '../../features/prontuario/prontuario-context'
import { ConsentimentoPaciente } from './ConsentimentoPaciente'

const recarregar = vi.fn(async () => {})
const decisao = (finalidade: consentimentos.Finalidade, valor: consentimentos.Decisao) =>
  ({ ok: true as const, finalidade, decisao: valor, registradoEm: '2026-10-01T12:00:00Z' })

function montar(estado: ConsentimentosDoPaciente = { gravacao: 'pendente', analiseIa: 'pendente' }) {
  render(<I18nProvider i18n={i18n}><ProntuarioContext.Provider value={{ prontuario: { consentimentos: estado } as Prontuario, recarregar }}>
    <ConsentimentoPaciente baseUrl="" accountId="conta" accessToken="token" patientId="paciente" />
  </ProntuarioContext.Provider></I18nProvider>)
}
const gravacao = () => screen.getByRole('checkbox', { name: 'Paciente autorizou a gravação' }) as HTMLInputElement
const analise = () => screen.getByRole('checkbox', { name: 'Paciente autorizou a análise por IA local' }) as HTMLInputElement

describe('ConsentimentoPaciente', () => {
  beforeAll(async () => { await dynamicActivate('pt-BR') })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); recarregar.mockClear() })

  it('mostra o consentimento do prontuário aberto', () => {
    montar({ gravacao: 'concedido', analiseIa: 'revogado' })
    expect(gravacao().checked).toBe(true)
    expect(analise().checked).toBe(false)
  })

  it('registra a decisão de cada finalidade na API e relê o prontuário', async () => {
    const registrar = vi.spyOn(consentimentos, 'registrarConsentimento').mockResolvedValue(decisao('gravacao', 'concedido'))
    montar({ gravacao: 'pendente', analiseIa: 'concedido' })
    fireEvent.click(gravacao())
    await waitFor(() => expect(recarregar).toHaveBeenCalledOnce())
    expect(registrar).toHaveBeenLastCalledWith('', 'conta', 'token', 'paciente', { finalidade: 'gravacao', decisao: 'concedido' })
    fireEvent.click(analise())
    await waitFor(() => expect(recarregar).toHaveBeenCalledTimes(2))
    expect(registrar).toHaveBeenLastCalledWith('', 'conta', 'token', 'paciente', { finalidade: 'analiseIa', decisao: 'revogado' })
  })

  it('desabilita a escolha enquanto registra', async () => {
    let concluir!: (resultado: Awaited<ReturnType<typeof consentimentos.registrarConsentimento>>) => void
    vi.spyOn(consentimentos, 'registrarConsentimento').mockReturnValue(new Promise(resolve => { concluir = resolve }))
    montar()
    fireEvent.click(gravacao())
    await waitFor(() => expect(gravacao().matches(':disabled')).toBe(true))
    concluir(decisao('gravacao', 'concedido'))
    await waitFor(() => expect(gravacao().matches(':disabled')).toBe(false))
  })

  it('informa a recusa da API sem reler o prontuário', async () => {
    vi.spyOn(consentimentos, 'registrarConsentimento').mockResolvedValue({ ok: false, code: 'patients.not_found', params: {} })
    montar()
    fireEvent.click(gravacao())
    await screen.findByRole('status')
    expect(recarregar).not.toHaveBeenCalled()
  })

  it.each([[new Error('prontuário indisponível'), 'prontuário indisponível'], ['sem objeto', 'Não foi possível concluir. Tente novamente.']])('informa a falha ao reler o prontuário: %s', async (falha, texto) => {
    vi.spyOn(consentimentos, 'registrarConsentimento').mockResolvedValue(decisao('gravacao', 'concedido'))
    recarregar.mockRejectedValueOnce(falha)
    montar()
    fireEvent.click(gravacao())
    expect((await screen.findByRole('status')).textContent).toBe(texto)
  })
})
