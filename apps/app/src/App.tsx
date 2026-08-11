import { Trans } from '@lingui/react/macro'
import { RouterProvider } from '@tanstack/react-router'
import { AppProviders } from './app/providers/AppProviders'
import { router } from './app/routing/router'

export function App() {
  return (
    <AppProviders>
      <p>
        <Trans>Bem-vindo ao Limmiar</Trans>
      </p>
      <RouterProvider router={router} />
    </AppProviders>
  )
}
