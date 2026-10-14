import { AuthScreen } from '../../widgets/auth-screen/AuthScreen'
import type { Account, AccountRole } from '../../entities/account'

export interface AuthPageProps {
  baseUrl: string
  // '' means unset -- AuthScreen falls back to its own default.
  role: string
  onAuthenticated?: (account: Account, kek?: CryptoKey) => void
  pairingAvailable?: boolean
}

export function AuthPage({ baseUrl, role, onAuthenticated, pairingAvailable = false }: AuthPageProps) {
  const initialRole: AccountRole | undefined = role === 'Professional' || role === 'Patient' ? role : undefined

  return (
    <main className="auth-page">
      <header>
        <p className="editorial-eyebrow">Limmiar</p>
        <h1 className="editorial-title"><Trans>Bem-vindo ao Limmiar</Trans></h1>
        <p><Trans>Seu consultório, com privacidade.</Trans></p>
      </header>
      <AuthScreen
      baseUrl={baseUrl}
      initialRole={initialRole}
      onAuthenticated={onAuthenticated}
      />
      <p className="auth-secondary"><a href="/recover"><Trans>Esqueci minha senha</Trans></a></p>
      {pairingAvailable && <p className="auth-secondary"><a href="/devices/pair-new"><Trans>Desbloquear pelo outro dispositivo</Trans></a></p>}
    </main>
  )
}
import { Trans } from '@lingui/react/macro'
