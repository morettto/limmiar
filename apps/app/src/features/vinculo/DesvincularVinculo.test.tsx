import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../../shared/i18n'
import * as vinculoApi from '../../entities/vinculo/api'
import { DesvincularVinculo } from './DesvincularVinculo'

vi.mock('../../entities/vinculo/api', async () => {
  const actual = await vi.importActual<typeof import('../../entities/vinculo/api')>('../../entities/vinculo/api')
  return { ...actual, listarVinculos: vi.fn(), desvincular: vi.fn() }
})

const listarVinculosMock = vi.mocked(vinculoApi.listarVinculos)
const desvincularMock = vi.mocked(vinculoApi.desvincular)

const BASE_URL = 'http://api.test'
const MARTA_ACCOUNT_ID = 'conta-marta'
const ANA_ACCOUNT_ID = 'conta-ana'
const ACCESS_TOKEN = 'token-marta'

const VINCULO_COM_ANA = {
  profissionalAccountId: MARTA_ACCOUNT_ID,
  pacienteAccountId: ANA_ACCOUNT_ID,
  patientId: 'paciente-ana',
  vinculadoEm: '2026-09-21T12:00:00Z',
  chavePublicaDoPar: new Uint8Array(32).fill(9),
}

function renderComponent(accountId = MARTA_ACCOUNT_ID) {
  return render(
    <I18nProvider i18n={i18n}>
      <DesvincularVinculo baseUrl={BASE_URL} accountId={accountId} accessToken={ACCESS_TOKEN} />
    </I18nProvider>,
  )
}

describe('DesvincularVinculo', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('fetches the list on mount and renders one "Desvincular" button per vínculo', async () => {
    listarVinculosMock.mockResolvedValue({ ok: true, vinculos: [VINCULO_COM_ANA] })

    renderComponent()

    await waitFor(() => expect(listarVinculosMock).toHaveBeenCalledWith(BASE_URL, MARTA_ACCOUNT_ID, ACCESS_TOKEN))
    expect(await screen.findByRole('button', { name: /Desvincular/ })).toBeTruthy()
  })

  it('shows "Nenhum vínculo." when the list comes back empty', async () => {
    listarVinculosMock.mockResolvedValue({ ok: true, vinculos: [] })

    renderComponent()

    expect((await screen.findByRole('status')).textContent).toBe('Nenhum vínculo.')
  })

  it('shows a translated error when the list itself fails to load', async () => {
    listarVinculosMock.mockResolvedValue({ ok: false, code: 'auth.forbidden', params: {} })

    renderComponent()

    expect((await screen.findByRole('alert')).textContent).toBe('Você não tem acesso a esta conta.')
  })

  it('resolves the peer account id from whichever side is not accountId, on both sides of the link', async () => {
    listarVinculosMock.mockResolvedValue({ ok: true, vinculos: [VINCULO_COM_ANA] })
    desvincularMock.mockResolvedValue({ ok: true })

    renderComponent(ANA_ACCOUNT_ID)

    fireEvent.click(await screen.findByRole('button', { name: /Desvincular/ }))

    await waitFor(() => expect(desvincularMock).toHaveBeenCalledWith(BASE_URL, ANA_ACCOUNT_ID, ACCESS_TOKEN, MARTA_ACCOUNT_ID))
  })

  it('re-fetches the list after a successful Desvincular, so the link disappears from both sides', async () => {
    listarVinculosMock.mockResolvedValueOnce({ ok: true, vinculos: [VINCULO_COM_ANA] })
    desvincularMock.mockResolvedValue({ ok: true })
    listarVinculosMock.mockResolvedValueOnce({ ok: true, vinculos: [] })

    renderComponent()
    fireEvent.click(await screen.findByRole('button', { name: /Desvincular/ }))

    expect((await screen.findByRole('status')).textContent).toBe('Nenhum vínculo.')
    expect(listarVinculosMock).toHaveBeenCalledTimes(2)
  })

  it('shows a translated inline error and keeps the link listed when Desvincular fails (e.g. 404 already gone)', async () => {
    listarVinculosMock.mockResolvedValue({ ok: true, vinculos: [VINCULO_COM_ANA] })
    desvincularMock.mockResolvedValue({ ok: false, code: 'link.not_found', params: {} })

    renderComponent()
    fireEvent.click(await screen.findByRole('button', { name: /Desvincular/ }))

    expect((await screen.findByRole('alert')).textContent).toBe('Não há vínculo com esta conta.')
    expect(screen.getByRole('button', { name: /Desvincular/ })).toBeTruthy()
    expect(listarVinculosMock).toHaveBeenCalledTimes(1)
  })
})
