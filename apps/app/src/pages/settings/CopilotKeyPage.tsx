import type { CryptoKey } from '@limmiar/crypto'
import { CopilotKeySetup } from '../../features/copilot-byok/CopilotKeySetup'

export interface CopilotKeyPageProps {
  accountId: string
  kek: CryptoKey | null
  onDone: () => void
}

export function CopilotKeyPage({ accountId, kek, onDone }: CopilotKeyPageProps) {
  return <CopilotKeySetup accountId={accountId} kek={kek} onDone={onDone} />
}
