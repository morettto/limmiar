import { decrypt, deriveChannelKey, encrypt, getSharedSecret } from '@limmiar/crypto'
import type { ItemPartilhado } from '../../shared/lib/item-partilhado'

const SALT_PREFIX = 'limmiar/partilha/v1|'

// O mesmo texto serve de salt do HKDF e de AAD do AES-GCM: liga o envelope à direção
// paciente → profissional (ADR de S11-02 §(b)); um vínculo em direção inversa deriva outra chave.
function saltPartilha(pacienteAccountId: string, profissionalAccountId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${SALT_PREFIX}${pacienteAccountId}|${profissionalAccountId}`)
}

export function cifrarItem(p: {
  privadaPaciente: Uint8Array
  publicaProfissional: Uint8Array
  pacienteAccountId: string
  profissionalAccountId: string
  item: ItemPartilhado
}): Uint8Array {
  const salt = saltPartilha(p.pacienteAccountId, p.profissionalAccountId)
  const sharedSecret = getSharedSecret(p.privadaPaciente, p.publicaProfissional)
  const key = deriveChannelKey(sharedSecret, salt)
  const plaintext = new TextEncoder().encode(JSON.stringify(p.item))
  return encrypt(key, plaintext, salt)
}

export function decifrarItem(p: {
  privadaProfissional: Uint8Array
  publicaPaciente: Uint8Array
  pacienteAccountId: string
  profissionalAccountId: string
  ciphertext: Uint8Array
}): ItemPartilhado {
  const salt = saltPartilha(p.pacienteAccountId, p.profissionalAccountId)
  const sharedSecret = getSharedSecret(p.privadaProfissional, p.publicaPaciente)
  const key = deriveChannelKey(sharedSecret, salt)
  const plaintext = decrypt(key, p.ciphertext, salt)
  const item: unknown = JSON.parse(new TextDecoder().decode(plaintext))
  if (!isItemPartilhado(item)) {
    throw new Error('Envelope partilhado inválido')
  }
  return item
}

function isItemPartilhado(value: unknown): value is ItemPartilhado {
  if (typeof value !== 'object' || value === null || !('tipo' in value) || value.tipo !== 'checkin') {
    return false
  }
  return 'checkin' in value && typeof value.checkin === 'object' && value.checkin !== null
}
