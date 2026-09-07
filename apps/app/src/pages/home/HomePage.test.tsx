import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { dynamicActivate, i18n } from '../../shared/i18n'
import type { Account } from '../../entities/account'
import { SessionContext, type ContextoSessao } from '../../entities/account/session-context'
import { HomePage } from './HomePage'

// HomePage.tsx importa `Link` só para montar o href -- dublado aqui para o teste não
// depender de RouterProvider (ver S18-04: "sem depender do router").
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}))

const ACCOUNT: Account = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'conta@example.com',
  role: 'Professional',
  twoFactorRequirement: 'NotApplicable',
  twoFactorTicket: null,
}

function renderHomePage(sessao: Account | null, terminarSessao: () => void = vi.fn()) {
  const value: ContextoSessao = { sessao, iniciarSessao: vi.fn(), terminarSessao }
  return render(
    <I18nProvider i18n={i18n}>
      <SessionContext.Provider value={value}>
        <HomePage />
      </SessionContext.Provider>
    </I18nProvider>,
  )
}

describe('HomePage', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
  })

  it('sempre mostra o app-shell e o link para /settings/copilot', () => {
    renderHomePage(null)

    const shell = screen.getByText('Limmiar', { exact: false })
    expect(shell.id).toBe('app-shell')
    const link = screen.getByRole('link', { name: 'Configurar copiloto de IA' })
    expect(link.getAttribute('href')).toBe('/settings/copilot')
  })

  it('com sessão: mostra o email da conta em sessão e o botão "Sair", que chama terminarSessao ao clicar', () => {
    const terminarSessao = vi.fn()
    renderHomePage(ACCOUNT, terminarSessao)

    expect(screen.getByTestId('conta-sessao').textContent).toBe(ACCOUNT.email)
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))

    expect(terminarSessao).toHaveBeenCalledTimes(1)
  })

  it('sem sessão (sessao=null): não mostra a conta em sessão nem o botão "Sair"', () => {
    renderHomePage(null)

    expect(screen.queryByTestId('conta-sessao')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sair' })).toBeNull()
  })
})
