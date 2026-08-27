// Same AAD discipline as patients/patient-crypto.ts: versioned prefix + UTF-8 bytes, scoped to
// exactly the identifiers that must never be swappable across contexts.
const DEK_AAD_PREFIX = 'limmiar/copilot-dek/v1|'
const KEY_AAD_PREFIX = 'limmiar/copilot-key/v1|'

export function copilotDekAad(accountId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${DEK_AAD_PREFIX}${accountId}`)
}

export function copilotKeyAad(accountId: string, providerId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${KEY_AAD_PREFIX}${accountId}|${providerId}`)
}
