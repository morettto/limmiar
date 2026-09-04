import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Account } from '../../entities/account'
import { SessionProvider, useSession } from './SessionProvider'

const ACCOUNT: Account = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  role: 'Professional',
  twoFactorRequirement: 'NotApplicable',
  twoFactorTicket: null,
}

function seedStoredAccount(account: Account) {
  window.sessionStorage.setItem('limmiar:account', JSON.stringify(account))
}

function Consumer() {
  const { sessao, iniciarSessao, terminarSessao } = useSession()
  return (
    <div>
      <p data-testid="sessao">{sessao === null ? 'sem-sessao' : sessao.id}</p>
      <button onClick={() => iniciarSessao(ACCOUNT)}>iniciar</button>
      <button onClick={() => terminarSessao()}>terminar</button>
    </div>
  )
}

// Forces an unrelated parent re-render (own counter state) so the SessionProvider subtree
// re-renders without touching `sessao` -- the seam the identity-stability assertion needs.
function HostComForceRerender({ onValue }: { onValue: (value: ReturnType<typeof useSession>) => void }) {
  const [contador, setContador] = useState(0)
  return (
    <SessionProvider>
      <button onClick={() => setContador((c) => c + 1)}>forçar-rerender</button>
      <span data-testid="contador">{contador}</span>
      <ValueCapturer onValue={onValue} />
    </SessionProvider>
  )
}

function ValueCapturer({ onValue }: { onValue: (value: ReturnType<typeof useSession>) => void }) {
  const value = useSession()
  onValue(value)
  return null
}

describe('SessionProvider', () => {
  afterEach(() => {
    cleanup()
    window.sessionStorage.clear()
  })

  it('mounts with `sessao` pre-filled when the storage already has an account', () => {
    seedStoredAccount(ACCOUNT)

    render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    )

    expect(screen.getByTestId('sessao').textContent).toBe(ACCOUNT.id)
  })

  it('iniciarSessao writes to storage and updates the rendered state', () => {
    render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    )
    expect(screen.getByTestId('sessao').textContent).toBe('sem-sessao')

    fireEvent.click(screen.getByRole('button', { name: 'iniciar' }))

    expect(screen.getByTestId('sessao').textContent).toBe(ACCOUNT.id)
    expect(window.sessionStorage.getItem('limmiar:account')).toBe(JSON.stringify(ACCOUNT))
  })

  it('terminarSessao clears storage and state', () => {
    seedStoredAccount(ACCOUNT)
    render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    )
    expect(screen.getByTestId('sessao').textContent).toBe(ACCOUNT.id)

    fireEvent.click(screen.getByRole('button', { name: 'terminar' }))

    expect(screen.getByTestId('sessao').textContent).toBe('sem-sessao')
    expect(window.sessionStorage.getItem('limmiar:account')).toBeNull()
  })

  it('useSession outside a SessionProvider does not throw and returns the no-op default', () => {
    expect(() => render(<Consumer />)).not.toThrow()
    expect(screen.getByTestId('sessao').textContent).toBe('sem-sessao')

    // Calling the default no-ops must not throw either.
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'iniciar' }))).not.toThrow()
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'terminar' }))).not.toThrow()
  })

  it('the context value keeps the same reference across a re-render that does not change `sessao`', () => {
    const capturedValues: ReturnType<typeof useSession>[] = []

    render(<HostComForceRerender onValue={(value) => capturedValues.push(value)} />)
    expect(capturedValues).toHaveLength(1)
    const primeiroValor = capturedValues[0]

    fireEvent.click(screen.getByRole('button', { name: 'forçar-rerender' }))

    expect(screen.getByTestId('contador').textContent).toBe('1')
    expect(capturedValues).toHaveLength(2)
    expect(capturedValues[1]).toBe(primeiroValor)
  })
})
