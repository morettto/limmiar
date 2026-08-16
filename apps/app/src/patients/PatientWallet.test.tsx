import '@vitest/web-worker'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { dynamicActivate, i18n } from '../i18n'
import { encodeBase64 } from '../devices/base64'
import { PatientWallet } from './PatientWallet'
import { sealNewPatient } from './patient-crypto'
import type { SealedSummary, SummaryResult } from './patient-summary'

const FAKE_KEK = {} as unknown as CryptoKey

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// jsdom has no matchMedia; AdaptiveTable's useBreakpoint hook needs one to mount at all.
// A fixed "matches: false" (-> sm/card layout) is enough here -- breakpoint-specific
// rendering is proven by AdaptiveTable's own suite and the Playwright CT spec, not here.
function stubMatchMedia() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

function renderWallet(props: Partial<React.ComponentProps<typeof PatientWallet>> = {}) {
  return render(
    <I18nProvider i18n={i18n}>
      <PatientWallet baseUrl="http://api.test" accountId="acc-1" accessToken="token-1" kek={FAKE_KEK} {...props} />
    </I18nProvider>,
  )
}

function patientsResponse(patientIds: string[]) {
  return {
    patients: patientIds.map((patientId) => ({
      patientId,
      wrappedDek: encodeBase64(new Uint8Array([1, 2, 3])),
      ciphertext: encodeBase64(new Uint8Array([4, 5, 6])),
      createdAt: '2026-08-14T10:00:00Z',
    })),
  }
}

describe('PatientWallet', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
    stubMatchMedia()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('kek=null: shows the locked state immediately, calls neither fetch nor openSummaries', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const openSummaries = vi.fn()

    renderWallet({ kek: null, openSummaries })

    expect(await screen.findByText('Chaveiro bloqueado. Desbloqueie para ver a carteira de pacientes.')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(openSummaries).not.toHaveBeenCalled()
    expect(screen.queryByText('Ana')).toBeNull()
  })

  it('renders ready rows sorted by risk (elevado before baixo), regardless of the order openSummaries returned', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(patientsResponse(['p-baixo', 'p-elevado'])), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const unsorted: SummaryResult[] = [
      { patientId: 'p-baixo', ok: true, name: 'Zeca', risk: 'baixo' },
      { patientId: 'p-elevado', ok: true, name: 'Ana', risk: 'elevado' },
    ]
    const openSummaries = vi.fn().mockResolvedValue(unsorted)

    renderWallet({ openSummaries })

    await waitFor(() => expect(screen.getByRole('list').children).toHaveLength(2))
    const names = screen.getAllByText(/Ana|Zeca/).map((el) => el.textContent)
    expect(names).toEqual(['Ana', 'Zeca'])

    expect(fetchMock).toHaveBeenCalledWith('http://api.test/accounts/acc-1/patients', {
      headers: { Authorization: 'Bearer token-1' },
    })
    const [passedKek, passedItems] = openSummaries.mock.calls[0] as [unknown, SealedSummary[]]
    expect(passedKek).toBe(FAKE_KEK)
    expect(passedItems.map((item) => item.patientId)).toEqual(['p-baixo', 'p-elevado'])
  })

  it('a network failure lands in the error state with an i18n message, no crash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    )

    renderWallet({ openSummaries: vi.fn() })

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Não foi possível carregar a carteira de pacientes. Tente novamente.',
    )
  })

  it('a problem+json (non-2xx) response also lands in the error state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 'auth.forbidden', params: {} }), {
          status: 403,
          headers: { 'Content-Type': 'application/problem+json' },
        }),
      ),
    )

    renderWallet({ openSummaries: vi.fn() })

    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('an ok:false item shows a placeholder instead of a name, still visible, no crash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(patientsResponse(['p-broken', 'p-ok'])), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    const results: SummaryResult[] = [
      { patientId: 'p-broken', ok: false },
      { patientId: 'p-ok', ok: true, name: 'Bruno', risk: 'moderado' },
    ]
    const openSummaries = vi.fn().mockResolvedValue(results)

    renderWallet({ openSummaries })

    expect(await screen.findByText('Não foi possível ler')).toBeTruthy()
    expect(screen.getByText('Bruno')).toBeTruthy()
  })

  it('with no openSummaries seam, decrypts through the real Worker default', async () => {
    const kek = await limmiarWebcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
    const { wrappedDek, ciphertext } = await sealNewPatient(
      kek,
      'p-real',
      new TextEncoder().encode(JSON.stringify({ name: 'Carla', risk: 'moderado' })),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            patients: [
              { patientId: 'p-real', wrappedDek: encodeBase64(wrappedDek), ciphertext: encodeBase64(ciphertext), createdAt: '2026-08-14T10:00:00Z' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    renderWallet({ kek })

    expect(await screen.findByText('Carla')).toBeTruthy()
  })

  it('unmounting before listPatients resolves cancels before the decrypt step runs', async () => {
    const fetchCall = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(fetchCall.promise))
    const openSummaries = vi.fn()

    const { unmount } = renderWallet({ openSummaries })
    unmount()

    fetchCall.resolve(
      new Response(JSON.stringify(patientsResponse(['p1'])), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await fetchCall.promise
    await Promise.resolve()

    expect(openSummaries).not.toHaveBeenCalled()
  })

  it('unmounting before listPatients rejects skips the fallback error state', async () => {
    const fetchCall = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(fetchCall.promise))
    const openSummaries = vi.fn()

    const { unmount } = renderWallet({ openSummaries })
    unmount()

    fetchCall.reject(new Error('network down'))
    await fetchCall.promise.catch(() => {})
    await Promise.resolve()

    expect(openSummaries).not.toHaveBeenCalled()
  })

  it('unmounting while openSummaries is pending skips the ready state once it resolves', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(patientsResponse(['p1'])), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    const summariesCall = deferred<SummaryResult[]>()
    const openSummaries = vi.fn().mockReturnValue(summariesCall.promise)

    const { unmount } = renderWallet({ openSummaries })
    await waitFor(() => expect(openSummaries).toHaveBeenCalled())
    unmount()

    summariesCall.resolve([{ patientId: 'p1', ok: true, name: 'Ana', risk: 'elevado' }])
    await summariesCall.promise
    await Promise.resolve()
  })
})
