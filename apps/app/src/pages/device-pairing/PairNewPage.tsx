import { PairNewDevice } from '../../features/device-pairing-new/PairNewDevice'
import { encodeBase64 } from '../../shared/lib/base64'

export interface PairNewPageProps {
  baseUrl: string
}

// Test-only hooks the E2E installs via `page.exposeFunction` before navigating here:
// `decodeFromCamera` needs a real camera, which CI has none of, and `__e2eKekAdopted` lets the Node
// process observe the adopted KEK. Both are undefined outside the E2E.
interface PairingE2EWindow {
  __e2eDecodeQr?: () => Promise<string>
  __e2eKekAdopted?: (kekBase64: string) => void
}

export function PairNewPage({ baseUrl }: PairNewPageProps) {
  const e2eWindow = window as unknown as PairingE2EWindow

  return (
    <PairNewDevice
      baseUrl={baseUrl}
      decode={() => {
        if (!e2eWindow.__e2eDecodeQr) {
          return Promise.reject(new Error('window.__e2eDecodeQr is not installed -- this route is E2E-only.'))
        }
        return e2eWindow.__e2eDecodeQr()
      }}
      onKekAdopted={(kek) => {
        e2eWindow.__e2eKekAdopted?.(encodeBase64(kek))
      }}
    />
  )
}
