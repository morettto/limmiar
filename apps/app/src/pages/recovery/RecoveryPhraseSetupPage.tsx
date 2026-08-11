import { RecoveryPhraseSetup } from '../../features/recovery/RecoveryPhraseSetup'

export interface RecoveryPhraseSetupPageProps {
  baseUrl: string
  accountId: string
  accessToken: string
  email: string
}

export function RecoveryPhraseSetupPage({ baseUrl, accountId, accessToken, email }: RecoveryPhraseSetupPageProps) {
  return (
    <RecoveryPhraseSetup
      baseUrl={baseUrl}
      accountId={accountId}
      accessToken={accessToken}
      email={email}
      onDone={() => {}}
    />
  )
}
