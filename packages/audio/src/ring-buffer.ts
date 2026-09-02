/**
 * Single-producer/single-consumer ring buffer over a SharedArrayBuffer for the
 * audio hot path: Int32Array(4) header plus Float32Array(capacity), capacity a
 * power of 2 so the index is a mask. Guarantees in README.md.
 */

const WRITE_IDX = 0
const READ_IDX = 1
const DROPPED_IDX = 2
const HEADER_INT32_LENGTH = 4

/** 320ms of audio @ 16kHz — the quantum the audio hot path pushes at a time. */
export const CHUNK_FRAMES = 5120

export interface Ring {
  readonly header: Int32Array
  readonly data: Float32Array
  readonly capacity: number
}

function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0
}

/** Allocates the backing SharedArrayBuffer for a ring of `capacityFrames`. */
export function createRingSab(capacityFrames: number): SharedArrayBuffer {
  if (!isPowerOfTwo(capacityFrames)) {
    throw new RangeError(
      `capacityFrames must be a power of 2, got ${capacityFrames}`,
    )
  }
  return new SharedArrayBuffer(
    HEADER_INT32_LENGTH * Int32Array.BYTES_PER_ELEMENT +
      capacityFrames * Float32Array.BYTES_PER_ELEMENT,
  )
}

/** Wraps a SAB produced by `createRingSab` in typed-array views. */
export function attachRing(sab: SharedArrayBuffer): Ring {
  const header = new Int32Array(sab, 0, HEADER_INT32_LENGTH)
  const headerBytes = HEADER_INT32_LENGTH * Int32Array.BYTES_PER_ELEMENT
  const capacity =
    (sab.byteLength - headerBytes) / Float32Array.BYTES_PER_ELEMENT
  const data = new Float32Array(sab, headerBytes, capacity)
  return { header, data, capacity }
}

/** Frames currently available to read (writeFrames - readFrames, wrap-safe). */
export function available(ring: Ring): number {
  const w = Atomics.load(ring.header, WRITE_IDX)
  const r = Atomics.load(ring.header, READ_IDX)
  return (w - r) | 0
}

/** Total frames ever lost to overflow (never reset). */
export function droppedFrames(ring: Ring): number {
  return Atomics.load(ring.header, DROPPED_IDX)
}

/**
 * Copies `block` into the ring. On overflow (not enough free space) the
 * whole block is dropped and counted in the header's droppedFrames — the
 * ring never grows and never blocks the producer.
 */
export function push(ring: Ring, block: Float32Array): boolean {
  const w = Atomics.load(ring.header, WRITE_IDX)
  const r = Atomics.load(ring.header, READ_IDX)
  const used = (w - r) | 0
  const free = ring.capacity - used

  if (block.length > free) {
    Atomics.add(ring.header, DROPPED_IDX, block.length)
    return false
  }

  const start = w & (ring.capacity - 1)
  const end = start + block.length
  if (end <= ring.capacity) {
    ring.data.set(block, start)
  } else {
    const firstPart = ring.capacity - start
    ring.data.set(block.subarray(0, firstPart), start)
    ring.data.set(block.subarray(firstPart), 0)
  }

  Atomics.store(ring.header, WRITE_IDX, (w + block.length) | 0)
  Atomics.notify(ring.header, WRITE_IDX)
  return true
}

/**
 * Copies up to `dest.length` available frames into `dest`. Returns the
 * number of frames actually copied (never more than what was available).
 */
export function pull(ring: Ring, dest: Float32Array): number {
  const w = Atomics.load(ring.header, WRITE_IDX)
  const r = Atomics.load(ring.header, READ_IDX)
  const used = (w - r) | 0
  const count = Math.min(used, dest.length)
  if (count === 0) return 0

  const start = r & (ring.capacity - 1)
  const end = start + count
  if (end <= ring.capacity) {
    dest.set(ring.data.subarray(start, end), 0)
  } else {
    const firstPart = ring.capacity - start
    dest.set(ring.data.subarray(start, ring.capacity), 0)
    dest.set(ring.data.subarray(0, count - firstPart), firstPart)
  }

  Atomics.store(ring.header, READ_IDX, (r + count) | 0)
  return count
}

/**
 * Resolves true once at least `frames` are available, false if `timeoutMs`
 * elapses first. Uses `Atomics.waitAsync` on the writeFrames header slot —
 * a native wait/notify pair, no polling loop.
 */
export async function waitFor(
  ring: Ring,
  frames: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (available(ring) >= frames) return true
    const remaining = deadline - Date.now()
    if (remaining <= 0) return false

    const current = Atomics.load(ring.header, WRITE_IDX)
    const result = Atomics.waitAsync(ring.header, WRITE_IDX, current, remaining)
    // `result.value` is a Promise when `result.async` is true, or already
    // the resolved string ('not-equal' | 'timed-out') otherwise — `await`
    // handles both uniformly, so there is no async/sync branch to take here.
    await result.value
    // Either the value already differed ('not-equal'), a notify woke us
    // ('ok'), or we hit 'timed-out' — loop back and re-check `available`
    // against the deadline either way.
  }
}
