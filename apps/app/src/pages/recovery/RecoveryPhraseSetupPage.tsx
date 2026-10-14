import { useState } from 'react'
import { Trans } from '@lingui/react/macro'
import { RecoveryPhraseSetup } from '../../features/recovery/RecoveryPhraseSetup'

export interface RecoveryPhraseSetupPageProps {
  baseUrl: string
  accountId: string
  accessToken: string
  email: string
  kek: CryptoKey
}

export function RecoveryPhraseSetupPage({ baseUrl, accountId, accessToken, email, kek }: RecoveryPhraseSetupPageProps) {
  const [saved, setSaved] = useState(false)
  return <main className="settings-page">
    <header><h1><Trans>Frase de recuperação</Trans></h1></header>
    {saved ? <div className="editorial-card"><p role="status"><Trans>Frase de recuperação salva.</Trans></p></div> : <RecoveryPhraseSetup
      baseUrl={baseUrl}
      accountId={accountId}
      accessToken={accessToken}
      email={email}
      kek={kek}
      onDone={() => setSaved(true)}
    />}
  </main>
}
