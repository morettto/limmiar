import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { SessionContext } from '../../entities/account/session-context'
import type { Account } from '../../entities/account'
import { AppShell } from './AppShell'
import { useBloquearNavegacao } from './bloqueio'

const PROFISSIONAL: Account = { id: 'conta-1', email: 'doutora@example.com', role: 'Professional', twoFactorRequirement: 'NotApplicable',
  twoFactorTicket: null, accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z' }
const KEK = {} as CryptoKey
const CAMINHOS = ['/', '/pacientes', '/pacientes/p1', '/biblioteca', '/acervo', '/espelho', '/settings/copilot', '/settings/voice', '/settings/audit', '/settings/recovery', '/devices/pair-primary']
const PRINCIPAIS = [['Consultório', '/'], ['Pacientes', '/pacientes'], ['Biblioteca de notas', '/biblioteca'], ['Acervo pessoal', '/acervo'], ['Sinais compartilhados pelos pacientes', '/espelho']]
const CONFIGURACOES = [['Votos do copiloto de IA', '/settings/copilot'], ['Identificação da sua voz', '/settings/voice'], ['Trilha de auditoria', '/settings/audit'],
  ['Frase de recuperação', '/settings/recovery'], ['Parear novo dispositivo', '/devices/pair-primary']]

function Travador({ ativo = true }: { ativo?: boolean }) {
  useBloquearNavegacao(ativo)
  return null
}
function Alternador({ letra = '' }: { letra?: string }) {
  const [ativo, setAtivo] = useState(true)
  return <><Travador ativo={ativo} /><button onClick={() => setAtivo(false)}>Liberar{letra}</button></>
}

function montar({ sessao = PROFISSIONAL as Account | null, kek = KEK as CryptoKey | null, caminho = '/', conteudo = <p>conteúdo</p>, terminarSessao = vi.fn() } = {}) {
  const raiz = createRootRoute({ component: () => <AppShell><Outlet /></AppShell> })
  const rotas = CAMINHOS.map(path => createRoute({ getParentRoute: () => raiz, path, component: () => conteudo }))
  const router = createRouter({ routeTree: raiz.addChildren(rotas), history: createMemoryHistory({ initialEntries: [caminho] }) })
  render(<I18nProvider i18n={i18n}><SessionContext.Provider value={{ sessao, kek, iniciarSessao: vi.fn(), terminarSessao }}>
    <RouterProvider router={router} />
  </SessionContext.Provider></I18nProvider>)
  return { router, terminarSessao }
}
const principal = () => screen.findByRole('navigation', { name: 'Navegação principal' })
const botaoConta = () => screen.getByRole('button', { name: 'Conta' })
const botaoMenu = () => screen.getByRole('button', { name: 'Menu' })
const teclar = (alvo: Element, key: string) => fireEvent.keyDown(alvo, { key })

describe('AppShell', () => {
  beforeAll(async () => { await dynamicActivate('pt-BR') })
  afterEach(() => cleanup())

  it.each([
    ['sem sessão', { sessao: null }],
    ['paciente', { sessao: { ...PROFISSIONAL, role: 'Patient' as const } }],
    ['sem token', { sessao: { ...PROFISSIONAL, accessToken: null } }],
    ['chave bloqueada', { kek: null }],
  ])('não mostra a barra e deixa o conteúdo na tela: %s', async (_caso, opcoes) => {
    montar(opcoes)
    expect(await screen.findByText('conteúdo')).toBeTruthy()
    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Navegação principal' })).toBeNull()
    const idioma = screen.getByRole('combobox', { name: 'Idioma' })
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
    expect(screen.getByText('conteúdo').compareDocumentPosition(idioma) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('mostra a barra antes do conteúdo, com a marca e a conta', async () => {
    montar()
    const barra = await screen.findByRole('banner')
    expect(within(barra).getByRole('link', { name: 'Limmiar' }).getAttribute('href')).toBe('/')
    expect(within(screen.getByRole('navigation', { name: 'Conta' })).getByTestId('conta-sessao').textContent).toBe('doutora@example.com')
    expect(barra.compareDocumentPosition(screen.getByText('conteúdo')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('põe o único seletor de idioma na conta da barra, antes do e-mail', async () => {
    montar()
    const conta = await screen.findByRole('navigation', { name: 'Conta' })
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
    const idioma = within(conta).getByRole('combobox', { name: 'Idioma' })
    expect(idioma.compareDocumentPosition(within(conta).getByTestId('conta-sessao')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('lista os cinco destinos principais na ordem', async () => {
    montar()
    const links = within(await principal()).getAllByRole('link')
    expect(links.map(link => [link.textContent, link.getAttribute('href')])).toEqual(PRINCIPAIS)
  })

  it.each([
    ['/', 'Consultório'],
    ['/pacientes', 'Pacientes'],
    ['/pacientes/p1', 'Pacientes'],
    ['/acervo', 'Acervo pessoal'],
  ])('marca só o destino atual em %s', async (caminho, ativo) => {
    montar({ caminho })
    const atuais = within(await principal()).getAllByRole('link', { current: 'page' })
    expect(atuais.map(link => link.textContent)).toEqual([ativo])
  })

  it('leva ao destino ao clicar e passa a marcá-lo', async () => {
    const { router } = montar()
    fireEvent.click(within(await principal()).getByRole('link', { name: 'Acervo pessoal' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/acervo'))
    expect(within(await principal()).getByRole('link', { name: 'Consultório' }).getAttribute('aria-current')).toBeNull()
    expect(within(await principal()).getByRole('link', { name: 'Acervo pessoal' }).getAttribute('aria-current')).toBe('page')
  })

  it('abre as configurações pelo botão Conta e as fecha ao escolher uma', async () => {
    const { router } = montar()
    await principal()
    expect(botaoConta().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('link', { name: 'Trilha de auditoria' })).toBeNull()
    fireEvent.click(botaoConta())
    expect(botaoConta().getAttribute('aria-expanded')).toBe('true')
    const lista = document.getElementById(botaoConta().getAttribute('aria-controls')!)!
    expect(within(lista).getAllByRole('link').map(link => [link.textContent, link.getAttribute('href')])).toEqual(CONFIGURACOES)
    fireEvent.click(within(lista).getByRole('link', { name: 'Trilha de auditoria' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/settings/audit'))
    expect(screen.queryByRole('link', { name: 'Trilha de auditoria' })).toBeNull()
    expect(botaoConta().getAttribute('aria-expanded')).toBe('false')
  })

  it('fecha o painel da conta num clique fora, não num clique dentro, e fecha de novo no botão', async () => {
    montar()
    await principal()
    fireEvent.click(botaoConta())
    fireEvent.pointerDown(screen.getByRole('link', { name: 'Votos do copiloto de IA' }))
    expect(botaoConta().getAttribute('aria-expanded')).toBe('true')
    fireEvent.pointerDown(screen.getByText('conteúdo'))
    expect(botaoConta().getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(botaoConta())
    fireEvent.click(botaoConta())
    expect(botaoConta().getAttribute('aria-expanded')).toBe('false')
    fireEvent.pointerDown(screen.getByText('conteúdo'))
    expect(botaoConta().getAttribute('aria-expanded')).toBe('false')
  })

  it('abre e fecha o menu pelo botão Menu', async () => {
    montar()
    const painel = (await principal()).closest('.app-bar-panel')!
    expect(botaoMenu().getAttribute('aria-controls')).toBe(painel.id)
    expect(botaoMenu().getAttribute('aria-expanded')).toBe('false')
    expect(painel.hasAttribute('data-aberto')).toBe(false)
    fireEvent.click(botaoMenu())
    expect(botaoMenu().getAttribute('aria-expanded')).toBe('true')
    expect(painel.hasAttribute('data-aberto')).toBe(true)
    fireEvent.click(within(await principal()).getByRole('link', { name: 'Pacientes' }))
    await vi.waitFor(() => expect(botaoMenu().getAttribute('aria-expanded')).toBe('false'))
  })

  it('Esc fecha primeiro a conta, depois o menu, e devolve o foco ao botão que abriu', async () => {
    montar()
    await principal()
    fireEvent.click(botaoMenu())
    fireEvent.click(botaoConta())
    teclar(screen.getByRole('link', { name: 'Votos do copiloto de IA' }), 'Escape')
    expect(botaoConta().getAttribute('aria-expanded')).toBe('false')
    expect(botaoMenu().getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(botaoConta())
    teclar(botaoConta(), 'Escape')
    expect(botaoMenu().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(botaoMenu())
  })

  it('ignora outras teclas e o Esc com tudo fechado', async () => {
    montar()
    await principal()
    fireEvent.click(botaoMenu())
    fireEvent.click(botaoConta())
    teclar(botaoConta(), 'Tab')
    expect(botaoConta().getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(botaoConta())
    fireEvent.click(botaoMenu())
    const antes = document.activeElement
    teclar(botaoMenu(), 'Escape')
    expect(document.activeElement).toBe(antes)
  })

  it('encerra a sessão com Sair', async () => {
    const { terminarSessao } = montar()
    await principal()
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))
    expect(terminarSessao).toHaveBeenCalledOnce()
  })

  describe('bloqueio da navegação', () => {
    const AVISO = 'Aguarde o processamento da sessão antes de sair.'

    it('desabilita todos os links e o Sair enquanto uma página pede, e solta quando ela libera', async () => {
      montar({ conteudo: <Alternador /> })
      await principal()
      fireEvent.click(botaoConta())
      const links = screen.getAllByRole('link')
      expect(links).toHaveLength(1 + PRINCIPAIS.length + CONFIGURACOES.length)
      for (const link of links) {
        expect(link.getAttribute('aria-disabled')).toBe('true')
        expect(link.hasAttribute('href')).toBe(false)
      }
      expect((screen.getByRole('button', { name: 'Sair' }) as HTMLButtonElement).disabled).toBe(true)
      expect(screen.getByRole('status').textContent).toBe(AVISO)
      fireEvent.click(screen.getByRole('button', { name: 'Liberar', hidden: true }))
      expect(screen.queryByRole('status')).toBeNull()
      expect(screen.getAllByRole('link').every(link => link.hasAttribute('href'))).toBe(true)
      expect((screen.getByRole('button', { name: 'Sair' }) as HTMLButtonElement).disabled).toBe(false)
    })

    it('segue bloqueada enquanto houver outro pedido', async () => {
      montar({ conteudo: <><Alternador letra=" A" /><Alternador letra=" B" /></> })
      await principal()
      fireEvent.click(screen.getByRole('button', { name: 'Liberar A', hidden: true }))
      expect(screen.getByRole('status')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Liberar B', hidden: true }))
      expect(screen.queryByRole('status')).toBeNull()
    })
  })
})
