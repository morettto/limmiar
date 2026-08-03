import { useEffect } from 'react'
import { I18nProvider } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import { i18n, bootLocale } from './i18n'

export function App() {
  useEffect(() => {
    void bootLocale()
  }, [])

  return (
    <I18nProvider i18n={i18n}>
      <p>
        <Trans>Bem-vindo ao Limmiar</Trans>
      </p>
      <RouterProvider router={router} />
    </I18nProvider>
  )
}
