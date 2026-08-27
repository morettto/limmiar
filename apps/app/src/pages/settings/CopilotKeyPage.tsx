import { useNavigate } from '@tanstack/react-router'
import { CopilotKeySetup } from '../../features/copilot-byok/CopilotKeySetup'

// ponytail: `kek` is pinned to `null` and `accountId` to '' because no KeychainProvider is
// mounted anywhere in the app yet. Whoever opens this route today sees the locked screen with
// "Pular", and that's the correct behavior, not a bug. Whoever wires up the keychain connects
// both here, in this same diff -- the empty accountId is only harmless while kek stays null.
export function CopilotKeyPage() {
  const navigate = useNavigate()
  return <CopilotKeySetup accountId="" kek={null} onDone={() => navigate({ to: '/' })} />
}
