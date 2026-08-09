// Wire-format helpers for this module only -- everything in packages/crypto and the
// PairingQr/PairingScan components above works in raw Uint8Array; only the boundary that
// actually talks to the backend (createPairingSession/claimPairingSession/etc., all
// base64-string fields per api/client.ts's own convention) needs to cross to/from text.
// Mirrors api/client.ts's `passwordVerifierToBase64` (btoa/atob, not `Buffer` -- this runs
// in the browser).

export function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

export function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
