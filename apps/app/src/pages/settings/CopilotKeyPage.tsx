import { useNavigate } from '@tanstack/react-router'
import { CopilotKeySetup } from '../../features/copilot-byok/CopilotKeySetup'

export interface CopilotKeyPageProps {
  accountId: string
}

// ponytail: `kek` is still pinned to `null` because no KeychainProvider is mounted anywhere yet,
// so this route correctly shows the locked screen with "Pular". Whoever wires up the keychain
// connects it here, in the same diff. `accountId` now comes from the caller (S18-01).
export function CopilotKeyPage({ accountId }: CopilotKeyPageProps) {
  const navigate = useNavigate()
  return <CopilotKeySetup accountId={accountId} kek={null} onDone={() => navigate({ to: '/' })} />
}
