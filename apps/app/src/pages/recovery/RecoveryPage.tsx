import { RecoveryScreen } from '../../features/recovery/RecoveryScreen'
import type { Account } from '../../entities/account'

export interface RecoveryPageProps {
  baseUrl: string
  onRecovered?: (account: Account) => void
}

export function RecoveryPage({ baseUrl, onRecovered }: RecoveryPageProps) {
  return <RecoveryScreen baseUrl={baseUrl} onRecovered={onRecovered} />
}
