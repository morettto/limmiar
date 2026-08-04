import { argon2idAsync } from '@noble/hashes/argon2.js'

// ADR-S01-01: Argon2id roda em Worker; a API não oferece um caminho síncrono —
// nenhum dado. Só argon2idAsync é importado aqui; a variante síncrona da mesma
// lib nunca deve aparecer neste arquivo (guard executável no teste deste módulo).
export interface Argon2Params {
  memoryKiB: number
  iterations: number
  parallelism: number
  dkLen?: number
  key?: Uint8Array
  associatedData?: Uint8Array
}

export async function deriveKey(
  password: Uint8Array,
  salt: Uint8Array,
  params: Argon2Params,
): Promise<Uint8Array> {
  const { memoryKiB, iterations, parallelism, dkLen, key, associatedData } = params

  // RFC 9106 §3.1: m (KiB) must be >= 8*p. @noble/hashes enforces this too, but
  // under its own generic `m`/`p` wording — reject here first so the error a
  // caller of this package's own interface sees names its own parameters.
  if (memoryKiB < 8 * parallelism) {
    throw new Error(
      `Argon2Params.memoryKiB (${memoryKiB}) must be at least 8 * parallelism (${8 * parallelism})`,
    )
  }
  if (iterations < 1) {
    throw new Error(`Argon2Params.iterations (${iterations}) must be >= 1`)
  }

  return argon2idAsync(password, salt, {
    m: memoryKiB,
    t: iterations,
    p: parallelism,
    dkLen,
    key,
    personalization: associatedData,
  })
}
