import { useNavigate } from '@tanstack/react-router'
import { CopilotKeySetup } from '../../features/copilot-byok/CopilotKeySetup'

// ponytail: `kek` is pinned to `null` and `accountId` to '' because no KeychainProvider is mounted
// anywhere yet, so this route correctly shows the locked screen with "Pular". Whoever wires up the
// keychain connects both here, in the same diff.
export function CopilotKeyPage() {
  const navigate = useNavigate()
  return <CopilotKeySetup accountId="" kek={null} onDone={() => navigate({ to: '/' })} />
}
