import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '@lingui/react'
import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { i18n, dynamicActivate } from '../../shared/i18n'
import * as keyStore from './key-store'
import { loadApiKey } from './key-store'
import { CopilotKeySetup } from './CopilotKeySetup'
import type { AiProvider } from './provider-registry'

vi.mock('./key-store', async () => {
  const actual = await vi.importActual<typeof import('./key-store')>('./key-store')
  return {
    ...actual,
    saveApiKey: vi.fn(),
  }
})

const saveApiKeyMock = vi.mocked(keyStore.saveApiKey)
let realSaveApiKey: typeof keyStore.saveApiKey

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'
const FAKE_API_KEY = 'sk-test-abc123'

const PROVIDERS: readonly AiProvider[] = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com', probePath: '/v1/models', probeHeaders: {} },
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    probePath: '/v1/models?limit=1',
    probeHeaders: {},
  },
]

async function makeKek(): Promise<CryptoKey> {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  return limmiarWebcrypto.importKek(raw)
}

function renderSetup(props: { kek: CryptoKey | null; onDone?: () => void; providers?: readonly AiProvider[] }) {
  return render(
    <I18nProvider i18n={i18n}>
      <CopilotKeySetup
        accountId={ACCOUNT_ID}
        kek={props.kek}
        providers={props.providers ?? PROVIDERS}
        onDone={props.onDone ?? vi.fn()}
      />
    </I18nProvider>,
  )
}

