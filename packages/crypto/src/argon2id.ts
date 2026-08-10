import { argon2idAsync } from '@noble/hashes/argon2.js'

// ADR-S01-01: Argon2id runs in a Worker, so only argon2idAsync is imported here; the sync variant must never appear in this file (enforced by this module's test).
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

  // RFC 9106 §3.1: m (KiB) must be >= 8*p; checked here first so the error names this package's own parameter names, not @noble/hashes' generic m/p.
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
