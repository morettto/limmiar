import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { Account } from './account'
import { SessionContext, useSession, type ContextoSessao } from './session-context'

const ACCOUNT: Account = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  role: 'Professional',
  twoFactorRequirement: 'NotApplicable',
  twoFactorTicket: null,
}

function Consumer() {
  const { sessao } = useSession()
  return <p data-testid="sessao">{sessao === null ? 'sem-sessao' : sessao.id}</p>
}

// S18-10: este teste morava em SessionProvider.test.tsx -- movido para aqui porque a
// asserção é sobre `useSession`/`SessionContext` puros, não sobre `SessionProvider`.
describe('session-context', () => {
  afterEach(() => {
    cleanup()
  })

  it('useSession outside a SessionContext.Provider throws instead of returning a silent default', () => {
    // Suprime o console.error do React sobre o erro não apanhado durante o render.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<Consumer />)).toThrow('useSession: nenhum <SessionProvider> ancestral')

    consoleError.mockRestore()
  })

  it('useSession inside a SessionContext.Provider returns the provided value', () => {
    const value: ContextoSessao = { sessao: ACCOUNT, iniciarSessao: vi.fn(), terminarSessao: vi.fn() }

    render(
      <SessionContext.Provider value={value}>
        <Consumer />
      </SessionContext.Provider>,
    )

    expect(screen.getByTestId('sessao').textContent).toBe(ACCOUNT.id)
  })
})
