import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import type { Account } from '../../entities/account'
import { COPILOT_KEY_STORAGE_KEY } from '../../features/copilot-byok/key-store'
import { chaveIndiceDaConta, type ChaveIndiceBusca } from '../../features/nota-biblioteca/indice-crypto'
import { construirIndice } from '../../features/nota-biblioteca/indice'
import { opfsIndice, persistirIndice } from '../../features/nota-biblioteca/indice-store'
import { FakeDirectoryHandle, stubOpfsRoot } from '../../test-support/fake-opfs'
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

// S18-07: `registar()` nunca persiste `twoFactorTicket` -- as asserções contra o sessionStorage
// bruto comparam com esta forma, não com `JSON.stringify(ACCOUNT)`.
function contaPersistidaJson(account: Account): string {
  const { twoFactorTicket: _twoFactorTicket, ...semTicket } = account
  return JSON.stringify(semTicket)
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

async function makeChave(): Promise<ChaveIndiceBusca> {
  const kek = await limmiarWebcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
  return chaveIndiceDaConta(kek)
}

// Semeia `raiz/<accountId>/indice-busca` via opfsIndice (mesmo trio de produção), devolvendo
// o diretório da conta para inspecionar `.files` depois da purga.
async function seedIndiceBusca(raiz: FakeDirectoryHandle, accountId: string): Promise<FakeDirectoryHandle> {
  const chave = await makeChave()
  const dir = await raiz.getDirectoryHandle(accountId, { create: true })
  const { gravar } = opfsIndice(dir as unknown as FileSystemDirectoryHandle)
  const indice = construirIndice([{ id: '1', patientId: 'p1', texto: 'febre' }])
  await persistirIndice(gravar, chave, accountId, indice, '1:0')
  return dir
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

let restoreOpfsRoot: (() => void) | null = null

describe('SessionProvider', () => {
  afterEach(() => {
    cleanup()
    window.sessionStorage.clear()
    window.localStorage.clear()
    vi.restoreAllMocks()
    restoreOpfsRoot?.()
    restoreOpfsRoot = null
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
    expect(window.sessionStorage.getItem('limmiar:account')).toBe(contaPersistidaJson(ACCOUNT))
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

  it('terminarSessao purga o indice da conta que sai', async () => {
    const raiz = new FakeDirectoryHandle()
    const dirA = await seedIndiceBusca(raiz, ACCOUNT.id)
    restoreOpfsRoot = stubOpfsRoot(raiz)
    seedStoredAccount(ACCOUNT)
    render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    )
    expect(screen.getByTestId('sessao').textContent).toBe(ACCOUNT.id)

    fireEvent.click(screen.getByRole('button', { name: 'terminar' }))

    await waitFor(() => {
      expect(dirA.files.has('indice-busca')).toBe(false)
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
    expect(window.sessionStorage.getItem('limmiar:account')).toBe(contaPersistidaJson(ACCOUNT))
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
    expect(window.sessionStorage.getItem('limmiar:account')).toBe(contaPersistidaJson(OUTRA_CONTA))
    await waitFor(() => {
      expect(window.localStorage.getItem(copilotKeyStorageKeyFor(ACCOUNT.id))).toBeNull()
    })
  })

  it('trocar de conta (A -> B) apaga o indice de A e deixa o de B intacto', async () => {
    const raiz = new FakeDirectoryHandle()
    const dirA = await seedIndiceBusca(raiz, ACCOUNT.id)
    const dirB = await seedIndiceBusca(raiz, OUTRA_CONTA.id)
    restoreOpfsRoot = stubOpfsRoot(raiz)
    seedStoredAccount(ACCOUNT)
    render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    )
    expect(screen.getByTestId('sessao').textContent).toBe(ACCOUNT.id)

    fireEvent.click(screen.getByRole('button', { name: 'iniciar-outra' }))

    await waitFor(() => {
      expect(dirA.files.has('indice-busca')).toBe(false)
    })
    expect(dirB.files.has('indice-busca')).toBe(true)
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

  it('a purge that throws synchronously does not stop terminarSessao from clearing the session, nor the next purge in the list (o indice ainda e apagado)', async () => {
    // Prova que purgarConta não deixa um throw síncrono de clearApiKey escapar para terminarSessao
    // (que chama purgarConta em fire-and-forget, sem esperar por ela), e que a purga seguinte
    // na lista (purgarIndiceBusca) ainda corre -- README `app/providers`, linhas 19-20.
    vi.doMock('../../features/copilot-byok/key-store', () => ({
      clearApiKey: vi.fn(() => {
        throw new Error('purge boom')
      }),
    }))
    vi.resetModules()
    const raiz = new FakeDirectoryHandle()
    const dirA = await seedIndiceBusca(raiz, ACCOUNT.id)
    restoreOpfsRoot = stubOpfsRoot(raiz)
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
    await waitFor(() => {
      expect(dirA.files.has('indice-busca')).toBe(false)
    })

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
