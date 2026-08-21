import { describe, expect, it } from 'vitest'
import { fakeEngine } from './fake-engine.ts'

describe('fakeEngine', () => {
  it('warmup and close resolve without doing anything observable', async () => {
    const engine = fakeEngine()
    await expect(engine.warmup()).resolves.toBeUndefined()
    await expect(engine.close()).resolves.toBeUndefined()
  })

  it('is deterministic: same pcm length -> same segments', async () => {
    const engine = fakeEngine()
    const a = await engine.transcribe(new Float32Array(16000))
    const b = await engine.transcribe(new Float32Array(16000))
    expect(a).toEqual(b)
  })

  it('returns no segments for an empty block', async () => {
    const engine = fakeEngine()
    expect(await engine.transcribe(new Float32Array(0))).toEqual([])
  })

  it('derives endMs from the pcm length at 16kHz', async () => {
    const engine = fakeEngine()
    const [segment] = await engine.transcribe(new Float32Array(8000)) // 500ms
    expect(segment.startMs).toBe(0)
    expect(segment.endMs).toBe(500)
    expect(segment.text).toBe('[fake:8000]')
  })

  it('accepts a custom transcribe function for scripted test scenarios', async () => {
    const scripted = [{ startMs: 0, endMs: 100, text: 'ola' }]
    const engine = fakeEngine({ transcribe: () => scripted })
    expect(await engine.transcribe(new Float32Array(1))).toBe(scripted)
  })
})
