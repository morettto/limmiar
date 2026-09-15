import { decrypt, deriveChannelKey, encrypt, getSharedSecret } from '@limmiar/crypto'

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
  item: unknown
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
}): unknown {
  const salt = saltPartilha(p.pacienteAccountId, p.profissionalAccountId)
  const sharedSecret = getSharedSecret(p.privadaProfissional, p.publicaPaciente)
  const key = deriveChannelKey(sharedSecret, salt)
  const plaintext = decrypt(key, p.ciphertext, salt)
  return JSON.parse(new TextDecoder().decode(plaintext)) as unknown
}
