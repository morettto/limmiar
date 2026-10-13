import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { useState } from 'react'
import { SessionContext } from '../entities/account/session-context'
import type { Account } from '../entities/account'
import { AppShell } from '../widgets/app-shell/AppShell'
import { useBloquearNavegacao } from '../widgets/app-shell/bloqueio'

// Cada rota mostra o próprio título: o destino marcado na barra tem de bater com a página à vista.
const PAGINAS = { '/': 'Consultório', '/pacientes': 'Seus pacientes', '/biblioteca': 'Biblioteca de notas', '/acervo': 'Seu acervo',
  '/espelho': 'Sinais compartilhados pelos pacientes', '/settings/audit': 'Trilha de auditoria' }
const PROFISSIONAL: Account = { id: 'conta-ct', email: 'maria.fernanda@consultorio-exemplo.com.br', role: 'Professional', twoFactorRequirement: 'NotApplicable',
  twoFactorTicket: null, accessToken: 'token', refreshToken: 'refresh', accessTokenExpiresAt: '2099-01-01T00:00:00Z' }
const SESSAO = { sessao: PROFISSIONAL, kek: {} as CryptoKey, iniciarSessao: () => {}, terminarSessao: () => {} }

function Pagina({ titulo, bloqueada }: { titulo: string; bloqueada: boolean }) {
  useBloquearNavegacao(bloqueada)
  return <main className="workspace">
    <h1>{titulo}</h1>
    <p>Conteúdo da página.</p>
  </main>
}

// O CT só serializa props simples e o AppShell precisa de roteador e sessão: a montagem vive aqui.
export function CtAppShell({ caminho, bloqueada = false }: { caminho: string; bloqueada?: boolean }) {
  const [router] = useState(() => {
    const raiz = createRootRoute({ component: () => <AppShell><Outlet /></AppShell> })
    const rotas = Object.entries(PAGINAS).map(([path, titulo]) => createRoute({ getParentRoute: () => raiz, path, component: () => <Pagina titulo={titulo} bloqueada={bloqueada} /> }))
    return createRouter({ routeTree: raiz.addChildren(rotas), history: createMemoryHistory({ initialEntries: [caminho] }) })
  })
  return <SessionContext.Provider value={SESSAO}><RouterProvider router={router} /></SessionContext.Provider>
}
