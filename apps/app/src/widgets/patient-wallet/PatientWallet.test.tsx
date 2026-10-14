import '@vitest/web-worker'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { I18nProvider } from '@lingui/react'
import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { encodeBase64 } from '../../shared/lib/base64'
import { deferred } from '../../test-support/deferred'
import { PatientWallet } from './PatientWallet'
import { sealNewPatient } from '../../entities/patient/patient-crypto'
import type { SealedSummary, SummaryResult } from '../../entities/patient/patient-summary'

const FAKE_KEK = {} as unknown as CryptoKey

// jsdom has no matchMedia; AdaptiveTable's useBreakpoint hook needs one to mount at all.
// A fixed "matches: false" (-> sm/card layout) is enough here -- breakpoint-specific
// rendering is proven by AdaptiveTable's own suite and the Playwright CT spec, not here.
function stubMatchMedia(wide = false) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: wide,
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

  it('locking the keyring while decryption is pending never reveals the stale patient names', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(patientsResponse(['p1'])), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })))
    const summaries = deferred<SummaryResult[]>()
    const openSummaries = vi.fn().mockReturnValue(summaries.promise)
    const { rerender } = renderWallet({ openSummaries })
    await waitFor(() => expect(openSummaries).toHaveBeenCalledOnce())
    const signal = openSummaries.mock.calls[0]![2] as AbortSignal
    rerender(<I18nProvider i18n={i18n}><PatientWallet baseUrl="http://api.test" accountId="acc-1" accessToken="token-1" kek={null} openSummaries={openSummaries} /></I18nProvider>)
    expect(signal.aborted).toBe(true)
    await act(async () => { summaries.resolve([{ patientId: 'p1', ok: true, name: 'Stale patient', risk: 'baixo' }]); await summaries.promise })
    expect(screen.getByText('Chaveiro bloqueado. Desbloqueie para ver a carteira de pacientes.')).toBeTruthy()
    expect(screen.queryByText('Stale patient')).toBeNull()
  })
})

function jsonResponse(body: unknown, status = 200, type = 'application/json') {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } })
}

