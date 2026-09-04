import { MagicLinkCallback } from '../../features/magic-link-auth/MagicLinkCallback'
import type { Account } from '../../entities/account'

export interface MagicLinkCallbackPageProps {
  baseUrl: string
  token: string
  onAuthenticated?: (account: Account) => void
}

export function MagicLinkCallbackPage({ baseUrl, token, onAuthenticated }: MagicLinkCallbackPageProps) {
  return <MagicLinkCallback baseUrl={baseUrl} token={token} onAuthenticated={onAuthenticated} />
}
