import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../../shared/i18n'
import * as deviceApi from '../../entities/device/api'
import { PairingScan } from './PairingScan'
import { generateKeyPair } from '@limmiar/crypto'
import { encodeBase64 } from '../../shared/lib/base64'

vi.mock('../../entities/device/api', async () => {
  const actual = await vi.importActual<typeof import('../../entities/device/api')>('../../entities/device/api')
  return {
    ...actual,
    claimPairingSession: vi.fn(),
  }
})

const claimPairingSessionMock = vi.mocked(deviceApi.claimPairingSession)

const NEW_DEVICE_PUBLIC_KEY = 'bmV3LWRldmljZS1wdWJsaWMta2V5'
const PRIMARY_PUBLIC_KEY = encodeBase64(generateKeyPair().publicKey)
const SESSION_ID = 'session-abc'
const BASE_URL = 'http://api.test'
const VALID_QR_TEXT = JSON.stringify({ s: SESSION_ID, k: PRIMARY_PUBLIC_KEY, u: BASE_URL })

function renderPairingScan(decode: () => Promise<string>, onClaimed: (key: string, sessionId: string) => void = vi.fn()) {
  return render(
    <I18nProvider i18n={i18n}>
      <PairingScan baseUrl={BASE_URL} decode={decode} newDevicePublicKeyBase64={NEW_DEVICE_PUBLIC_KEY} onClaimed={onClaimed} />
    </I18nProvider>,
  )
}

