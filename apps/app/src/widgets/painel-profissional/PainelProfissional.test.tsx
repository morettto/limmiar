import '@vitest/web-worker'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { encodeBase64 } from '../../shared/lib/base64'
import { estadoInicial, PainelProfissional } from './PainelProfissional'
import type { SummaryResult } from '../../entities/patient/patient-summary'
import { horaDaSessao, type SessaoAgendada } from '../../entities/agenda/sessao'
import { ESTADO_PENDENTE, ORDEM_SECOES, type Nota } from '../../entities/nota/nota'

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

// jsdom has no matchMedia; AdaptivePanel's useBreakpoint hook needs one to mount at all.
function stubMatchMedia() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

function renderPainel(props: Partial<React.ComponentProps<typeof PainelProfissional>> = {}) {
  return render(
    <I18nProvider i18n={i18n}>
      <PainelProfissional
        baseUrl="http://api.test"
        accountId="acc-1"
        accessToken="token-1"
        kek={FAKE_KEK}
        notas={[]}
        sessoes={[]}
        {...props}
      />
    </I18nProvider>,
  )
}

function patientsResponse(patientIds: string[]) {
  return new Response(
    JSON.stringify({
      patients: patientIds.map((patientId) => ({
        patientId,
        wrappedDek: encodeBase64(new Uint8Array([1, 2, 3])),
        ciphertext: encodeBase64(new Uint8Array([4, 5, 6])),
        createdAt: '2026-08-14T10:00:00Z',
      })),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

function consentimentosResponse() {
  return new Response(JSON.stringify({ gravacao: 'concedido', analiseIa: 'concedido' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function fetchMockPadrao(patientIds: string[]) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/consents')) {
      return Promise.resolve(consentimentosResponse())
    }
    return Promise.resolve(patientsResponse(patientIds))
  })
}

function sessaoEm1h(patientId: string): SessaoAgendada {
  return {
    sessionId: 's-1',
    patientId,
    inicioEm: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    duracaoMinutos: 50,
    canceladaEm: null,
  }
}

function nota(overrides: Partial<Nota> = {}): Nota {
  return {
    id: 'nota-1',
    patientId: 'p-sem-sumario',
    revisao: 0,
    frases: ORDEM_SECOES.map((secao) => ({ id: `${secao}-0`, secao, texto: '', ancoras: [] })),
    estado: ESTADO_PENDENTE,
    ...overrides,
  }
}

describe('estadoInicial', () => {
  // `estadoInicial` divergia do `useEffect` (só olhava `kek`) -- flash de "Carregando...".
  // `render()` não apanha (act() já resolve o efeito antes de devolver); teste direto na
  // função, a fonte real da guarda unificada (ver README).
  it('kek presente mas accountId=null também começa bloqueado, não "a-carregar"', () => {
    expect(estadoInicial(FAKE_KEK, null, 'token-1')).toEqual({ status: 'bloqueado' })
  })

  it('kek presente mas accessToken=null também começa bloqueado, não "a-carregar"', () => {
    expect(estadoInicial(FAKE_KEK, 'acc-1', null)).toEqual({ status: 'bloqueado' })
  })

  it('kek=null começa bloqueado', () => {
    expect(estadoInicial(null, 'acc-1', 'token-1')).toEqual({ status: 'bloqueado' })
  })

  it('kek, accountId e accessToken presentes começa "a-carregar"', () => {
    expect(estadoInicial(FAKE_KEK, 'acc-1', 'token-1')).toEqual({ status: 'a-carregar' })
  })
})

describe('PainelProfissional', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
    stubMatchMedia()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('kek=null: mostra o texto de chaveiro bloqueado (não "carregando"), não chama fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderPainel({ kek: null })

    expect(await screen.findByText('Chaveiro bloqueado. Desbloqueie para ver o painel.')).toBeTruthy()
    expect(screen.queryByText('Carregando painel...')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accountId=null (mesmo com kek presente): mostra o mesmo texto de bloqueado, não chama fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderPainel({ accountId: null })

    expect(await screen.findByText('Chaveiro bloqueado. Desbloqueie para ver o painel.')).toBeTruthy()
    expect(screen.queryByText('Carregando painel...')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('critério 1: nomeia o paciente correto da sessão seguinte na ação principal', async () => {
    vi.stubGlobal('fetch', fetchMockPadrao(['p-1']))
    const sessao = sessaoEm1h('p-1')
    const openSummaries = vi.fn().mockResolvedValue([
      { patientId: 'p-1', ok: true, name: 'Amelia', risk: 'baixo' },
    ] satisfies SummaryResult[])

    renderPainel({ sessoes: [sessao], openSummaries })

    const hora = horaDaSessao(sessao.inicioEm, 'pt-BR')
    const botao = await screen.findByRole('button', { name: new RegExp(`Amelia.*${hora}`) })
    expect(botao).toBeTruthy()
  })

  it('sem sessão seguinte: a ação principal não nomeia ninguém', async () => {
    vi.stubGlobal('fetch', fetchMockPadrao(['p-1']))
    const openSummaries = vi.fn().mockResolvedValue([
      { patientId: 'p-1', ok: true, name: 'Amelia', risk: 'baixo' },
    ] satisfies SummaryResult[])

    renderPainel({ sessoes: [], openSummaries })

    await waitFor(() => expect(openSummaries).toHaveBeenCalled())
    expect(screen.queryByText(/Amelia/)).toBeNull()
    expect(screen.getByRole('button', { name: /Iniciar próxima/ })).toBeTruthy()
  })

  it('sumário não decifrado (ok:false): a ação principal nunca mostra o uuid do paciente', async () => {
    vi.stubGlobal('fetch', fetchMockPadrao(['p-1']))
    const sessao = sessaoEm1h('p-1')
    const openSummaries = vi.fn().mockResolvedValue([{ patientId: 'p-1', ok: false }] satisfies SummaryResult[])

    renderPainel({ sessoes: [sessao], openSummaries })

    await waitFor(() => expect(openSummaries).toHaveBeenCalled())
    const botao = screen.getByRole('button', { name: /Iniciar próxima/ })
    expect(botao.textContent).not.toContain('p-1')
  })

  it('critério 4: listPatients falha (500) — role="alert", KPI "Pacientes ativos" = "—", assinatura continua na fila', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 'auth.forbidden', params: {} }), {
          status: 500,
          headers: { 'Content-Type': 'application/problem+json' },
        }),
      ),
    )
    const notas: Nota[] = [nota()]

    renderPainel({ notas })

    expect(await screen.findByRole('alert')).toBeTruthy()
    const kpi = await screen.findByText('Pacientes ativos')
    expect(kpi.parentElement?.textContent).toContain('—')
    fireEvent.click(screen.getByRole('button', { name: 'Requer você' }))
    const itens = screen.getAllByRole('listitem')
    expect(itens).toHaveLength(1)
    expect(itens[0].textContent).not.toContain('p-sem-sumario')
  })

  it('critério 4: um obterConsentimentos rejeita — os outros pacientes continuam de pé', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/p-falha/consents')) {
        return Promise.resolve(
          new Response(JSON.stringify({ code: 'consent.not_authorized_to_record', params: {} }), {
            status: 403,
            headers: { 'Content-Type': 'application/problem+json' },
          }),
        )
      }
      if (url.includes('/consents')) {
        return Promise.resolve(consentimentosResponse())
      }
      return Promise.resolve(patientsResponse(['p-falha', 'p-ok']))
    })
    vi.stubGlobal('fetch', fetchMock)
    const openSummaries = vi.fn().mockResolvedValue([
      { patientId: 'p-falha', ok: true, name: 'Carla', risk: 'baixo' },
      { patientId: 'p-ok', ok: true, name: 'Duda', risk: 'baixo' },
    ] satisfies SummaryResult[])

    renderPainel({ openSummaries })

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/p-ok/consents'), expect.anything()),
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('critério 3: mostra exatamente dois KPI ("Pacientes ativos" e "Sessões na semana"), sem métrica de vaidade', async () => {
    vi.stubGlobal('fetch', fetchMockPadrao(['p-1']))
    const openSummaries = vi.fn().mockResolvedValue([
      { patientId: 'p-1', ok: true, name: 'Amelia', risk: 'baixo' },
    ] satisfies SummaryResult[])

    renderPainel({ openSummaries })

    const grupo = await screen.findByRole('group', { name: 'Indicadores' })
    await waitFor(() => expect(screen.getByText('Pacientes ativos')).toBeTruthy())
    expect(grupo.children).toHaveLength(2)
    expect(screen.getByText('Sessões na semana')).toBeTruthy()
    expect(screen.queryByText(/notas assinadas/i)).toBeNull()
    expect(screen.queryByText(/insights/i)).toBeNull()
  })

  it('uma exceção lançada (não um ProblemResult) também cai no estado de erro genérico, sem crash', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('rede indisponível')))

    renderPainel({})

    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('desmontar antes de listPatients rejeitar ignora o fallback de erro (cancelled=true no catch)', async () => {
    const fetchCall = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(fetchCall.promise))

    const { unmount } = renderPainel({})
    unmount()

    fetchCall.reject(new Error('rede indisponível'))
    await fetchCall.promise.catch(() => {})
    await Promise.resolve()
  })

  it('desmontar antes de listPatients resolver cancela antes do worker decifrar', async () => {
    const fetchCall = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(fetchCall.promise))
    const openSummaries = vi.fn()

    const { unmount } = renderPainel({ openSummaries })
    unmount()

    fetchCall.resolve(patientsResponse(['p-1']))
    await fetchCall.promise
    await Promise.resolve()

    expect(openSummaries).not.toHaveBeenCalled()
  })

  it('desmontar enquanto openSummaries está pendente ignora o resultado quando chega', async () => {
    vi.stubGlobal('fetch', fetchMockPadrao(['p-1']))
    const summariesCall = deferred<SummaryResult[]>()
    const openSummaries = vi.fn().mockReturnValue(summariesCall.promise)

    const { unmount } = renderPainel({ openSummaries })
    await waitFor(() => expect(openSummaries).toHaveBeenCalled())
    unmount()

    summariesCall.resolve([{ patientId: 'p-1', ok: true, name: 'Amelia', risk: 'baixo' }])
    await summariesCall.promise
    await Promise.resolve()
  })

  it('desmontar enquanto obterConsentimentos está pendente ignora o resultado quando chega', async () => {
    const consentsCall = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/consents')) {
          return consentsCall.promise
        }
        return Promise.resolve(patientsResponse(['p-1']))
      }),
    )
    const openSummaries = vi.fn().mockResolvedValue([
      { patientId: 'p-1', ok: true, name: 'Amelia', risk: 'baixo' },
    ] satisfies SummaryResult[])

    const { unmount } = renderPainel({ openSummaries })
    await waitFor(() => expect(openSummaries).toHaveBeenCalled())
    unmount()

    consentsCall.resolve(consentimentosResponse())
    await consentsCall.promise
    await Promise.resolve()
  })
})
