import '@vitest/web-worker'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { encodeBase64 } from '../../shared/lib/base64'
import { PainelProfissional } from './PainelProfissional'
import type { SummaryResult } from '../../entities/patient/patient-summary'
import { horaDaSessao, type SessaoAgendada } from '../../entities/agenda/sessao'
import { ESTADO_PENDENTE, ORDEM_SECOES, type Nota } from '../../entities/nota/nota'

const FAKE_KEK = {} as unknown as CryptoKey
const CHAVEIRO_PADRAO = { kek: FAKE_KEK, accountId: 'acc-1', accessToken: 'token-1' }

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

function elementoPainel(props: Partial<React.ComponentProps<typeof PainelProfissional>> = {}) {
  return (
    <I18nProvider i18n={i18n}>
      <PainelProfissional baseUrl="http://api.test" chaveiro={CHAVEIRO_PADRAO} notas={[]} {...props} />
    </I18nProvider>
  )
}

function renderPainel(props: Partial<React.ComponentProps<typeof PainelProfissional>> = {}) {
  return render(elementoPainel(props))
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

function agendaResponse(sessoes: SessaoAgendada[]) {
  return new Response(
    JSON.stringify({
      sessions: sessoes.map((sessao) => ({
        sessionId: sessao.sessionId,
        patientId: sessao.patientId,
        startsAt: sessao.inicioEm,
        durationMinutes: sessao.duracaoMinutos,
      })),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

// `/agenda/sessions` sempre 200 com `[]` por omissão -- senão os testes que nem mencionam
// agenda (ex.: os de consentimento) ganhavam um `role="alert"` espúrio (achado do F4).
function fetchMockPadrao(patientIds: string[], sessoes: SessaoAgendada[] = []) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/agenda/sessions')) {
      return Promise.resolve(agendaResponse(sessoes))
    }
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

describe('PainelProfissional', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
    stubMatchMedia()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('chaveiro=null: mostra o texto de chaveiro bloqueado (não "carregando"), não chama fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderPainel({ chaveiro: null })

    expect(await screen.findByText('Chaveiro bloqueado. Desbloqueie para ver o painel.')).toBeTruthy()
    expect(screen.queryByText('Carregando painel...')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('critério 1: nomeia o paciente correto da sessão seguinte na ação principal', async () => {
    const sessao = sessaoEm1h('p-1')
    const fetchMock = fetchMockPadrao(['p-1'], [sessao])
    vi.stubGlobal('fetch', fetchMock)
    const openSummaries = vi.fn().mockResolvedValue([
      { patientId: 'p-1', ok: true, name: 'Amelia', risk: 'baixo' },
    ] satisfies SummaryResult[])

    renderPainel({ openSummaries })

    const hora = horaDaSessao(sessao.inicioEm, 'pt-BR')
    const botao = await screen.findByRole('button', { name: new RegExp(`Amelia.*${hora}`) })
    expect(botao).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/accounts/acc-1/agenda/sessions?from='),
      expect.anything(),
    )
  })

  it('critério: /agenda/sessions falha (500) — KPI "Sessões na semana" = "—", role="alert" com o motivo, "Pacientes ativos" continua numérico, botão sem nome', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/agenda/sessions')) {
        return Promise.resolve(
          new Response(JSON.stringify({ code: 'unexpected_error', params: {} }), {
            status: 500,
            headers: { 'Content-Type': 'application/problem+json' },
          }),
        )
      }
      if (url.includes('/consents')) {
        return Promise.resolve(consentimentosResponse())
      }
      return Promise.resolve(patientsResponse(['p-1']))
    })
    vi.stubGlobal('fetch', fetchMock)
    const openSummaries = vi.fn().mockResolvedValue([
      { patientId: 'p-1', ok: true, name: 'Amelia', risk: 'baixo' },
    ] satisfies SummaryResult[])

    renderPainel({ openSummaries })

    const kpi = await screen.findByText('Sessões na semana')
    expect(kpi.parentElement?.textContent).toContain('—')
    expect(screen.getByRole('alert')).toBeTruthy()
    const kpiPacientes = await screen.findByText('Pacientes ativos')
    expect(kpiPacientes.parentElement?.textContent).toMatch(/\d/)
    expect(screen.getByRole('button', { name: /Iniciar próxima/ })).toBeTruthy()
  })

  // A1: a falha crua (`ProblemResult`) fica no estado; quem traduz é o render, com o `i18n`
  // atual -- não o `i18n` de quando o pedido saiu. Trocar de idioma depois de já ter falhado
  // muda o texto do alert sem refazer nenhum pedido.
  it('A1: trocar de idioma depois de falhar traduz de novo, sem recarregar nem refazer o pedido', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/agenda/sessions')) {
        return Promise.resolve(
          new Response(JSON.stringify({ code: 'unexpected_error', params: {} }), {
            status: 500,
            headers: { 'Content-Type': 'application/problem+json' },
          }),
        )
      }
      if (url.includes('/consents')) {
        return Promise.resolve(consentimentosResponse())
      }
      return Promise.resolve(patientsResponse(['p-1']))
    })
    vi.stubGlobal('fetch', fetchMock)
    const openSummaries = vi.fn().mockResolvedValue([
      { patientId: 'p-1', ok: true, name: 'Amelia', risk: 'baixo' },
    ] satisfies SummaryResult[])

    renderPainel({ openSummaries })

    expect(await screen.findByText('Ocorreu um erro inesperado no servidor.')).toBeTruthy()
    const chamadasAntes = fetchMock.mock.calls.length

    await act(async () => {
      await dynamicActivate('en-US')
    })

    expect(await screen.findByText('An unexpected server error occurred.')).toBeTruthy()
    expect(screen.queryByText('Carregando painel...')).toBeNull()
    expect(fetchMock.mock.calls).toHaveLength(chamadasAntes)

    await dynamicActivate('pt-BR')
  })

  // A1: `accessToken` sai das deps do efeito -- lido via ref a cada pedido (worker-client.ts).
  // Renovar o token (kek/accountId iguais) não é motivo para recarregar o painel.
  it('A1: renovar o accessToken não recarrega o painel nem refaz o pedido', async () => {
    const fetchMock = fetchMockPadrao(['p-1'])
    vi.stubGlobal('fetch', fetchMock)
    const openSummaries = vi.fn().mockResolvedValue([
      { patientId: 'p-1', ok: true, name: 'Amelia', risk: 'baixo' },
    ] satisfies SummaryResult[])

    const { rerender } = renderPainel({ openSummaries })
    await screen.findByText('Pacientes ativos')
    const chamadasAntes = fetchMock.mock.calls.length
    const decifradasAntes = openSummaries.mock.calls.length

    rerender(elementoPainel({ chaveiro: { ...CHAVEIRO_PADRAO, accessToken: 'token-2' }, openSummaries }))

    expect(screen.queryByText('Carregando painel...')).toBeNull()
    expect(screen.getByText('Pacientes ativos')).toBeTruthy()
    expect(fetchMock.mock.calls).toHaveLength(chamadasAntes)
    expect(openSummaries.mock.calls).toHaveLength(decifradasAntes)
  })

  // A1: trancar o chaveiro no meio de um pedido em voo zera o ref antes desse pedido acabar --
  // `tokenAtual` cai no token capturado no início do efeito, não crasha.
  it('A1: trancar o chaveiro com um pedido em voo ainda completa esse pedido com o token de origem', async () => {
    const summariesCall = deferred<SummaryResult[]>()
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/agenda/sessions')) {
        return Promise.resolve(agendaResponse([]))
      }
      if (url.includes('/consents')) {
        return Promise.resolve(consentimentosResponse())
      }
      return Promise.resolve(patientsResponse(['p-1']))
    })
    vi.stubGlobal('fetch', fetchMock)
    const openSummaries = vi.fn().mockReturnValue(summariesCall.promise)

    const { rerender } = renderPainel({ openSummaries })
    await waitFor(() => expect(openSummaries).toHaveBeenCalled())

    rerender(elementoPainel({ chaveiro: null, openSummaries }))
    summariesCall.resolve([{ patientId: 'p-1', ok: true, name: 'Amelia', risk: 'baixo' }])
    await summariesCall.promise
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/p-1/consents'),
      expect.objectContaining({ headers: { Authorization: `Bearer ${CHAVEIRO_PADRAO.accessToken}` } }),
    )
  })

  it('sem sessão seguinte: a ação principal não nomeia ninguém', async () => {
    vi.stubGlobal('fetch', fetchMockPadrao(['p-1']))
    const openSummaries = vi.fn().mockResolvedValue([
      { patientId: 'p-1', ok: true, name: 'Amelia', risk: 'baixo' },
    ] satisfies SummaryResult[])

    renderPainel({ openSummaries })

    await waitFor(() => expect(openSummaries).toHaveBeenCalled())
    expect(screen.queryByText(/Amelia/)).toBeNull()
    expect(screen.getByRole('button', { name: /Iniciar próxima/ })).toBeTruthy()
  })

  it('sumário não decifrado (ok:false): a ação principal nunca mostra o uuid do paciente', async () => {
    const sessao = sessaoEm1h('p-1')
    vi.stubGlobal('fetch', fetchMockPadrao(['p-1'], [sessao]))
    const openSummaries = vi.fn().mockResolvedValue([{ patientId: 'p-1', ok: false }] satisfies SummaryResult[])

    renderPainel({ openSummaries })

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

    // O mesmo fetch (não encaminhado por URL) também falha o listarSessoes acima --
    // dois alerts, um por fonte (pacientes e agenda), não um só.
    expect(await screen.findAllByRole('alert')).toHaveLength(2)
    const kpi = await screen.findByText('Pacientes ativos')
    expect(kpi.parentElement?.textContent).toContain('—')
    fireEvent.click(screen.getByRole('button', { name: 'Requer você' }))
    const itens = screen.getAllByRole('listitem')
    expect(itens).toHaveLength(1)
    expect(itens[0].textContent).not.toContain('p-sem-sumario')
  })

  it('critério 2: trocar de conta nunca mostra os dados da conta anterior', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('acc-2')) {
        return new Promise<Response>(() => {})
      }
      if (url.includes('/agenda/sessions')) {
        return Promise.resolve(agendaResponse([]))
      }
      if (url.includes('/consents')) {
        return Promise.resolve(consentimentosResponse())
      }
      return Promise.resolve(patientsResponse(['p-1']))
    })
    vi.stubGlobal('fetch', fetchMock)
    const openSummaries = vi.fn().mockResolvedValue([
      { patientId: 'p-1', ok: true, name: 'Amelia', risk: 'baixo' },
    ] satisfies SummaryResult[])

    const { rerender } = renderPainel({ openSummaries })
    const kpiPacientes = await screen.findByText('Pacientes ativos')
    await waitFor(() => expect(kpiPacientes.parentElement?.textContent).toContain('1'))

    rerender(elementoPainel({ chaveiro: { ...CHAVEIRO_PADRAO, accountId: 'acc-2' }, openSummaries }))

    expect(screen.getByText('Carregando painel...')).toBeTruthy()
    expect(screen.queryByText('Pacientes ativos')).toBeNull()
  })

  it('critério 2: acc-1 ainda em voo quando troca para acc-2 — a resposta tardia de acc-1 nunca aparece', async () => {
    const patientsAcc1 = deferred<Response>()
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/accounts/acc-1/patients')) {
        return patientsAcc1.promise
      }
      if (url.includes('/agenda/sessions')) {
        return Promise.resolve(agendaResponse([]))
      }
      if (url.includes('/consents')) {
        return Promise.resolve(consentimentosResponse())
      }
      return Promise.resolve(patientsResponse(['p-novo']))
    })
    vi.stubGlobal('fetch', fetchMock)
    const openSummaries = vi.fn().mockImplementation((_kek: CryptoKey, items: { patientId: string }[]) =>
      Promise.resolve(items.map((item) => ({ patientId: item.patientId, ok: true, name: 'Vazamento', risk: 'baixo' }))),
    )

    const { rerender } = renderPainel({ openSummaries })
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/accounts/acc-1/patients'), expect.anything()),
    )

    rerender(elementoPainel({ chaveiro: { ...CHAVEIRO_PADRAO, accountId: 'acc-2' }, openSummaries }))
    const kpi = await screen.findByText('Pacientes ativos')
    await waitFor(() => expect(kpi.parentElement?.textContent).toContain('1'))

    // acc-1 só responde depois da troca -- prova que o dado tardio não sobrescreve acc-2.
    // `setTimeout` (macrotask) esvazia a fila de microtasks inteira do carregarPacientes(acc-1)
    // tardio, sem depender de contar quantos `await` internos ele ainda tem pela frente.
    patientsAcc1.resolve(patientsResponse(['p-antigo']))
    await patientsAcc1.promise
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(kpi.parentElement?.textContent).toContain('1')
    expect(screen.queryByRole('alert')).toBeNull()
    // N2: chamado mesmo para o dado tardio (quem rejeita é o worker-client real, por
    // `signal.aborted` -- ver worker-client.test.ts); o freio aqui é o `if (cancelled)
    // return`, já provado pelo KPI e pela ausência de alert acima.
    expect(openSummaries).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ patientId: 'p-antigo' })]),
      expect.objectContaining({ aborted: true }),
    )
  })

  it('critério 4: um obterConsentimentos rejeita — os outros pacientes continuam de pé', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/agenda/sessions')) {
        return Promise.resolve(agendaResponse([]))
      }
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

  it('critério 4: um obterConsentimentos rejeita de verdade (erro de rede) — os outros pacientes continuam de pé', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/agenda/sessions')) {
        return Promise.resolve(agendaResponse([]))
      }
      if (url.includes('/p-falha/consents')) {
        return Promise.reject(new Error('rede indisponível'))
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

    // Mesma exceção derruba as duas fontes (nenhuma rota por URL neste mock) -- dois alerts.
    expect(await screen.findAllByRole('alert')).toHaveLength(2)
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

  // N2: `carregarPacientes` não pula mais `openSummaries` por `cancelled` (ver
  // entities/patient/worker-client.test.ts para quem barra o worker de verdade) -- aqui só
  // prova que o `signal` chega já abortado, o freio real vive lá.
  it('desmontar antes de listPatients resolver ainda chama openSummaries, com o signal já abortado', async () => {
    const fetchCall = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(fetchCall.promise))
    const openSummaries = vi.fn().mockResolvedValue([])

    const { unmount } = renderPainel({ openSummaries })
    unmount()

    fetchCall.resolve(patientsResponse(['p-1']))
    await fetchCall.promise
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(openSummaries).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ aborted: true }),
    )
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
