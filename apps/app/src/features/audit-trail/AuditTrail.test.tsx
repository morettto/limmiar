import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n } from '@lingui/core'
import { deferred } from '../../test-support/deferred'
import { AuditTrail } from './AuditTrail'

i18n.loadAndActivate({ locale: 'pt-BR', messages: {} })

const trilha = (intact: boolean) => ({ intact, firstBrokenSequence: intact ? null : 2, entries: [
  { sequence: 1, action: 'signIn', deviceId: 'abcdef12-0000-0000-0000-000000000000', recordedAt: '2026-10-07T10:00:00Z' },
] })

function resposta(corpo: unknown, ok = true) {
  return Promise.resolve(new Response(JSON.stringify(ok ? corpo : { code: 'x', params: {} }), { status: ok ? 200 : 500 }))
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('trilha de auditoria', () => {
  it('lista metadados, filtra por data e exporta CSV registando a exportação', async () => {
    const fetchMock = vi.fn((url: string) => resposta(trilha(!url.includes('to='))))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
    render(<I18nProvider i18n={i18n}><AuditTrail baseUrl="http://api" accountId="a1" accessToken="t" /></I18nProvider>)
    expect(await screen.findByText('Entrada na conta')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('íntegra')
    fireEvent.change(screen.getByLabelText('Até (exclusive)'), { target: { value: '2026-10-08' } })
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('quebrada a partir da entrada 2'))
    fireEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/audit/exports?to='))).toBe(true))
  })
  it('mostra erro quando a API falha', async () => {
    vi.stubGlobal('fetch', vi.fn(() => resposta(null, false)))
    render(<I18nProvider i18n={i18n}><AuditTrail baseUrl="http://api" accountId="a1" accessToken="t" /></I18nProvider>)
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível')
  })
  it('exporta CSV e dispara o download com as entradas', async () => {
    vi.stubGlobal('fetch', vi.fn(() => resposta(trilha(true))))
    const criar = vi.fn(() => 'blob:x')
    const revogar = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: criar, revokeObjectURL: revogar }))
    const clique = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<I18nProvider i18n={i18n}><AuditTrail baseUrl="http://api" accountId="a1" accessToken="t" /></I18nProvider>)
    await screen.findByText('Entrada na conta')
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }))
    await waitFor(() => expect(revogar).toHaveBeenCalledWith('blob:x'))
    expect(clique).toHaveBeenCalledOnce()
    const blob = (criar.mock.calls[0] as unknown as [Blob])[0]
    expect(await blob.text()).toBe('sequencia,acao,dispositivo,instante\n1,signIn,abcdef12-0000-0000-0000-000000000000,2026-10-07T10:00:00Z')
    clique.mockRestore()
  })
  it('mostra erro quando a exportação falha', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => init?.method === 'POST' ? resposta(null, false) : resposta(trilha(true))))
    render(<I18nProvider i18n={i18n}><AuditTrail baseUrl="http://api" accountId="a1" accessToken="t" /></I18nProvider>)
    await screen.findByText('Entrada na conta')
    fireEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível')
  })
  it('ignora a resposta que chega depois de desmontar', async () => {
    let soltarFetch!: (r: Response) => void
    let soltarJson!: (c: unknown) => void
    const fetchMock = vi.fn()
      .mockReturnValueOnce(new Promise<Response>((r) => { soltarFetch = r }))
      .mockReturnValueOnce(Promise.resolve(Object.assign(new Response('{}', { status: 200 }), { json: () => new Promise((r) => { soltarJson = r }) })))
    vi.stubGlobal('fetch', fetchMock)
    const a = render(<I18nProvider i18n={i18n}><AuditTrail baseUrl="http://api" accountId="a1" accessToken="t" /></I18nProvider>)
    a.unmount()
    soltarFetch(new Response('{}', { status: 200 }))
    const b = render(<I18nProvider i18n={i18n}><AuditTrail baseUrl="http://api" accountId="a1" accessToken="t" /></I18nProvider>)
    await waitFor(() => expect(soltarJson).toBeDefined())
    b.unmount()
    soltarJson(trilha(true))
    await Promise.resolve()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

const arvore = (token = 't') => <I18nProvider i18n={i18n}><AuditTrail baseUrl="http://api" accountId="a1" accessToken={token} /></I18nProvider>
const entradas = (acoes: string[]) => ({ intact: true, firstBrokenSequence: null, entries: acoes.map((action, indice) => ({ sequence: indice + 1, action, deviceId: 'abcdef12-0000-0000-0000-000000000000', recordedAt: '2026-10-07T10:00:00Z' })) })

describe('trilha de auditoria: consulta, textos e respostas tardias', () => {
  it('a primeira consulta vai sem filtro e sem alerta, com a seção nomeada', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => resposta(trilha(true)))
    vi.stubGlobal('fetch', fetchMock)
    render(arvore())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('region', { name: 'Trilha de auditoria' })).toBeTruthy()
    await screen.findByText('Entrada na conta')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]).toEqual(['http://api/accounts/a1/audit', { headers: { Authorization: 'Bearer t' } }])
    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByLabelText('Desde') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Até (exclusive)') as HTMLInputElement).value).toBe('')
  })

  it('manda cada limite de data como início do dia local em ISO, um de cada vez e os dois juntos', async () => {
    const fetchMock = vi.fn((_url: string) => resposta(trilha(true)))
    vi.stubGlobal('fetch', fetchMock)
    render(arvore())
    await screen.findByText('Entrada na conta')
    const desde = new Date('2026-10-01T00:00:00').toISOString()
    const ate = new Date('2026-10-08T00:00:00').toISOString()

    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.lastCall![0]).toBe(`http://api/accounts/a1/audit?${new URLSearchParams({ from: desde })}`)

    fireEvent.change(screen.getByLabelText('Até (exclusive)'), { target: { value: '2026-10-08' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(fetchMock.mock.lastCall![0]).toBe(`http://api/accounts/a1/audit?${new URLSearchParams({ from: desde, to: ate })}`)

    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect(fetchMock.mock.lastCall![0]).toBe(`http://api/accounts/a1/audit?${new URLSearchParams({ to: ate })}`)
  })

  it('mostra cada ação com seu nome, o início da sessão e o instante formatado', async () => {
    vi.stubGlobal('fetch', vi.fn(() => resposta(entradas(['signIn', 'signOut', 'recordOpened', 'recordAppended', 'noteSigned', 'exportRequested']))))
    render(arvore())
    await screen.findByText('Entrada na conta')
    const linhas = within(screen.getByRole('table')).getAllByRole('row').slice(1).map((linha) => within(linha).getAllByRole('cell').map((celula) => celula.textContent))
    const instante = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date('2026-10-07T10:00:00Z'))
    expect(linhas).toEqual([
      ['1', 'Entrada na conta', 'abcdef12', instante],
      ['2', 'Saída da conta', 'abcdef12', instante],
      ['3', 'Prontuário aberto', 'abcdef12', instante],
      ['4', 'Registro acrescentado ao prontuário', 'abcdef12', instante],
      ['5', 'Nota assinada', 'abcdef12', instante],
      ['6', 'Trilha exportada', 'abcdef12', instante],
    ])
  })

  it('baixa o CSV com o tipo e o nome certos', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, _init?: RequestInit) => resposta(trilha(true))))
    const criar = vi.fn((_blob: Blob) => 'blob:x')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: criar, revokeObjectURL: vi.fn() }))
    let nome = ''
    const clique = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { nome = this.download })
    render(arvore())
    await screen.findByText('Entrada na conta')
    fireEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }))
    await waitFor(() => expect(clique).toHaveBeenCalledOnce())
    expect(criar.mock.calls[0]![0].type).toBe('text/csv')
    expect(nome).toBe('trilha-auditoria.csv')
    expect(vi.mocked(fetch).mock.calls.at(-1)![1]).toEqual({ method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: undefined })
  })

  it('uma resposta tardia da sessão anterior não substitui a trilha atual nem acende o alerta', async () => {
    const antiga = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(antiga.promise).mockImplementation(() => resposta(trilha(true))))
    const view = render(arvore('token-antigo'))
    view.rerender(arvore('token-novo'))
    await screen.findByText('Entrada na conta')

    await act(async () => antiga.resolve(new Response(JSON.stringify({ code: 'x', params: {} }), { status: 500 })))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Entrada na conta')).toBeTruthy()
  })

  it('um corpo tardio da sessão anterior não substitui a trilha atual', async () => {
    const corpo = deferred<unknown>()
    const lendo = vi.fn()
    const resposta1 = Object.assign(new Response('{}', { status: 200 }), { json: () => { lendo(); return corpo.promise } })
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(Promise.resolve(resposta1)).mockImplementation(() => resposta(trilha(true))))
    const view = render(arvore('token-antigo'))
    await waitFor(() => expect(lendo).toHaveBeenCalled())
    view.rerender(arvore('token-novo'))
    await screen.findByText('Entrada na conta')

    await act(async () => corpo.resolve(entradas(['signOut'])))

    expect(screen.queryByText('Saída da conta')).toBeNull()
    expect(screen.getByText('Entrada na conta')).toBeTruthy()
  })
})