describe('PatientWallet: apresentação e ciclo de vida', () => {
  beforeAll(async () => { await dynamicActivate('pt-BR') })
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); stubMatchMedia() })

  it('antes de qualquer efeito, a chave nula já aparece bloqueada e a chave presente já aparece carregando', () => {
    const com = (kek: CryptoKey | null) => renderToString(<I18nProvider i18n={i18n}><PatientWallet baseUrl="http://api.test" accountId="acc-1" accessToken="token-1" kek={kek} /></I18nProvider>)
    expect(com(null)).toContain('Chaveiro bloqueado.')
    expect(com(FAKE_KEK)).toContain('Carregando pacientes...')
  })

  it('na tabela mostra legenda, colunas, nome e risco por extenso e a célula vazia do item ilegível', async () => {
    stubMatchMedia(true)
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(patientsResponse(['a', 'b', 'c', 'd']))))
    const resultados: SummaryResult[] = [
      { patientId: 'a', ok: true, name: 'Ana', risk: 'elevado' },
      { patientId: 'b', ok: true, name: 'Bruno', risk: 'moderado' },
      { patientId: 'c', ok: true, name: 'Caio', risk: 'baixo' },
      { patientId: 'd', ok: false },
    ]
    renderWallet({ openSummaries: vi.fn().mockResolvedValue(resultados) })

    const tabela = await screen.findByRole('table', { name: 'Pacientes' })
    expect(within(tabela).getAllByRole('columnheader').map((cabecalho) => cabecalho.textContent)).toEqual(['Paciente', 'Risco'])
    const linhas = within(tabela).getAllByRole('row').slice(1).map((linha) => within(linha).getAllByRole('cell').map((celula) => celula.textContent))
    expect(linhas).toEqual([['Ana', 'Elevado'], ['Bruno', 'Moderado'], ['Caio', 'Baixo'], ['Não foi possível ler', '']])
    expect(erro).not.toHaveBeenCalled()
  })

  it('uma falha problem+json mostra o motivo do servidor, não a mensagem genérica', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 'auth.forbidden', params: {} }, 403, 'application/problem+json')))
    const openSummaries = vi.fn()
    renderWallet({ openSummaries })
    expect((await screen.findByRole('alert')).textContent).toBe('Você não tem acesso a esta conta.')
    expect(openSummaries).not.toHaveBeenCalled()
  })

  it('desmontar interrompe a decifragem em andamento e não antes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(patientsResponse(['p1']))))
    const decifragem = deferred<SummaryResult[]>()
    const openSummaries = vi.fn().mockReturnValue(decifragem.promise)
    const { unmount } = renderWallet({ openSummaries })
    await waitFor(() => expect(openSummaries).toHaveBeenCalled())
    const sinal = openSummaries.mock.calls[0]![2] as AbortSignal
    expect(sinal.aborted).toBe(false)
    unmount()
    expect(sinal.aborted).toBe(true)
  })

  it('desmontar antes da listagem terminar nunca chega a decifrar', async () => {
    const listagem = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(listagem.promise))
    const openSummaries = vi.fn()
    const { unmount } = renderWallet({ openSummaries })
    unmount()
    listagem.resolve(jsonResponse(patientsResponse(['p1'])))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(openSummaries).not.toHaveBeenCalled()
  })

  it('recomeça a carteira quando a sessão muda e ignora o que a anterior devolver depois', async () => {
    const antiga = deferred<SummaryResult[]>()
    const atual = deferred<SummaryResult[]>()
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse(patientsResponse(['p1']))))
    const openSummaries = vi.fn().mockReturnValueOnce(antiga.promise).mockReturnValueOnce(atual.promise)
    const view = renderWallet({ openSummaries })
    await waitFor(() => expect(openSummaries).toHaveBeenCalledTimes(1))
    view.rerender(<I18nProvider i18n={i18n}><PatientWallet baseUrl="http://api.test" accountId="acc-1" accessToken="token-2" kek={FAKE_KEK} openSummaries={openSummaries} /></I18nProvider>)
    expect(screen.getByRole('status').textContent).toBe('Carregando pacientes...')
    await waitFor(() => expect(openSummaries).toHaveBeenCalledTimes(2))

    await act(async () => antiga.resolve([{ patientId: 'p1', ok: true, name: 'Antiga', risk: 'baixo' }]))
    expect(screen.queryByText('Antiga')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Carregando pacientes...')
    await act(async () => atual.resolve([{ patientId: 'p1', ok: true, name: 'Atual', risk: 'baixo' }]))
    expect(await screen.findByText('Atual')).toBeTruthy()
  })

  it('uma falha tardia da sessão anterior não derruba a carteira atual', async () => {
    const listagemAntiga = deferred<Response>()
    const fetchMock = vi.fn().mockReturnValueOnce(listagemAntiga.promise).mockImplementation(async () => jsonResponse(patientsResponse(['p1'])))
    vi.stubGlobal('fetch', fetchMock)
    const openSummaries = vi.fn().mockResolvedValue([{ patientId: 'p1', ok: true, name: 'Atual', risk: 'baixo' }])
    const view = renderWallet({ openSummaries })
    view.rerender(<I18nProvider i18n={i18n}><PatientWallet baseUrl="http://api.test" accountId="acc-1" accessToken="token-2" kek={FAKE_KEK} openSummaries={openSummaries} /></I18nProvider>)
    expect(await screen.findByText('Atual')).toBeTruthy()

    await act(async () => listagemAntiga.reject(new Error('rede caiu')))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Atual')).toBeTruthy()
  })

  it('uma chave que volta a ser nula bloqueia a carteira', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse(patientsResponse(['p1']))))
    const openSummaries = vi.fn().mockResolvedValue([{ patientId: 'p1', ok: true, name: 'Ana', risk: 'baixo' }])
    const view = renderWallet({ openSummaries })
    expect(await screen.findByText('Ana')).toBeTruthy()
    view.rerender(<I18nProvider i18n={i18n}><PatientWallet baseUrl="http://api.test" accountId="acc-1" accessToken="token-1" kek={null} openSummaries={openSummaries} /></I18nProvider>)
    expect(screen.getByText('Chaveiro bloqueado. Desbloqueie para ver a carteira de pacientes.')).toBeTruthy()
    expect(screen.queryByText('Ana')).toBeNull()
  })
})
