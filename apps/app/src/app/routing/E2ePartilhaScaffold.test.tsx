import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { type CryptoKey, webcrypto as webcryptoModule } from '@limmiar/crypto'
import { i18n, dynamicActivate } from '../../shared/i18n'
import { encodeBase64 } from '../../shared/lib/base64'
import { E2ePartilhaScaffold } from './E2ePartilhaScaffold'

vi.mock('../../pages/paciente-hoje/PacienteHojePage', () => ({
  PacienteHojePage: vi.fn((props: { accountId: string; agora?: Date; partilha?: { baseUrl: string } }) => (
    <div
      data-testid="paciente-hoje"
      data-account-id={props.accountId}
      data-agora={props.agora?.toISOString() ?? ''}
      data-partilha-base-url={props.partilha?.baseUrl ?? ''}
    />
  )),
}))
vi.mock('../../features/partilha/PartilhaCheckIns', () => ({
  PartilhaCheckIns: vi.fn(() => <div data-testid="partilha-checkins" />),
}))
vi.mock('../../features/partilha/CheckInsPartilhados', () => ({
  CheckInsPartilhados: vi.fn(() => <div data-testid="checkins-partilhados" />),
}))

const BASE_URL = 'http://api.test'
const ACCOUNT_ID = 'conta-ana'
const ACCESS_TOKEN = 'token-ana'
const KEK_BASE64 = encodeBase64(new Uint8Array(32).fill(7))

function renderScaffold(papel: string, agora = '') {
  return render(
    <I18nProvider i18n={i18n}>
      <E2ePartilhaScaffold
        baseUrl={BASE_URL}
        accountId={ACCOUNT_ID}
        accessToken={ACCESS_TOKEN}
        kek={KEK_BASE64}
        papel={papel}
        agora={agora}
      />
    </I18nProvider>,
  )
}

describe('E2ePartilhaScaffold', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
  })

  it('papel=paciente renders PacienteHojePage (with partilha) and PartilhaCheckIns, once the kek is imported', async () => {
    renderScaffold('paciente')

    expect(await screen.findByTestId('paciente-hoje')).toBeTruthy()
    expect(screen.getByTestId('paciente-hoje').dataset.accountId).toBe(ACCOUNT_ID)
    expect(screen.getByTestId('paciente-hoje').dataset.partilhaBaseUrl).toBe(BASE_URL)
    expect(screen.getByTestId('partilha-checkins')).toBeTruthy()
    expect(screen.queryByTestId('checkins-partilhados')).toBeNull()
  })

  it('parses a non-empty agora search param into a Date passed to PacienteHojePage', async () => {
    renderScaffold('paciente', '2026-01-15T10:00:00.000Z')

    expect(await screen.findByTestId('paciente-hoje')).toBeTruthy()
    expect(screen.getByTestId('paciente-hoje').dataset.agora).toBe('2026-01-15T10:00:00.000Z')
  })

  it('leaves agora undefined when the search param is empty', async () => {
    renderScaffold('paciente', '')

    expect(await screen.findByTestId('paciente-hoje')).toBeTruthy()
    expect(screen.getByTestId('paciente-hoje').dataset.agora).toBe('')
  })

  it('papel=profissional renders CheckInsPartilhados, not the patient screens', async () => {
    renderScaffold('profissional')

    expect(await screen.findByTestId('checkins-partilhados')).toBeTruthy()
    expect(screen.queryByTestId('paciente-hoje')).toBeNull()
    expect(screen.queryByTestId('partilha-checkins')).toBeNull()
  })

  it('does not update state after unmounting before importKek resolves', async () => {
    let resolveImport: (kek: CryptoKey) => void = () => {}
    const importSpy = vi
      .spyOn(webcryptoModule, 'importKek')
      .mockReturnValue(new Promise<CryptoKey>((resolve) => (resolveImport = resolve)))

    const { unmount } = renderScaffold('paciente')
    unmount()
    resolveImport({} as CryptoKey)

    await new Promise((resolve) => setTimeout(resolve, 0))
    importSpy.mockRestore()
  })
})
