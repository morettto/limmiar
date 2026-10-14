import { Trans } from '@lingui/react/macro'
import { ConsentimentoVotos } from '../../features/consentimento-votos/ConsentimentoVotos'

export function CopilotPage({ accountId }: { accountId: string }) {
  return <main className="settings-page">
    <header><h1><Trans>Votos do copiloto de IA</Trans></h1></header>
    <p><Trans>Os votos “útil” e “não útil” ficam cifrados neste aparelho. Eles só são enviados se você ligar a opção abaixo.</Trans></p>
    <ConsentimentoVotos accountId={accountId} />
  </main>
}
