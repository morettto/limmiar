// Wire shape of the QR payload PairingQr (features/device-pairing-primary) encodes and
// PairingScan (features/qr-scan) decodes. Both sides import this one type instead of each
// declaring their own literal shape, so they cannot silently drift apart.
export interface PairingQrPayload {
  s: string
  k: string
  u: string
}