describe('PairingScan', () => {
  it('usa a origem do app quando a API está no mesmo host', async () => {
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: PRIMARY_PUBLIC_KEY })
    const claimed = vi.fn()
    render(<I18nProvider i18n={i18n}><PairingScan baseUrl="" decode={async () => JSON.stringify({ s: SESSION_ID, k: PRIMARY_PUBLIC_KEY, u: '' })} newDevicePublicKeyBase64={NEW_DEVICE_PUBLIC_KEY} onClaimed={claimed} /></I18nProvider>)
    await waitFor(() => expect(claimed).toHaveBeenCalledWith(PRIMARY_PUBLIC_KEY, SESSION_ID))
    expect(claimPairingSessionMock).toHaveBeenCalledWith('', SESSION_ID, NEW_DEVICE_PUBLIC_KEY)
  })
  it.each(['http://%', 'http://user:password@api.test', 'http://:password@api.test'])('recusa URL inválida ou com credenciais (%s)', async url => {
    renderPairingScan(vi.fn().mockResolvedValue(JSON.stringify({ s: SESSION_ID, k: PRIMARY_PUBLIC_KEY, u: url })))
    await screen.findByRole('alert')
    expect(claimPairingSessionMock).not.toHaveBeenCalled()
  })
  it.each(['', 's'.repeat(129)])('recusa sessão sem identificador válido (%s)', async session => {
    renderPairingScan(vi.fn().mockResolvedValue(JSON.stringify({ s: session, k: PRIMARY_PUBLIC_KEY, u: BASE_URL })))
    await screen.findByRole('alert')
    expect(claimPairingSessionMock).not.toHaveBeenCalled()
  })
  it('recusa outro servidor antes de fazer uma requisição', async () => {
    renderPairingScan(vi.fn().mockResolvedValue(JSON.stringify({ s: SESSION_ID, k: PRIMARY_PUBLIC_KEY, u: 'https://outro.invalid' })))
    await screen.findByRole('alert')
    expect(claimPairingSessionMock).not.toHaveBeenCalled()
  })
  it('recusa a substituição da chave do QR pelo servidor', async () => {
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: encodeBase64(generateKeyPair().publicKey) })
    const claimed = vi.fn()
    renderPairingScan(vi.fn().mockResolvedValue(VALID_QR_TEXT), claimed)
    expect((await screen.findByRole('alert')).textContent).toContain('não corresponde ao código QR')
    expect(claimed).not.toHaveBeenCalled()
  })
  it.each(['', '%%%'])('recusa uma chave inválida sem consultar o servidor (%s)', async key => {
    renderPairingScan(vi.fn().mockResolvedValue(JSON.stringify({ s: SESSION_ID, k: key, u: BASE_URL })))
    await screen.findByRole('alert')
    expect(claimPairingSessionMock).not.toHaveBeenCalled()
  })
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('calls the injected decode function, then claims the decoded session with its own public key', async () => {
    const decode = vi.fn().mockResolvedValue(VALID_QR_TEXT)
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: PRIMARY_PUBLIC_KEY })

    renderPairingScan(decode)

    await waitFor(() => expect(decode).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(claimPairingSessionMock).toHaveBeenCalledWith(BASE_URL, SESSION_ID, NEW_DEVICE_PUBLIC_KEY),
    )
  })

  it('calls onClaimed with the primary public key and session id once the claim succeeds', async () => {
    const decode = vi.fn().mockResolvedValue(VALID_QR_TEXT)
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: PRIMARY_PUBLIC_KEY })
    const onClaimed = vi.fn()

    renderPairingScan(decode, onClaimed)

    await waitFor(() => expect(onClaimed).toHaveBeenCalledWith(PRIMARY_PUBLIC_KEY, SESSION_ID))
    expect(screen.getByRole('status').textContent).toBe('Dispositivo pareado com sucesso.')
  })

  it('shows the scanning prompt before decode resolves, then the claiming message while the claim is in flight', async () => {
    let resolveDecode!: (text: string) => void
    const decode = vi.fn().mockReturnValue(
      new Promise<string>((resolve) => {
        resolveDecode = resolve
      }),
    )
    let resolveClaim!: (value: Awaited<ReturnType<typeof deviceApi.claimPairingSession>>) => void
    claimPairingSessionMock.mockReturnValue(
      new Promise((resolve) => {
        resolveClaim = resolve
      }),
    )

    renderPairingScan(decode)

    expect(screen.getByRole('status').textContent).toBe(
      'Aponte a câmera para o código QR exibido no outro dispositivo.',
    )

    resolveDecode(VALID_QR_TEXT)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Concluindo o pareamento...'))

    resolveClaim({ ok: true, primaryPublicKey: PRIMARY_PUBLIC_KEY })
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Dispositivo pareado com sucesso.'))
  })

  it('renders an error when the claim is rejected (expired or already-claimed session)', async () => {
    const decode = vi.fn().mockResolvedValue(VALID_QR_TEXT)
    claimPairingSessionMock.mockResolvedValue({
      ok: false,
      code: 'auth.device_pairing_session_not_found',
      params: {},
    })

    renderPairingScan(decode)

    expect((await screen.findByRole('alert')).textContent).toBe('Este código de pareamento não é mais válido. Gere um novo.')
  })

  it('renders an error and never calls claimPairingSession when the decoded text is not valid pairing JSON', async () => {
    const decode = vi.fn().mockResolvedValue('not-json-at-all')

    renderPairingScan(decode)

    await screen.findByRole('alert')
    expect(claimPairingSessionMock).not.toHaveBeenCalled()
  })

  it('renders an error and never calls claimPairingSession when the decoded JSON does not match the pairing payload shape', async () => {
    const decode = vi.fn().mockResolvedValue(JSON.stringify({ s: SESSION_ID }))

    renderPairingScan(decode)

    expect((await screen.findByRole('alert')).textContent).toBe('Código QR inválido. Tente escanear novamente.')
    expect(claimPairingSessionMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a JSON array instead of an object', JSON.stringify(['not', 'an', 'object'])],
    ['a JSON null', JSON.stringify(null)],
    ['missing s', JSON.stringify({ k: PRIMARY_PUBLIC_KEY, u: BASE_URL })],
    ['s not a string', JSON.stringify({ s: 1, k: PRIMARY_PUBLIC_KEY, u: BASE_URL })],
    ['missing k', JSON.stringify({ s: SESSION_ID, u: BASE_URL })],
    ['k not a string', JSON.stringify({ s: SESSION_ID, k: 1, u: BASE_URL })],
    ['missing u', JSON.stringify({ s: SESSION_ID, k: PRIMARY_PUBLIC_KEY })],
    ['u not a string', JSON.stringify({ s: SESSION_ID, k: PRIMARY_PUBLIC_KEY, u: 1 })],
    ['s an array holding a session id', JSON.stringify({ s: [SESSION_ID], k: PRIMARY_PUBLIC_KEY, u: BASE_URL })],
    ['k an array holding a valid key', JSON.stringify({ s: SESSION_ID, k: [PRIMARY_PUBLIC_KEY], u: BASE_URL })],
    ['u an array holding the right server', JSON.stringify({ s: SESSION_ID, k: PRIMARY_PUBLIC_KEY, u: [BASE_URL] })],
  ])('renders an error and never calls claimPairingSession when the decoded JSON is %s', async (_label, text) => {
    const decode = vi.fn().mockResolvedValue(text)

    renderPairingScan(decode)

    await screen.findByRole('alert')
    expect(claimPairingSessionMock).not.toHaveBeenCalled()
  })

  it('falls back to the real decodeFromCamera implementation when decode is not overridden', async () => {
    render(
      <I18nProvider i18n={i18n}>
        <PairingScan baseUrl={BASE_URL} newDevicePublicKeyBase64={NEW_DEVICE_PUBLIC_KEY} onClaimed={vi.fn()} />
      </I18nProvider>,
    )

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Não foi possível acessar a câmera para escanear o código.',
    )
    expect(claimPairingSessionMock).not.toHaveBeenCalled()
  })

  it('renders a camera-access error when decode rejects', async () => {
    const decode = vi.fn().mockRejectedValue(new Error('NotAllowedError'))

    renderPairingScan(decode)

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Não foi possível acessar a câmera para escanear o código.',
    )
    expect(claimPairingSessionMock).not.toHaveBeenCalled()
  })

  it('ignores a decode rejection that arrives after the component unmounted', async () => {
    let rejectDecode!: (reason: unknown) => void
    const decode = vi.fn().mockReturnValue(
      new Promise<string>((_resolve, reject) => {
        rejectDecode = reject
      }),
    )

    const { unmount } = renderPairingScan(decode)
    await waitFor(() => expect(decode).toHaveBeenCalledTimes(1))
    unmount()

    rejectDecode(new Error('NotAllowedError'))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(claimPairingSessionMock).not.toHaveBeenCalled()
  })

  it('ignores a decode resolution that arrives after the component unmounted', async () => {
    let resolveDecode!: (text: string) => void
    const decode = vi.fn().mockReturnValue(
      new Promise<string>((resolve) => {
        resolveDecode = resolve
      }),
    )

    const { unmount } = renderPairingScan(decode)
    await waitFor(() => expect(decode).toHaveBeenCalledTimes(1))
    unmount()

    resolveDecode(VALID_QR_TEXT)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(claimPairingSessionMock).not.toHaveBeenCalled()
  })

  it('ignores a claimPairingSession resolution that arrives after the component unmounted', async () => {
    const decode = vi.fn().mockResolvedValue(VALID_QR_TEXT)
    let resolveClaim!: (value: Awaited<ReturnType<typeof deviceApi.claimPairingSession>>) => void
    claimPairingSessionMock.mockReturnValue(
      new Promise((resolve) => {
        resolveClaim = resolve
      }),
    )
    const onClaimed = vi.fn()

    const { unmount } = renderPairingScan(decode, onClaimed)
    await waitFor(() => expect(claimPairingSessionMock).toHaveBeenCalledTimes(1))
    unmount()

    resolveClaim({ ok: true, primaryPublicKey: PRIMARY_PUBLIC_KEY })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onClaimed).not.toHaveBeenCalled()
  })

  it('aceita um identificador de sessão de exatamente 128 caracteres', async () => {
    const sessao = 's'.repeat(128)
    claimPairingSessionMock.mockResolvedValue({ ok: true, primaryPublicKey: PRIMARY_PUBLIC_KEY })
    const onClaimed = vi.fn()
    renderPairingScan(vi.fn().mockResolvedValue(JSON.stringify({ s: sessao, k: PRIMARY_PUBLIC_KEY, u: BASE_URL })), onClaimed)
    await waitFor(() => expect(onClaimed).toHaveBeenCalledWith(PRIMARY_PUBLIC_KEY, sessao))
  })

  it('mostra a câmera só quando lê pela câmera, com o nome acessível', () => {
    const comCamera = render(<I18nProvider i18n={i18n}><PairingScan baseUrl={BASE_URL} newDevicePublicKeyBase64={NEW_DEVICE_PUBLIC_KEY} onClaimed={vi.fn()} /></I18nProvider>)
    expect(comCamera.container.querySelector('video')?.getAttribute('aria-label')).toBe('Câmera para escanear o código QR')
    comCamera.unmount()
    const comDecode = renderPairingScan(vi.fn().mockReturnValue(new Promise(() => {})))
    expect(comDecode.container.querySelector('video')).toBeNull()
  })

  it.each(['http://api.test.evil', 'http://api.test:8080', 'https://api.test'])('recusa um servidor diferente do esperado (%s)', async (url) => {
    renderPairingScan(vi.fn().mockResolvedValue(JSON.stringify({ s: SESSION_ID, k: PRIMARY_PUBLIC_KEY, u: url })))
    await screen.findByRole('alert')
    expect(claimPairingSessionMock).not.toHaveBeenCalled()
  })
})
