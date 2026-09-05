import { useEffect, type ReactNode } from 'react'
import { I18nProvider } from '@lingui/react'
import { i18n, bootLocale } from '../../shared/i18n'
import { SessionProvider } from './SessionProvider'

export function AppProviders({ children }: { children: ReactNode }) {
  useEffect(() => {
    void bootLocale()
  }, [])

  return (
    <I18nProvider i18n={i18n}>
      <SessionProvider>{children}</SessionProvider>
    </I18nProvider>
  )
}
