import { PairPrimaryDevice } from '../../features/device-pairing-primary/PairPrimaryDevice'
import { decodeBase64 } from '../../shared/lib/base64'

export interface PairPrimaryPageProps {
  baseUrl: string
  accountId: string
  accessToken: string
  // Base64 of a fixed 32-byte test KEK -- see app/routing/router.tsx's file-level doc
  // comment for why this comes straight off the query string.
  kek: string
}

export function PairPrimaryPage({ baseUrl, accountId, accessToken, kek }: PairPrimaryPageProps) {
  return (
    <PairPrimaryDevice
      baseUrl={baseUrl}
      accountId={accountId}
      accessToken={accessToken}
      getKekForTransfer={() => Promise.resolve(decodeBase64(kek))}
    />
  )
}
