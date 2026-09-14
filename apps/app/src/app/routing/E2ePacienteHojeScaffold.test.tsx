import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { i18n, dynamicActivate } from '../../shared/i18n'
import { encodeBase64 } from '../../shared/lib/base64'
import { E2ePacienteHojeScaffold } from './E2ePacienteHojeScaffold'

vi.mock('../../pages/paciente-hoje/PacienteHojePage', () => ({
  PacienteHojePage: vi.fn(({ kek }: { kek: unknown }) => (
    <div data-testid="paciente-hoje-page" data-kek-null={kek === null} />
  )),
}))

function renderScaffold(kekBase64: string) {
  return render(
    <I18nProvider i18n={i18n}>
      <E2ePacienteHojeScaffold accountId="acc-e2e" kek={kekBase64} />
    </I18nProvider>,
  )
}

describe('E2ePacienteHojeScaffold', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  it('imports the kek from the base64 query param and forwards it once ready', async () => {
    const kek = new Uint8Array(32).fill(9)

    renderScaffold(encodeBase64(kek))

    await vi.waitFor(() => {
      expect(screen.getByTestId('paciente-hoje-page').dataset.kekNull).toBe('false')
    })
  })

  it('does not update state after unmounting before importKek resolves', async () => {
    let resolveImport: (kek: CryptoKey) => void = () => {}
    const importSpy = vi
      .spyOn(limmiarWebcrypto, 'importKek')
      .mockReturnValue(new Promise<CryptoKey>((resolve) => (resolveImport = resolve)))
    const kek = new Uint8Array(32).fill(9)

    const { unmount } = renderScaffold(encodeBase64(kek))
    unmount()
    resolveImport({} as CryptoKey)

    await new Promise((resolve) => setTimeout(resolve, 0))
    importSpy.mockRestore()
  })
})
