import type { CryptoKey } from '@limmiar/crypto'
import { sealChunk } from '../../entities/gravacao/audio-crypto'

export type WriteSealed = (sessionId: string, seq: number, sealed: Uint8Array<ArrayBuffer>) => Promise<void>

/**
 * The only function in this module (and the only one in the app) allowed to touch the OPFS
 * write API (`getFileHandle`/`createWritable`/`write`/`close`) — every other caller goes
 * through `persistChunk`, which never hands it plaintext.
 */
export function opfsWriter(dir: FileSystemDirectoryHandle): WriteSealed {
  return async (_sessionId, seq, sealed) => {
    const handle = await dir.getFileHandle(String(seq), { create: true })
    const writable = await handle.createWritable()
    await writable.write(sealed)
    await writable.close()
  }
}

/** Composes seal + write — `write` only ever receives ciphertext, never `blob` itself. */
export async function persistChunk(
  write: WriteSealed,
  dek: CryptoKey,
  sessionId: string,
  seq: number,
  blob: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const sealed = await sealChunk(dek, sessionId, seq, blob)
  await write(sessionId, seq, sealed)
}
