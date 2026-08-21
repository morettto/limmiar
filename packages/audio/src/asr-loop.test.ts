import { describe, expect, it } from 'vitest'
import { fakeEngine } from './fake-engine.ts'
import { runAsrLoop } from './asr-loop.ts'
import { attachRing, createRingSab, push } from './ring-buffer.ts'
import type { TranscriptionSegment } from './transcription-engine.ts'

const CAPACITY = 1 << 15 // plenty for a few small test windows

/** Returns a `now()` that yields `values` in order, one per call. */
function scriptedClock(values: number[]): () => number {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}

describe('runAsrLoop', () => {
  it('returns immediately with zeroed stats when the signal starts aborted', async () => {
    const ring = attachRing(createRingSab(CAPACITY))
    const controller = new AbortController()
    controller.abort()

    const stats = await runAsrLoop({
      ring,
      engine: fakeEngine(),
      signal: controller.signal,
      windowFrames: 16,
      onSegments: () => {},
      onStats: () => {},
    })

    expect(stats).toEqual({ rtf: 0, droppedFrames: 0, windows: 0 })
  })

  it('processes one full window, reports its segments/stats via callbacks, and returns matching final stats', async () => {
    const ring = attachRing(createRingSab(CAPACITY))
    const windowFrames = 16
    push(ring, new Float32Array(windowFrames).fill(0.5)) // 1ms of audio @16kHz

    const controller = new AbortController()
    const segmentsSeen: TranscriptionSegment[][] = []
    const statsSeen: unknown[] = []

    const loop = runAsrLoop({
      ring,
      engine: fakeEngine(),
      signal: controller.signal,
      windowFrames,
      onSegments: (segments) => {
        segmentsSeen.push(segments)
        controller.abort()
      },
      onStats: (stats) => {
        statsSeen.push(stats)
      },
      now: scriptedClock([0, 1000]), // t0=0, t1=1000 -> 1000ms of processing
    })

    const finalStats = await loop

    expect(segmentsSeen).toHaveLength(1)
    expect(segmentsSeen[0][0].text).toBe(`[fake:${windowFrames}]`)
    expect(statsSeen).toHaveLength(1)
    // 1000ms of processing / 1ms of audio (16 frames @16kHz) = rtf 1000.
    expect(statsSeen[0]).toEqual({ rtf: 1000, droppedFrames: 0, windows: 1 })
    expect(finalStats).toEqual({ rtf: 1000, droppedFrames: 0, windows: 1 })
  })

  it('reports droppedFrames from the ring even when no window was ever processed', async () => {
    const ring = attachRing(createRingSab(4))
    push(ring, new Float32Array(4)) // fills it
    push(ring, new Float32Array(2)) // overflow: 2 dropped

    const controller = new AbortController()
    controller.abort()

    const stats = await runAsrLoop({
      ring,
      engine: fakeEngine(),
      signal: controller.signal,
      windowFrames: 16,
      onSegments: () => {},
      onStats: () => {},
    })

    expect(stats).toEqual({ rtf: 0, droppedFrames: 2, windows: 0 })
  })

  it('waits for more data instead of processing a partial window, then honours abort', async () => {
    const ring = attachRing(createRingSab(CAPACITY))
    push(ring, new Float32Array(4)) // less than the requested window

    const controller = new AbortController()
    let windowsProcessed = 0

    const loop = runAsrLoop({
      ring,
      engine: fakeEngine(),
      signal: controller.signal,
      windowFrames: 16,
      onSegments: () => {
        windowsProcessed += 1
      },
      onStats: () => {},
    })

    // Give the internal wait a couple of poll cycles to run, proving it
    // does not process the partial window, then stop it.
    await new Promise((resolve) => setTimeout(resolve, 220))
    controller.abort()
    const stats = await loop

    expect(windowsProcessed).toBe(0)
    expect(stats.windows).toBe(0)
  })

  it('defaults windowFrames (5 * CHUNK_FRAMES) and now (Date.now)', async () => {
    const ring = attachRing(createRingSab(CAPACITY))
    const defaultWindow = 5 * 5120 // 5 * CHUNK_FRAMES, documented in ring-buffer.ts
    push(ring, new Float32Array(defaultWindow + 10).fill(0.1))

    const controller = new AbortController()
    let windowCount = 0

    const stats = await runAsrLoop({
      ring,
      engine: fakeEngine(),
      signal: controller.signal,
      onSegments: () => {
        windowCount += 1
        controller.abort()
      },
      onStats: () => {},
    })

    expect(windowCount).toBe(1)
    expect(stats.windows).toBe(1)
    expect(stats.rtf).toBeGreaterThanOrEqual(0)
  })

  it('propagates a rejection from an async onSegments instead of swallowing it', async () => {
    const ring = attachRing(createRingSab(CAPACITY))
    const windowFrames = 16
    push(ring, new Float32Array(windowFrames).fill(0.5))

    const controller = new AbortController()
    const boom = new Error('persistence failed')

    const loop = runAsrLoop({
      ring,
      engine: fakeEngine(),
      signal: controller.signal,
      windowFrames,
      onSegments: async () => {
        controller.abort() // stops the loop even if the rejection is (wrongly) swallowed
        throw boom
      },
      onStats: () => {},
    })

    await expect(loop).rejects.toThrow(boom)
  })
})
