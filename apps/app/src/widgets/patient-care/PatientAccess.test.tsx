import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { deferred } from '../../test-support/deferred'
import * as vinculos from '../../entities/vinculo/api'
import type { Prontuario } from '../../features/prontuario/abrir-prontuario'
import { ProntuarioContext } from '../../features/prontuario/prontuario-context'
import { PatientAccess } from './PatientAccess'

const expiraEm = '2026-10-01T12:00:00Z'
function montar() {
  render(<I18nProvider i18n={i18n}><ProntuarioContext.Provider value={{ prontuario: { consentimentos: { gravacao: 'pendente', analiseIa: 'pendente' } } as Prontuario, recarregar: async () => {} }}>
    <PatientAccess baseUrl="" accountId="conta" accessToken="token" patientId="paciente" />
  </ProntuarioContext.Provider></I18nProvider>)
}

describe('PatientAccess', () => {
  beforeAll(async () => { await dynamicActivate('pt-BR') })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('começa recolhido e traz os consentimentos do paciente', () => {
    montar()
    expect((document.querySelector('details.patient-permissions') as HTMLDetailsElement).open).toBe(false)
    expect(screen.getByRole('checkbox', { name: 'Paciente autorizou a gravação' })).toBeTruthy()
  })

  it('gera o link pelo prontuário aberto, permite selecionar e revoga os links pendentes', async () => {
    vi.spyOn(vinculos, 'criarConviteVinculo').mockResolvedValue({ ok: true, codigo: 'ABC123XYZ456', expiraEm })
    vi.spyOn(vinculos, 'revogarConvitesVinculo').mockResolvedValue({ ok: true })
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Gerar link privado de acesso' }))
    const campo = await screen.findByLabelText('Link de acesso do paciente') as HTMLInputElement
    expect(campo.value).toBe(`${window.location.origin}/auth/magic-link?token=ABC123XYZ456`)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText(/^Válido até/).textContent).toBe(`Válido até ${new Date(expiraEm).toLocaleString(i18n.locale)}`)
    expect(vinculos.criarConviteVinculo).toHaveBeenCalledWith('', 'conta', 'token', 'paciente')
    fireEvent.focus(campo)
    expect(campo.selectionEnd! - campo.selectionStart!).toBe(campo.value.length)
    fireEvent.click(screen.getByRole('button', { name: 'Revogar links de acesso pendentes' }))
    expect(await screen.findByText('Links de acesso pendentes revogados.')).toBeTruthy()
    expect(vinculos.revogarConvitesVinculo).toHaveBeenCalledWith('', 'conta', 'token', 'paciente')
    expect(screen.queryByLabelText('Link de acesso do paciente')).toBeNull()
  })

  it.each(['gerar', 'revogar'])('informa a recusa da API ao %s o acesso', async (acao) => {
    const problema = { ok: false as const, code: 'patients.not_found', params: {} }
    vi.spyOn(vinculos, 'criarConviteVinculo').mockResolvedValue(problema)
    vi.spyOn(vinculos, 'revogarConvitesVinculo').mockResolvedValue(problema)
    montar()
    fireEvent.click(screen.getByRole('button', { name: acao === 'gerar' ? 'Gerar link privado de acesso' : 'Revogar links de acesso pendentes' }))
    expect((await screen.findByRole('status')).textContent).toBe('Prontuário não encontrado.')
    expect(screen.queryByLabelText('Link de acesso do paciente')).toBeNull()
    expect(screen.queryByText('Links de acesso pendentes revogados.')).toBeNull()
  })

  it('bloqueia os botões enquanto trabalha e os libera depois', async () => {
    const envio = deferred<Awaited<ReturnType<typeof vinculos.criarConviteVinculo>>>()
    vi.spyOn(vinculos, 'criarConviteVinculo').mockReturnValue(envio.promise)
    montar()
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Gerar link privado de acesso' }))
    expect(screen.getByRole('button', { name: 'Gerar link privado de acesso' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Revogar links de acesso pendentes' })).toHaveProperty('disabled', true)
    await act(async () => envio.resolve({ ok: true, codigo: 'ABC', expiraEm }))
    expect(screen.getByRole('button', { name: 'Gerar link privado de acesso' })).toHaveProperty('disabled', false)
  })

  it.each([[new Error('rede indisponível'), 'rede indisponível'], ['sem objeto', 'Não foi possível concluir. Tente novamente.']])('mostra a falha de rede: %s', async (falha, texto) => {
    vi.spyOn(vinculos, 'criarConviteVinculo').mockRejectedValue(falha)
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Gerar link privado de acesso' }))
    expect((await screen.findByRole('status')).textContent).toBe(texto)
  })
})
