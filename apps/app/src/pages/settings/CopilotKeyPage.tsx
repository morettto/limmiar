import { useNavigate } from '@tanstack/react-router'
import { useSession } from '../../entities/account/session-context'
import { CopilotKeySetup } from '../../features/copilot-byok/CopilotKeySetup'

// ponytail: `kek` is still pinned to `null` -- no KeychainProvider mounted yet. Whoever wires up
// the keychain connects it here. `accountId` comes straight from useSession() (S18-10), no
// `?? ''` collapse; CopilotKeySetup treats `accountId === null` the same as `kek === null`.
export function CopilotKeyPage() {
  const { sessao } = useSession()
  const navigate = useNavigate()
  const onDone = () => navigate({ to: '/' })
  return <CopilotKeySetup accountId={sessao?.id ?? null} kek={null} onDone={onDone} />
}
