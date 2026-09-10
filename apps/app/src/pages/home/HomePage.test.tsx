import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { HomePage } from './HomePage'

// HomePage.tsx importa `Link` só para montar o href -- dublado aqui para o teste não
// depender de RouterProvider (ver S18-04: "sem depender do router").
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}))

function renderHomePage(
  email: string | null,
  onSair: () => void = vi.fn(),
  props: Partial<React.ComponentProps<typeof HomePage>> = {},
) {
  return render(
    <I18nProvider i18n={i18n}>
      <HomePage
        email={email}
        onSair={onSair}
        accountId={null}
        accessToken={null}
        kek={null}
        notas={[]}
        sessoes={[]}
        {...props}
      />
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

  it('com email: mostra a conta em sessão e o botão "Sair", que chama onSair ao clicar', () => {
    const onSair = vi.fn()
    renderHomePage('conta@example.com', onSair)

    expect(screen.getByTestId('conta-sessao').textContent).toBe('conta@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))

    expect(onSair).toHaveBeenCalledTimes(1)
  })

  it('sem email (email=null): não mostra a conta em sessão nem o botão "Sair"', () => {
    renderHomePage(null)

    expect(screen.queryByTestId('conta-sessao')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sair' })).toBeNull()
  })

  it('monta o painel profissional com as props da sessão (chaveiro bloqueado por omissão)', async () => {
    renderHomePage('conta@example.com')

    expect(await screen.findByText('Chaveiro bloqueado. Desbloqueie para ver o painel.')).toBeTruthy()
  })
})
