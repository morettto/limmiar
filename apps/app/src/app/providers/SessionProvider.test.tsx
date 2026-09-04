import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Account } from '../../entities/account'
import { COPILOT_KEY_STORAGE_KEY } from '../../features/copilot-byok/key-store'
import { SessionProvider, useSession } from './SessionProvider'

const ACCOUNT: Account = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  role: 'Professional',
  twoFactorRequirement: 'NotApplicable',
  twoFactorTicket: null,
}

const OUTRA_CONTA: Account = {
  id: '22222222-2222-2222-2222-222222222222',
  email: 'outra@example.com',
  role: 'Professional',
  twoFactorRequirement: 'NotApplicable',
  twoFactorTicket: null,
}

function seedStoredAccount(account: Account) {
  window.sessionStorage.setItem('limmiar:account', JSON.stringify(account))
}

function copilotKeyStorageKeyFor(accountId: string): string {
  return `${COPILOT_KEY_STORAGE_KEY}:${accountId}`
}

// Semeia uma entrada real de localStorage (não um mock) no formato que key-store.ts grava --
// prova o efeito real de clearApiKey, não uma chamada espiada.
function seedCopilotKeyEnvelope(accountId: string) {
  window.localStorage.setItem(
    copilotKeyStorageKeyFor(accountId),
    JSON.stringify({ providerId: 'openai', wrappedDek: 'x', ciphertext: 'y' }),
  )
}

function Consumer() {
  const { sessao, iniciarSessao, terminarSessao } = useSession()
  return (
    <div>
      <p data-testid="sessao">{sessao === null ? 'sem-sessao' : sessao.id}</p>
      <button onClick={() => iniciarSessao(ACCOUNT)}>iniciar</button>
      <button onClick={() => iniciarSessao(OUTRA_CONTA)}>iniciar-outra</button>
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
    window.localStorage.clear()
    vi.restoreAllMocks()
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

  it('terminarSessao clears storage and state, and purges the departing account (clearApiKey removes its copilot key)', async () => {
    seedStoredAccount(ACCOUNT)
    seedCopilotKeyEnvelope(ACCOUNT.id)
    render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    )
    expect(screen.getByTestId('sessao').textContent).toBe(ACCOUNT.id)

    fireEvent.click(screen.getByRole('button', { name: 'terminar' }))

    expect(screen.getByTestId('sessao').textContent).toBe('sem-sessao')
    expect(window.sessionStorage.getItem('limmiar:account')).toBeNull()
    await waitFor(() => {
      expect(window.localStorage.getItem(copilotKeyStorageKeyFor(ACCOUNT.id))).toBeNull()
    })
  })

  it('terminarSessao with no session is a no-op: no purge, nothing to clear', () => {
    render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    )
    expect(screen.getByTestId('sessao').textContent).toBe('sem-sessao')

    expect(() => fireEvent.click(screen.getByRole('button', { name: 'terminar' }))).not.toThrow()

    expect(screen.getByTestId('sessao').textContent).toBe('sem-sessao')
  })

  it('iniciarSessao with the same account already registered re-registers it without purging (A -> A)', async () => {
    seedStoredAccount(ACCOUNT)
    seedCopilotKeyEnvelope(ACCOUNT.id)
    render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    )
    expect(screen.getByTestId('sessao').textContent).toBe(ACCOUNT.id)

    fireEvent.click(screen.getByRole('button', { name: 'iniciar' }))

    expect(screen.getByTestId('sessao').textContent).toBe(ACCOUNT.id)
    expect(window.sessionStorage.getItem('limmiar:account')).toBe(JSON.stringify(ACCOUNT))
    // Dá tempo a uma purga indevida correr, se o código a disparasse por engano.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(window.localStorage.getItem(copilotKeyStorageKeyFor(ACCOUNT.id))).not.toBeNull()
  })

  it('iniciarSessao with a different account purges the previous one before mounting the new one (A -> B)', async () => {
    seedStoredAccount(ACCOUNT)
    seedCopilotKeyEnvelope(ACCOUNT.id)
    render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    )
    expect(screen.getByTestId('sessao').textContent).toBe(ACCOUNT.id)

    fireEvent.click(screen.getByRole('button', { name: 'iniciar-outra' }))

    expect(screen.getByTestId('sessao').textContent).toBe(OUTRA_CONTA.id)
    expect(window.sessionStorage.getItem('limmiar:account')).toBe(JSON.stringify(OUTRA_CONTA))
    await waitFor(() => {
      expect(window.localStorage.getItem(copilotKeyStorageKeyFor(ACCOUNT.id))).toBeNull()
    })
  })

  it('iniciarSessao with no prior session registers the account without purging anything (sem sessão)', () => {
    render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    )
    expect(screen.getByTestId('sessao').textContent).toBe('sem-sessao')

    expect(() => fireEvent.click(screen.getByRole('button', { name: 'iniciar' }))).not.toThrow()

    expect(screen.getByTestId('sessao').textContent).toBe(ACCOUNT.id)
  })

  it('a purge that throws synchronously does not stop terminarSessao from clearing the session', async () => {
    // Prova que o `async (purga) => purga(accountId)` dentro do .map() é necessário: se alguém o
    // remover, clearApiKey (síncrona e lançando) escaparia do Promise.allSettled e este teste rebenta.
    vi.doMock('../../features/copilot-byok/key-store', () => ({
      clearApiKey: vi.fn(() => {
        throw new Error('purge boom')
      }),
    }))
    vi.resetModules()
    // Mesma pegadinha de `renderRouter` em router.test.tsx: `useSession` também tem de vir fresco.
    const { SessionProvider: SessionProviderComMockDePurga, useSession: useSessionFresco } = await import(
      './SessionProvider'
    )

    function ConsumerFresco() {
      const { sessao, terminarSessao } = useSessionFresco()
      return (
        <div>
          <p data-testid="sessao">{sessao === null ? 'sem-sessao' : sessao.id}</p>
          <button onClick={() => terminarSessao()}>terminar</button>
        </div>
      )
    }

    seedStoredAccount(ACCOUNT)
    render(
      <SessionProviderComMockDePurga>
        <ConsumerFresco />
      </SessionProviderComMockDePurga>,
    )
    expect(screen.getByTestId('sessao').textContent).toBe(ACCOUNT.id)

    expect(() => fireEvent.click(screen.getByRole('button', { name: 'terminar' }))).not.toThrow()

    expect(screen.getByTestId('sessao').textContent).toBe('sem-sessao')
    expect(window.sessionStorage.getItem('limmiar:account')).toBeNull()

    vi.doUnmock('../../features/copilot-byok/key-store')
    vi.resetModules()
  })

  it('useSession outside a SessionProvider throws instead of returning a silent default', () => {
    // Suprime o console.error do React sobre o erro não apanhado durante o render.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<Consumer />)).toThrow('useSession: nenhum <SessionProvider> ancestral')

    consoleError.mockRestore()
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
