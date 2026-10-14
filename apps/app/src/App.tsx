import { RouterProvider } from '@tanstack/react-router'
import { AppProviders } from './app/providers/AppProviders'
import { router } from './app/routing/router'

export function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  )
}
