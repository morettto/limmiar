import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { webcrypto, type CryptoKey } from '@limmiar/crypto'
import { i18n, dynamicActivate } from '../../shared/i18n'
import { deferred } from '../../test-support/deferred'
import * as vinculoApi from '../../entities/vinculo/api'
import type { Vinculo } from '../../entities/vinculo/api'
import * as parDeChavesModule from '../../entities/vinculo/par-de-chaves'
import { ResgatarConviteVinculo } from './ResgatarConviteVinculo'

vi.mock('../../entities/vinculo/api', async () => {
  const actual = await vi.importActual<typeof import('../../entities/vinculo/api')>('../../entities/vinculo/api')
  return { ...actual, resgatarConviteVinculo: vi.fn() }
})
vi.mock('../../entities/vinculo/par-de-chaves', () => ({ garantirParDeChaves: vi.fn() }))

const resgatarConviteVinculoMock = vi.mocked(vinculoApi.resgatarConviteVinculo)
const garantirParDeChavesMock = vi.mocked(parDeChavesModule.garantirParDeChaves)

const BASE_URL = 'http://api.test'
const ACCOUNT_ID = 'conta-ana'
const ACCESS_TOKEN = 'token-ana'
const INVITE_CODE = 'test-code'

const VINCULO: Vinculo = {
  profissionalAccountId: 'conta-marta',
  pacienteAccountId: ACCOUNT_ID,
  patientId: 'paciente-ana',
  vinculadoEm: '2026-09-21T12:00:00Z',
  chavePublicaDoPar: new Uint8Array(32).fill(9),
}

async function renderComponent(onVinculada?: (vinculo: Vinculo) => void) {
  const kek = await webcrypto.importKek(new Uint8Array(32).fill(1))
  return render(componente(kek, ACCESS_TOKEN, onVinculada))
}

function componente(kek: CryptoKey, accessToken: string, onVinculada?: (vinculo: Vinculo) => void) {
  return (
    <I18nProvider i18n={i18n}>
      <ResgatarConviteVinculo baseUrl={BASE_URL} accountId={ACCOUNT_ID} accessToken={accessToken} kek={kek} onVinculada={onVinculada} />
    </I18nProvider>
  )
}

describe('ResgatarConviteVinculo', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders the code field and calls garantirParDeChaves on mount', async () => {
    garantirParDeChavesMock.mockResolvedValue({ publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) })

    await renderComponent()

    expect(screen.getByLabelText('Código de vínculo')).toHaveProperty('value', '')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: 'Vincular' })).toHaveProperty('disabled', false)
    expect(garantirParDeChavesMock).toHaveBeenCalledTimes(1)
    expect(garantirParDeChavesMock.mock.calls[0]![0]).toMatchObject({
      baseUrl: BASE_URL,
      accountId: ACCOUNT_ID,
      accessToken: ACCESS_TOKEN,
    })
  })

  it('typing a code and clicking "Vincular" shows "Vinculada" and forwards the Vinculo on success', async () => {
    garantirParDeChavesMock.mockResolvedValue({ publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) })
    resgatarConviteVinculoMock.mockResolvedValue({ ok: true, vinculo: VINCULO })
    const onVinculada = vi.fn()

    await renderComponent(onVinculada)
    fireEvent.change(screen.getByLabelText('Código de vínculo'), { target: { value: INVITE_CODE } })
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }))

    expect((await screen.findByRole('status')).textContent).toBe('Vinculada.')
    expect(resgatarConviteVinculoMock).toHaveBeenCalledWith(BASE_URL, ACCOUNT_ID, ACCESS_TOKEN, INVITE_CODE)
    expect(onVinculada).toHaveBeenCalledWith(VINCULO)
  })

  it('shows "Código inválido ou expirado." on a 404 (invalid, expired or already-used code)', async () => {
    garantirParDeChavesMock.mockResolvedValue({ publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) })
    resgatarConviteVinculoMock.mockResolvedValue({ ok: false, code: 'link.invite_not_found', params: {} })

    await renderComponent()
    fireEvent.change(screen.getByLabelText('Código de vínculo'), { target: { value: 'INVALIDO0000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Código inválido ou expirado.')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows the dedicated translated message for a code other than link.invite_not_found (e.g. 409 already linked)', async () => {
    garantirParDeChavesMock.mockResolvedValue({ publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) })
    resgatarConviteVinculoMock.mockResolvedValue({ ok: false, code: 'link.already_linked', params: {} })

    await renderComponent()
    fireEvent.change(screen.getByLabelText('Código de vínculo'), { target: { value: INVITE_CODE } })
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Vocês já estão vinculados.')
  })

  it('logs but does not crash when garantirParDeChaves rejects on mount', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    garantirParDeChavesMock.mockRejectedValue(new Error('kek trancado'))

    await renderComponent()
    await vi.waitFor(() => expect(consoleErrorSpy).toHaveBeenCalledTimes(1))
    expect(consoleErrorSpy).toHaveBeenCalledWith('ResgatarConviteVinculo: falha ao garantir o par de chaves', new Error('kek trancado'))

    expect(screen.getByLabelText('Código de vínculo')).toBeTruthy()
    consoleErrorSpy.mockRestore()
  })

  it('bloqueia o botão enquanto resgata', async () => {
    garantirParDeChavesMock.mockResolvedValue({ publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) })
    const resgate = deferred<vinculoApi.ResgatarConviteVinculoResult>()
    resgatarConviteVinculoMock.mockReturnValue(resgate.promise)

    await renderComponent()
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }))

    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Vincular' })).toHaveProperty('disabled', true))
    await act(async () => resgate.resolve({ ok: false, code: 'link.invite_not_found', params: {} }))
    expect(screen.getByRole('button', { name: 'Vincular' })).toHaveProperty('disabled', false)
  })

  it('vincula sem ninguém esperando o aviso de vínculo', async () => {
    garantirParDeChavesMock.mockResolvedValue({ publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) })
    resgatarConviteVinculoMock.mockResolvedValue({ ok: true, vinculo: VINCULO })
    const naoTratada = vi.fn()
    process.on('unhandledRejection', naoTratada)

    await renderComponent()
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }))
    expect((await screen.findByRole('status')).textContent).toBe('Vinculada.')
    await new Promise((resolve) => setTimeout(resolve, 10))

    process.off('unhandledRejection', naoTratada)
    expect(naoTratada).not.toHaveBeenCalled()
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
