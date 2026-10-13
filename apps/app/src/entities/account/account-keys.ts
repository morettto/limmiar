import { webcrypto } from '@limmiar/crypto'
import { deriveEmailPasswordVerifier } from './password-verifier'
import { deriveRecoveryVerifier } from './recovery-verifier'

const WRAPPED_DEK_LENGTH = 60
const RECOVERY_ENVELOPE_LENGTH = 120

async function deriveSalt(domain: string, email: string): Promise<Uint8Array<ArrayBuffer>> {
  return webcrypto.sha256(new TextEncoder().encode(`${domain}|${email.trim().toLowerCase()}`))
}

function recoveryAad(accountId: string, part: 'dek' | 'kek'): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`limmiar/account-recovery/v1|${accountId}|${part}`)
}

// Neither verifier transmitted for authentication can derive these clinical keys.
export async function deriveAccountKek(password: string, email: string): Promise<CryptoKey> {
  const raw = await deriveEmailPasswordVerifier(password, await deriveSalt('limmiar/account-kek/v1', email))
  try {
    return await webcrypto.importKek(new Uint8Array(raw))
  } finally { raw.fill(0) }
}

async function deriveRecoveryKek(mnemonic: string, email: string): Promise<CryptoKey> {
  const raw = await deriveRecoveryVerifier(mnemonic, await deriveSalt('limmiar/account-recovery-kek/v1', email))
  try {
    return await webcrypto.importKek(new Uint8Array(raw))
  } finally { raw.fill(0) }
}

export async function deriveAccountKekForTransfer(password: string, email: string, currentKek: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  const derived = await deriveEmailPasswordVerifier(password, await deriveSalt('limmiar/account-kek/v1', email))
  const raw = new Uint8Array(derived)
  derived.fill(0)
  try {
    const candidate = await webcrypto.importKek(new Uint8Array(raw))
    // Stryker disable next-line StringLiteral: equivalent, the probe wraps and unwraps with the same AAD in one call.
    const aad = new TextEncoder().encode('limmiar/device-pairing/key-confirmation/v1')
    const { wrapped } = await webcrypto.generateWrappedDek(currentKek, aad)
    await webcrypto.unwrapDek(candidate, wrapped, aad)
    return raw
  } catch (error) { raw.fill(0); throw error }
}

export async function createRecoveryEnvelope(
  password: string, email: string, accountId: string, mnemonic: string, currentKek: CryptoKey,
): Promise<Uint8Array<ArrayBuffer>> {
  const raw = await deriveEmailPasswordVerifier(password, await deriveSalt('limmiar/account-kek/v1', email))
  try {
    const candidate = await webcrypto.importKek(new Uint8Array(raw))
    const probe = await webcrypto.generateWrappedDek(currentKek, recoveryAad(accountId, 'dek'))
    await webcrypto.unwrapDek(candidate, probe.wrapped, recoveryAad(accountId, 'dek'))
    const recoveryKek = await deriveRecoveryKek(mnemonic, email)
    const { dek, wrapped } = await webcrypto.generateWrappedDek(recoveryKek, recoveryAad(accountId, 'dek'))
    const plaintext = new Uint8Array(raw)
    let sealed: Uint8Array<ArrayBuffer>
    try {
      sealed = await webcrypto.encrypt(dek, plaintext, recoveryAad(accountId, 'kek'))
    } finally { plaintext.fill(0) }
    const envelope = new Uint8Array(RECOVERY_ENVELOPE_LENGTH)
    envelope.set(wrapped)
    envelope.set(sealed, WRAPPED_DEK_LENGTH)
    return envelope
  } finally { raw.fill(0) }
}

export async function openRecoveryEnvelope(
  mnemonic: string, email: string, accountId: string, envelope: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  if (envelope.length !== RECOVERY_ENVELOPE_LENGTH) throw new Error('Invalid recovery envelope')
  const recoveryKek = await deriveRecoveryKek(mnemonic, email)
  const dek = await webcrypto.unwrapDek(recoveryKek, envelope.slice(0, WRAPPED_DEK_LENGTH), recoveryAad(accountId, 'dek'))
  const raw = await webcrypto.decrypt(dek, envelope.slice(WRAPPED_DEK_LENGTH), recoveryAad(accountId, 'kek'))
  try {
    return await webcrypto.importKek(new Uint8Array(raw))
  } finally { raw.fill(0) }
}
