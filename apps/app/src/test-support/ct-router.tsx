import { useState, type ReactNode } from 'react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'

// O CT monta componentes soltos; um `Link` precisa de um roteador em volta. Rotas de destino
// (`destinos`) existem só para o `Link` resolver o href.
export function CtRouter({ children, destinos = [] }: { children: ReactNode; destinos?: readonly string[] }) {
  const [router] = useState(() => {
    const raiz = createRootRoute({ component: () => <>{children}</> })
    const rotas = destinos.map((path) => createRoute({ getParentRoute: () => raiz, path }))
    return createRouter({ routeTree: raiz.addChildren(rotas), history: createMemoryHistory({ initialEntries: ['/'] }) })
  })
  return <RouterProvider router={router} />
}
