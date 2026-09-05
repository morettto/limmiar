import { AuthScreen } from '../../widgets/auth-screen/AuthScreen'
import type { Account, AccountRole } from '../../entities/account'

export interface AuthPageProps {
  baseUrl: string
  // '' means unset -- AuthScreen falls back to its own default.
  role: string
  onAuthenticated?: (account: Account) => void
}

export function AuthPage({ baseUrl, role, onAuthenticated }: AuthPageProps) {
  const initialRole: AccountRole | undefined = role === 'Professional' || role === 'Patient' ? role : undefined

  return (
    <AuthScreen
      baseUrl={baseUrl}
      initialRole={initialRole}
      onAuthenticated={onAuthenticated}
      getGoogleIdToken={() =>
        Promise.reject(
          new Error(
            '/auth/screen is E2E-only scaffolding for magic-link-login.spec.ts, which never clicks the Google button.',
          ),
        )
      }
    />
  )
}
