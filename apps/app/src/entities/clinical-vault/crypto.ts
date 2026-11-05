import { decrypt, encrypt, webcrypto } from '@limmiar/crypto'
import { decodeBase64, encodeBase64 } from '../../shared/lib/base64'

export interface RecoverySlot { id: string; envelope: string }
export interface VaultDocument { revision: string; keyEnvelope: string; recoverySlots: RecoverySlot[] }
export interface VaultWrite extends VaultDocument { recoverySlots: (RecoverySlot & { verifier: string })[] }
export interface PreparedVault { document: VaultWrite; key: string; recoveryCodes: string[]; kek: CryptoKey }

const KEY_PREFIX = 'lm-key-1'
const RECOVERY_PREFIX = 'lm-recovery-1'
const encoder = new TextEncoder()

function encodedSecret(raw: Uint8Array): string {
  return encodeBase64(raw).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function secretBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('Invalid vault secret')
  const raw = decodeBase64(value.replaceAll('-', '+').replaceAll('_', '/') + '=')
  if (encodedSecret(raw) !== value) { raw.fill(0); throw new Error('Invalid vault secret') }
  return raw
}

async function derive(raw: Uint8Array<ArrayBuffer>, accountId: string, purpose: string): Promise<Uint8Array<ArrayBuffer>> {
  const source = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256',
    salt: encoder.encode(`limmiar/clinical-vault/v1|${accountId}`), info: encoder.encode(purpose) }, source, 256))
}

async function verifier(raw: Uint8Array<ArrayBuffer>, accountId: string, id: string): Promise<string> {
  const bytes = await derive(raw, accountId, `verifier|${id}`)
  try { return encodeBase64(bytes) }
  finally { bytes.fill(0) }
}

function aad(accountId: string, revision: string, slot: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`limmiar/clinical-vault/v1|${accountId}|${revision}|${slot}`)
}

async function seal(rawMaster: Uint8Array<ArrayBuffer>, rawSecret: Uint8Array<ArrayBuffer>, accountId: string, revision: string, slot: string): Promise<string> {
  const wrapper = await derive(rawSecret, accountId, slot)
  try { return encodeBase64(encrypt(wrapper, rawMaster, aad(accountId, revision, slot))) }
  finally { wrapper.fill(0) }
}

async function open(rawSecret: Uint8Array<ArrayBuffer>, accountId: string, revision: string, slot: string, envelope: string): Promise<Uint8Array<ArrayBuffer>> {
  const wrapper = await derive(rawSecret, accountId, slot)
  try {
    const bytes = decodeBase64(envelope)
    if (bytes.length !== 60) throw new Error('Invalid vault envelope')
    const plaintext = decrypt(wrapper, bytes, aad(accountId, revision, slot))
    try {
      if (plaintext.length !== 32) throw new Error('Invalid vault key')
      return new Uint8Array(plaintext)
    } finally { plaintext.fill(0) }
  } finally { wrapper.fill(0) }
}

async function prepare(accountId: string, rawMaster: Uint8Array<ArrayBuffer>): Promise<PreparedVault> {
  const revision = crypto.randomUUID()
  const rawKey = crypto.getRandomValues(new Uint8Array(32))
  try {
    const key = `${KEY_PREFIX}.${encodedSecret(rawKey)}`
    const keyEnvelope = await seal(rawMaster, rawKey, accountId, revision, 'unlock')
    const recoverySlots: VaultWrite['recoverySlots'] = []
    const recoveryCodes: string[] = []
    for (let i = 0; i < 3; i++) {
      const id = crypto.randomUUID()
      const raw = crypto.getRandomValues(new Uint8Array(32))
      try {
        recoveryCodes.push(`${RECOVERY_PREFIX}.${id}.${encodedSecret(raw)}`)
        recoverySlots.push({ id, envelope: await seal(rawMaster, raw, accountId, revision, `recovery|${id}`),
          verifier: await verifier(raw, accountId, id) })
      } finally { raw.fill(0) }
    }
    const kek = await webcrypto.importKek(new Uint8Array(rawMaster))
    return { document: { revision, keyEnvelope, recoverySlots }, key, recoveryCodes, kek }
  } finally { rawKey.fill(0) }
}

export async function createVault(accountId: string): Promise<PreparedVault> {
  const rawMaster = crypto.getRandomValues(new Uint8Array(32))
  try { return await prepare(accountId, rawMaster) }
  finally { rawMaster.fill(0) }
}

export async function unlockVault(accountId: string, key: string, document: VaultDocument): Promise<CryptoKey> {
  const [prefix, secret, extra] = key.trim().split('.')
  if (prefix !== KEY_PREFIX || !secret || extra !== undefined) throw new Error('Invalid vault key')
  const raw = secretBytes(secret)
  try {
    const master = await open(raw, accountId, document.revision, 'unlock', document.keyEnvelope)
    try { return await webcrypto.importKek(master) }
    finally { master.fill(0) }
  } finally { raw.fill(0) }
}

export async function recoverVault(accountId: string, code: string, document: VaultDocument): Promise<{
  prepared: PreparedVault; recoveryId: string; recoveryVerifier: string
}> {
  const [prefix, id, secret, extra] = code.trim().split('.')
  const slot = document.recoverySlots.find(slot => slot.id === id)
  if (prefix !== RECOVERY_PREFIX || !secret || extra !== undefined || !slot) throw new Error('Invalid recovery code')
  const raw = secretBytes(secret)
  try {
    const master = await open(raw, accountId, document.revision, `recovery|${id}`, slot.envelope)
    try {
      return { prepared: await prepare(accountId, master), recoveryId: slot.id,
        recoveryVerifier: await verifier(raw, accountId, slot.id) }
    } finally { master.fill(0) }
  } finally { raw.fill(0) }
}
