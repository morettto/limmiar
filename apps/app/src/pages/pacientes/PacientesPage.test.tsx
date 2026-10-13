import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { PacientesPage } from './PacientesPage'

vi.mock('../../widgets/patient-care/PatientList', () => ({ PatientList: ({ accountId, accessToken, kek }: { accountId: string; accessToken: string; kek: unknown }) =>
  <div>Carteira de {accountId} com {accessToken} e chave {String(kek === chave)}</div> }))
const chave = {} as CryptoKey

beforeAll(async () => dynamicActivate('pt-BR'))
afterEach(cleanup)

it('nomeia a página e monta a carteira da conta com as credenciais', () => {
  render(<I18nProvider i18n={i18n}><PacientesPage baseUrl="" accountId="conta-1" accessToken="access" kek={chave} /></I18nProvider>)
  expect(screen.getByRole('heading', { level: 1, name: 'Seus pacientes' })).toBeTruthy()
  expect(screen.getByText('Carteira de conta-1 com access e chave true')).toBeTruthy()
})
