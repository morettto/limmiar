import { RecoveryScreen } from '../../features/recovery/RecoveryScreen'

export interface RecoveryPageProps {
  baseUrl: string
}

export function RecoveryPage({ baseUrl }: RecoveryPageProps) {
  return <RecoveryScreen baseUrl={baseUrl} />
}