describe('CopilotKeySetup', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
    realSaveApiKey = (await vi.importActual<typeof import('./key-store')>('./key-store')).saveApiKey
  })

  beforeEach(() => {
    // Default to the real envelope-and-persist behavior; individual tests that need a
    // different outcome (pending/rejecting) override it with their own mockImplementation.
    saveApiKeyMock.mockImplementation(realSaveApiKey)
  })

  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
    localStorage.clear()
  })

  it('defaults to SUPPORTED_PROVIDERS when no providers prop is given', async () => {
    const kek = await makeKek()
    render(
      <I18nProvider i18n={i18n}>
        <CopilotKeySetup accountId={ACCOUNT_ID} kek={kek} onDone={vi.fn()} />
      </I18nProvider>,
    )

    expect(screen.getByRole('option', { name: 'OpenAI' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Anthropic' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Gemini' })).toBeTruthy()
  })

  it('falls back to an empty provider id when the providers list is empty', async () => {
    const kek = await makeKek()
    renderSetup({ kek, providers: [] })

    expect((screen.getByLabelText('Fornecedor') as HTMLSelectElement).value).toBe('')
  })

  it('shows the locked state and no form when kek is null', () => {
    renderSetup({ kek: null })

    expect(screen.getByRole('status').textContent).toBe(
      'Chaveiro bloqueado. Desbloqueie para cadastrar sua chave de API.',
    )
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull()
  })

  it('the locked state still offers "Pular", which calls onDone without ever calling saveApiKey', () => {
    const onDone = vi.fn()
    renderSetup({ kek: null, onDone })

    fireEvent.click(screen.getByRole('button', { name: 'Pular' }))

    expect(onDone).toHaveBeenCalledTimes(1)
    expect(saveApiKeyMock).not.toHaveBeenCalled()
  })

  it('clicking "Pular" calls onDone without writing anything to localStorage', async () => {
    const kek = await makeKek()
    const onDone = vi.fn()
    renderSetup({ kek, onDone })

    fireEvent.click(screen.getByRole('button', { name: 'Pular' }))

    expect(onDone).toHaveBeenCalledTimes(1)
    expect(saveApiKeyMock).not.toHaveBeenCalled()
    expect(window.localStorage.length).toBe(0)
  })

  it('the "Salvar" button is disabled while the api key field is empty', async () => {
    const kek = await makeKek()
    renderSetup({ kek })

    expect((screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('submitting a valid key envelopes it via saveApiKey (persist=false by default) and then calls onDone', async () => {
    const kek = await makeKek()
    const onDone = vi.fn()
    renderSetup({ kek, onDone })

    fireEvent.change(screen.getByLabelText('Chave de API'), { target: { value: FAKE_API_KEY } })
    expect((screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(saveApiKeyMock).toHaveBeenCalledWith(kek, ACCOUNT_ID, 'openai', FAKE_API_KEY, false)

    const loaded = await loadApiKey(kek, ACCOUNT_ID)
    expect(loaded).toEqual({ providerId: 'openai', apiKey: FAKE_API_KEY })
  })

  it('the "Lembrar neste dispositivo" checkbox is unchecked by default (opt-in persistence)', async () => {
    const kek = await makeKek()
    renderSetup({ kek })

    expect((screen.getByLabelText('Lembrar neste dispositivo') as HTMLInputElement).checked).toBe(false)
  })

  it('checking "Lembrar neste dispositivo" passes persist=true to saveApiKey', async () => {
    const kek = await makeKek()
    const onDone = vi.fn()
    renderSetup({ kek, onDone })

    fireEvent.click(screen.getByLabelText('Lembrar neste dispositivo'))
    fireEvent.change(screen.getByLabelText('Chave de API'), { target: { value: FAKE_API_KEY } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(saveApiKeyMock).toHaveBeenCalledWith(kek, ACCOUNT_ID, 'openai', FAKE_API_KEY, true)
  })

  it('the "Salvar" button stays disabled when providerId is empty, even with a filled-in api key', async () => {
    const kek = await makeKek()
    renderSetup({ kek, providers: [] })

    fireEvent.change(screen.getByLabelText('Chave de API'), { target: { value: FAKE_API_KEY } })

    expect((screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders no <form> element, so the browser has nothing to offer its password manager for', async () => {
    const kek = await makeKek()
    const { container } = renderSetup({ kek })

    expect(container.querySelector('form')).toBeNull()
    expect(screen.getByRole('button', { name: 'Salvar' }).getAttribute('type')).toBe('button')
  })

  it('is not type="password" and has no "password"/"senha" in its id or name, so browser password managers have nothing to key off of', async () => {
    const kek = await makeKek()
    renderSetup({ kek })

    const input = screen.getByLabelText('Chave de API') as HTMLInputElement

    expect(input.type).toBe('text')
    expect(input.id.toLowerCase()).not.toMatch(/password|senha/)
    expect(input.name.toLowerCase()).not.toMatch(/password|senha/)
    expect(input.autocomplete).toBe('off')
    expect(input.getAttribute('spellcheck')).toBe('false')

    fireEvent.change(input, { target: { value: FAKE_API_KEY } })

    // The mask is CSS-only -- the DOM value stays plaintext, same trade-off as type=password.
    expect(input.value).toBe(FAKE_API_KEY)
  })

  it('masks the api key field visually via -webkit-text-security instead of type="password"', async () => {
    const kek = await makeKek()

    // jsdom's CSSStyleDeclaration silently drops the non-standard -webkit-text-security property, so
    // the only way to observe what React put in the style attribute is its own SSR string
    // serializer, which builds the attribute directly instead of through a real CSSOM.
    const html = renderToStaticMarkup(
      <I18nProvider i18n={i18n}>
        <CopilotKeySetup accountId={ACCOUNT_ID} kek={kek} providers={PROVIDERS} onDone={() => {}} />
      </I18nProvider>,
    )

    expect(html).toContain('id="copilot-api-key"')
    expect(html).toContain('style="-webkit-text-security:disc"')
    expect(html).not.toContain('type="password"')
  })

  it('disables "Salvar" while the save is in flight', async () => {
    const kek = await makeKek()
    let resolveSave: () => void = () => {}
    saveApiKeyMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve as () => void
        }),
    )
    renderSetup({ kek })

    fireEvent.change(screen.getByLabelText('Chave de API'), { target: { value: FAKE_API_KEY } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement).disabled).toBe(true),
    )
    resolveSave()
  })

  it('changing the provider select updates which provider the key is saved under', async () => {
    const kek = await makeKek()
    const onDone = vi.fn()
    renderSetup({ kek, onDone })

    fireEvent.change(screen.getByLabelText('Fornecedor'), { target: { value: 'anthropic' } })
    fireEvent.change(screen.getByLabelText('Chave de API'), { target: { value: FAKE_API_KEY } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(saveApiKeyMock).toHaveBeenCalledWith(kek, ACCOUNT_ID, 'anthropic', FAKE_API_KEY, false)
  })

  it('shows an error alert and calls neither onDone again when saveApiKey rejects', async () => {
    const kek = await makeKek()
    const onDone = vi.fn()
    saveApiKeyMock.mockRejectedValue(new Error('boom'))
    renderSetup({ kek, onDone })

    fireEvent.change(screen.getByLabelText('Chave de API'), { target: { value: FAKE_API_KEY } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível salvar a chave. Tente novamente.')
    expect(onDone).not.toHaveBeenCalled()
  })
})
