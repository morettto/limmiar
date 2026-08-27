import { describe, expect, it } from 'vitest'
import {
  attachRing,
  available,
  CHUNK_FRAMES,
  createRingSab,
  droppedFrames,
  pull,
  push,
  waitFor,
} from './ring-buffer.ts'

const HEADER_BYTES = 16 // Int32Array(4)

describe('CHUNK_FRAMES', () => {
  it('is 5120 frames (320ms @ 16kHz)', () => {
    expect(CHUNK_FRAMES).toBe(5120)
  })
})

describe('createRingSab', () => {
  it('allocates a SharedArrayBuffer sized for the header plus the capacity', () => {
    const sab = createRingSab(8)
    expect(sab).toBeInstanceOf(SharedArrayBuffer)
    expect(sab.byteLength).toBe(HEADER_BYTES + 8 * 4)
  })

  it('rejects a non-power-of-2 capacity', () => {
    expect(() => createRingSab(6)).toThrow(/power of 2/)
  })

  it('rejects a zero or negative capacity', () => {
    expect(() => createRingSab(0)).toThrow(/power of 2/)
    expect(() => createRingSab(-8)).toThrow(/power of 2/)
  })

  it('rejects a non-integer capacity', () => {
    expect(() => createRingSab(8.5)).toThrow(/power of 2/)
  })
})

describe('attachRing', () => {
  it('derives capacity from the SAB size and starts with a zeroed header', () => {
    const ring = attachRing(createRingSab(16))
    expect(ring.capacity).toBe(16)
    expect(available(ring)).toBe(0)
    expect(droppedFrames(ring)).toBe(0)
  })
})

describe('push / pull', () => {
  it('round-trips a block smaller than capacity', () => {
    const ring = attachRing(createRingSab(8))
    expect(push(ring, new Float32Array([1, 2, 3]))).toBe(true)
    expect(available(ring)).toBe(3)

    const dest = new Float32Array(3)
    expect(pull(ring, dest)).toBe(3)
    expect(Array.from(dest)).toEqual([1, 2, 3])
    expect(available(ring)).toBe(0)
  })

  it('pull returns only what is available, capped at dest.length', () => {
    const ring = attachRing(createRingSab(8))
    push(ring, new Float32Array([1, 2]))

    const dest = new Float32Array(5)
    expect(pull(ring, dest)).toBe(2)
    expect(Array.from(dest.subarray(0, 2))).toEqual([1, 2])
  })

  it('pull returns 0 when the ring is empty', () => {
    const ring = attachRing(createRingSab(8))
    expect(pull(ring, new Float32Array(4))).toBe(0)
  })

  it('wraps writes around the end of the backing store', () => {
    const ring = attachRing(createRingSab(4))
    push(ring, new Float32Array([1, 2, 3])) // writeFrames=3
    pull(ring, new Float32Array(3)) // readFrames=3, drains it
    // Next push of 3 frames wraps: index 3, then 0, 1.
    expect(push(ring, new Float32Array([4, 5, 6]))).toBe(true)

    const dest = new Float32Array(3)
    expect(pull(ring, dest)).toBe(3)
    expect(Array.from(dest)).toEqual([4, 5, 6])
  })

  it('drops the whole block and counts it on overflow, without growing or blocking', () => {
    const ring = attachRing(createRingSab(4))
    expect(push(ring, new Float32Array([1, 2, 3, 4]))).toBe(true) // fills it
    expect(push(ring, new Float32Array([5, 6]))).toBe(false) // no room
    expect(droppedFrames(ring)).toBe(2)
    expect(available(ring)).toBe(4) // unchanged, nothing grew

    // A later overflow accumulates on top of the previous drop count.
    expect(push(ring, new Float32Array([7]))).toBe(false)
    expect(droppedFrames(ring)).toBe(3)
  })
})

describe('waitFor', () => {
  it('resolves true immediately when enough frames are already available', async () => {
    const ring = attachRing(createRingSab(8))
    push(ring, new Float32Array([1, 2, 3]))
    await expect(waitFor(ring, 3, 1000)).resolves.toBe(true)
  })

  it('resolves false on timeout when not enough frames arrive', async () => {
    const ring = attachRing(createRingSab(8))
    await expect(waitFor(ring, 3, 20)).resolves.toBe(false)
  })

  it('resolves true once a producer pushes enough frames after the wait started', async () => {
    const ring = attachRing(createRingSab(8))
    const waiting = waitFor(ring, 3, 2000)
    // Give the waiter a tick to register before the producer pushes.
    await new Promise((resolve) => setTimeout(resolve, 10))
    push(ring, new Float32Array([1, 2, 3]))
    await expect(waiting).resolves.toBe(true)
  })
})
