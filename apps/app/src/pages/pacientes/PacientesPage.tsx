import { Trans } from '@lingui/react/macro'
import type { CryptoKey } from '@limmiar/crypto'
import { PatientList } from '../../widgets/patient-care/PatientList'

export interface PacientesPageProps {
  baseUrl: string
  accountId: string
  accessToken: string
  kek: CryptoKey
}

export function PacientesPage({ baseUrl, accountId, accessToken, kek }: PacientesPageProps) {
  return <main id="app-shell" className="workspace">
    <header>
      <h1><Trans>Seus pacientes</Trans></h1>
    </header>
    <PatientList baseUrl={baseUrl} accountId={accountId} accessToken={accessToken} kek={kek} />
  </main>
}
