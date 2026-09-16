import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { type CryptoKey, webcrypto as webcryptoModule } from '@limmiar/crypto'
import { i18n, dynamicActivate } from '../../shared/i18n'
import { encodeBase64 } from '../../shared/lib/base64'
import { E2eVinculoScaffold } from './E2eVinculoScaffold'

vi.mock('../../features/vinculo/GerarConviteVinculo', () => ({
  GerarConviteVinculo: vi.fn(({ patientId }: { patientId: string }) => (
    <div data-testid="gerar-convite" data-patient-id={patientId} />
  )),
}))
vi.mock('../../features/vinculo/ResgatarConviteVinculo', () => ({
  ResgatarConviteVinculo: vi.fn(() => <div data-testid="resgatar-convite" />),
}))
vi.mock('../../features/vinculo/DesvincularVinculo', () => ({
  DesvincularVinculo: vi.fn(() => <div data-testid="desvincular-vinculo" />),
}))

const BASE_URL = 'http://api.test'
const ACCOUNT_ID = 'conta-marta'
const ACCESS_TOKEN = 'token-marta'
const PATIENT_ID = 'paciente-ana'
const KEK_BASE64 = encodeBase64(new Uint8Array(32).fill(7))

function renderScaffold(papel: string) {
  return render(
    <I18nProvider i18n={i18n}>
      <E2eVinculoScaffold
        baseUrl={BASE_URL}
        accountId={ACCOUNT_ID}
        accessToken={ACCESS_TOKEN}
        kek={KEK_BASE64}
        papel={papel}
        patientId={PATIENT_ID}
      />
    </I18nProvider>,
  )
}

describe('E2eVinculoScaffold', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => {
    cleanup()
  })

  it('renders GerarConviteVinculo and DesvincularVinculo for papel=Professional, once the kek is imported', async () => {
    renderScaffold('Professional')

    expect(await screen.findByTestId('gerar-convite')).toBeTruthy()
    expect(screen.getByTestId('gerar-convite').dataset.patientId).toBe(PATIENT_ID)
    expect(screen.getByTestId('desvincular-vinculo')).toBeTruthy()
    expect(screen.queryByTestId('resgatar-convite')).toBeNull()
  })

  it('renders ResgatarConviteVinculo and DesvincularVinculo for papel=Patient, not GerarConviteVinculo', async () => {
    renderScaffold('Patient')

    expect(await screen.findByTestId('resgatar-convite')).toBeTruthy()
    expect(screen.getByTestId('desvincular-vinculo')).toBeTruthy()
    expect(screen.queryByTestId('gerar-convite')).toBeNull()
  })

  it('does not update state after unmounting before importKek resolves', async () => {
    let resolveImport: (kek: CryptoKey) => void = () => {}
    const importSpy = vi
      .spyOn(webcryptoModule, 'importKek')
      .mockReturnValue(new Promise<CryptoKey>((resolve) => (resolveImport = resolve)))

    const { unmount } = renderScaffold('Professional')
    unmount()
    resolveImport({} as CryptoKey)

    await new Promise((resolve) => setTimeout(resolve, 0))
    importSpy.mockRestore()
  })
})
