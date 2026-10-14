import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { AuthPage } from './AuthPage'

vi.mock('../../widgets/auth-screen/AuthScreen', () => ({
  AuthScreen: ({ baseUrl, initialRole }: { baseUrl: string; initialRole?: string }) => <p>Tela de acesso {baseUrl} com perfil {initialRole ?? 'nenhum'}</p>,
}))

function pagina(props: Partial<React.ComponentProps<typeof AuthPage>> = {}) {
  return render(<I18nProvider i18n={i18n}><AuthPage baseUrl="http://api.test" role="" {...props} /></I18nProvider>)
}

describe('AuthPage', () => {
  beforeAll(async () => { await dynamicActivate('pt-BR') })
  afterEach(cleanup)

  it('apresenta o produto e leva à recuperação, sem oferecer o pareamento por padrão', () => {
    pagina()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Bem-vindo ao Limmiar')
    expect(screen.getByText('Seu consultório, com privacidade.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Esqueci minha senha' }).getAttribute('href')).toBe('/recover')
    expect(screen.queryByRole('link', { name: 'Desbloquear pelo outro dispositivo' })).toBeNull()
  })

  it('oferece o desbloqueio pelo outro dispositivo quando o pareamento está disponível', () => {
    pagina({ pairingAvailable: true })
    expect(screen.getByRole('link', { name: 'Desbloquear pelo outro dispositivo' }).getAttribute('href')).toBe('/devices/pair-new')
  })

  it.each([
    ['Professional', 'Professional'],
    ['Patient', 'Patient'],
    ['Admin', 'nenhum'],
    ['', 'nenhum'],
  ])('perfil "%s" chega à tela de acesso como %s', (role, esperado) => {
    pagina({ role })
    expect(screen.getByText(`Tela de acesso http://api.test com perfil ${esperado}`)).toBeTruthy()
  })
})
