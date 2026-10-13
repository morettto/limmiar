import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { webcrypto, type CryptoKey } from '@limmiar/crypto'
import { i18n, dynamicActivate } from '../../shared/i18n'
import { deferred } from '../../test-support/deferred'
import * as vinculoApi from '../../entities/vinculo/api'
import * as parDeChavesModule from '../../entities/vinculo/par-de-chaves'
import { GerarConviteVinculo } from './GerarConviteVinculo'

vi.mock('../../entities/vinculo/api', async () => {
  const actual = await vi.importActual<typeof import('../../entities/vinculo/api')>('../../entities/vinculo/api')
  return { ...actual, criarConviteVinculo: vi.fn() }
})
vi.mock('../../entities/vinculo/par-de-chaves', () => ({ garantirParDeChaves: vi.fn() }))

const criarConviteVinculoMock = vi.mocked(vinculoApi.criarConviteVinculo)
const garantirParDeChavesMock = vi.mocked(parDeChavesModule.garantirParDeChaves)

const BASE_URL = 'http://api.test'
const ACCOUNT_ID = 'conta-marta'
const ACCESS_TOKEN = 'token-marta'
const PATIENT_ID = 'paciente-ana'

async function renderComponent() {
  const kek = await webcrypto.importKek(new Uint8Array(32).fill(1))
  return render(componente(kek, ACCESS_TOKEN))
}

function componente(kek: CryptoKey, accessToken: string) {
  return (
    <I18nProvider i18n={i18n}>
      <GerarConviteVinculo baseUrl={BASE_URL} accountId={ACCOUNT_ID} accessToken={accessToken} kek={kek} patientId={PATIENT_ID} />
    </I18nProvider>
  )
}

describe('GerarConviteVinculo', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('calls garantirParDeChaves on mount, with this account and kek', async () => {
    garantirParDeChavesMock.mockResolvedValue({ publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) })

    await renderComponent()

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Gerar código de vínculo' })).toHaveProperty('disabled', false)
    expect(garantirParDeChavesMock).toHaveBeenCalledTimes(1)
    expect(garantirParDeChavesMock.mock.calls[0]![0]).toMatchObject({
      baseUrl: BASE_URL,
      accountId: ACCOUNT_ID,
      accessToken: ACCESS_TOKEN,
    })
  })

  it('clicking "Gerar código de vínculo" shows the returned code and its validity on success', async () => {
    garantirParDeChavesMock.mockResolvedValue({ publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) })
    criarConviteVinculoMock.mockResolvedValue({ ok: true, codigo: 'ABCD1234EFGH', expiraEm: '2026-09-21T12:00:00Z' })

    await renderComponent()
    fireEvent.click(screen.getByRole('button', { name: 'Gerar código de vínculo' }))

    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('ABCD1234EFGH')
    expect(status.textContent).toContain(new Date('2026-09-21T12:00:00Z').toLocaleString(i18n.locale))
    expect(criarConviteVinculoMock).toHaveBeenCalledWith(BASE_URL, ACCOUNT_ID, ACCESS_TOKEN, PATIENT_ID)
  })

  it('shows a translated error and no code when the server rejects the invite request', async () => {
    garantirParDeChavesMock.mockResolvedValue({ publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) })
    criarConviteVinculoMock.mockResolvedValue({ ok: false, code: 'auth.forbidden', params: {} })

    await renderComponent()
    fireEvent.click(screen.getByRole('button', { name: 'Gerar código de vínculo' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Você não tem acesso a esta conta.')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('logs but does not crash when garantirParDeChaves rejects on mount', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    garantirParDeChavesMock.mockRejectedValue(new Error('kek trancado'))

    await renderComponent()
    await vi.waitFor(() => expect(consoleErrorSpy).toHaveBeenCalledTimes(1))
    expect(consoleErrorSpy).toHaveBeenCalledWith('GerarConviteVinculo: falha ao garantir o par de chaves', new Error('kek trancado'))

    expect(screen.getByRole('button', { name: 'Gerar código de vínculo' })).toBeTruthy()
    consoleErrorSpy.mockRestore()
  })

  it('bloqueia o botão enquanto gera o convite', async () => {
    garantirParDeChavesMock.mockResolvedValue({ publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) })
    const convite = deferred<vinculoApi.CriarConviteVinculoResult>()
    criarConviteVinculoMock.mockReturnValue(convite.promise)

    await renderComponent()
    fireEvent.click(screen.getByRole('button', { name: 'Gerar código de vínculo' }))

    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Gerar código de vínculo' })).toHaveProperty('disabled', true))
    await act(async () => convite.resolve({ ok: false, code: 'auth.forbidden', params: {} }))
    expect(screen.getByRole('button', { name: 'Gerar código de vínculo' })).toHaveProperty('disabled', false)
  })

  it('publica o par de chaves de novo quando a sessão ou a chave mudam', async () => {
    garantirParDeChavesMock.mockResolvedValue({ publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) })
    const kek = await webcrypto.importKek(new Uint8Array(32).fill(1))
    const view = render(componente(kek, ACCESS_TOKEN))
    view.rerender(componente(kek, ACCESS_TOKEN))
    expect(garantirParDeChavesMock).toHaveBeenCalledTimes(1)

    view.rerender(componente(kek, 'token-novo'))
    expect(garantirParDeChavesMock).toHaveBeenCalledTimes(2)
    expect(garantirParDeChavesMock.mock.calls[1]![0]).toMatchObject({ accessToken: 'token-novo' })
  })
})
