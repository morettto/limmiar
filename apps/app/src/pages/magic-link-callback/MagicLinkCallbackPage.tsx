import { MagicLinkCallback } from '../../features/magic-link-auth/MagicLinkCallback'

export interface MagicLinkCallbackPageProps {
  baseUrl: string
  token: string
}

export function MagicLinkCallbackPage({ baseUrl, token }: MagicLinkCallbackPageProps) {
  return <MagicLinkCallback baseUrl={baseUrl} token={token} />
}
