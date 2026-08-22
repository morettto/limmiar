import { describe, expect, it, vi } from 'vitest'
import { nemotronEngine, type AsrRecognizer, type AsrResult, type AsrStream } from './nemotron-engine.ts'

/** Structural double of `OnlineStream` — records the calls `nemotronEngine` makes on it. */
function fakeStream(): AsrStream {
  return {
    acceptWaveform: vi.fn(),
    free: vi.fn(),
  }
}

/**
 * Structural double of `OnlineRecognizer`. `isReadySequence` is consumed one
 * value per `isReady()` call, then holds at the last value — good enough for
 * the "decode until not ready" cycle each scenario needs.
 */
function fakeRecognizer(opts: {
  isReadySequence?: boolean[]
  isEndpoint?: boolean
  result?: AsrResult
} = {}): { recognizer: AsrRecognizer; stream: AsrStream } {
  const stream = fakeStream()
  const isReadySequence = opts.isReadySequence ?? [false]
  let call = 0
  const recognizer: AsrRecognizer = {
    createStream: vi.fn(() => stream),
    isReady: vi.fn(() => isReadySequence[Math.min(call++, isReadySequence.length - 1)]),
    decode: vi.fn(),
    isEndpoint: vi.fn(() => opts.isEndpoint ?? false),
    reset: vi.fn(),
    getResult: vi.fn(() => opts.result ?? { text: '', timestamps: [], start_time: 0 }),
    free: vi.fn(),
  }
  return { recognizer, stream }
}

describe('nemotronEngine', () => {
  it('warmup() creates a stream, feeds it silence, decodes, and resets', async () => {
    const { recognizer, stream } = fakeRecognizer({ isReadySequence: [false] })
    const engine = nemotronEngine(Promise.resolve(recognizer))

    await engine.warmup()

    expect(recognizer.createStream).toHaveBeenCalledTimes(1)
    expect(stream.acceptWaveform).toHaveBeenCalledTimes(1)
    const [sampleRate, samples] = vi.mocked(stream.acceptWaveform).mock.calls[0]
    expect(sampleRate).toBe(16000)
    expect(samples).toBeInstanceOf(Float32Array)
    expect(samples.length).toBe(5120)
    expect(Array.from(samples).every((v) => v === 0)).toBe(true)
    expect(recognizer.reset).toHaveBeenCalledTimes(1)
    expect(recognizer.reset).toHaveBeenCalledWith(stream)
  })

  it('warmup() called twice is a no-op the second time', async () => {
    const { recognizer } = fakeRecognizer()
    const engine = nemotronEngine(Promise.resolve(recognizer))

    await engine.warmup()
    await engine.warmup()

    expect(recognizer.createStream).toHaveBeenCalledTimes(1)
  })

  it('warmup() rejects when the recognizer promise rejects, and close() resolves anyway', async () => {
    const engine = nemotronEngine(Promise.reject(new Error('404')))

    await expect(engine.warmup()).rejects.toThrow('404')
    await expect(engine.close()).resolves.toBeUndefined()
  })

  it('transcribe() decodes until not ready, feeding acceptWaveform exactly once', async () => {
    const { recognizer, stream } = fakeRecognizer()
    const engine = nemotronEngine(Promise.resolve(recognizer))
    await engine.warmup()
    vi.mocked(recognizer.decode).mockClear()
    vi.mocked(stream.acceptWaveform).mockClear()
    vi.mocked(recognizer.isReady)
      .mockReset()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)

    const pcm = new Float32Array(5120)
    await engine.transcribe(pcm)

    expect(recognizer.decode).toHaveBeenCalledTimes(3)
    expect(stream.acceptWaveform).toHaveBeenCalledTimes(1)
    expect(stream.acceptWaveform).toHaveBeenCalledWith(16000, pcm)
  })

  it('isEndpoint() === false: returns no segments, never reads or resets', async () => {
    const { recognizer } = fakeRecognizer({ isEndpoint: false })
    const engine = nemotronEngine(Promise.resolve(recognizer))
    await engine.warmup()
    vi.mocked(recognizer.reset).mockClear()

    const segments = await engine.transcribe(new Float32Array(5120))

    expect(segments).toEqual([])
    expect(recognizer.getResult).not.toHaveBeenCalled()
    expect(recognizer.reset).not.toHaveBeenCalled()
  })

  it('isEndpoint() === true: returns one segment; reset happens exactly once, after getResult', async () => {
    const calls: string[] = []
    const { recognizer } = fakeRecognizer({
      isEndpoint: true,
      result: { text: 'ola', timestamps: [0], start_time: 0 },
    })
    vi.mocked(recognizer.getResult).mockImplementation(() => {
      calls.push('getResult')
      return { text: 'ola', timestamps: [0], start_time: 0 }
    })
    vi.mocked(recognizer.reset).mockImplementation(() => {
      calls.push('reset')
    })
    const engine = nemotronEngine(Promise.resolve(recognizer))
    await engine.warmup()
    vi.mocked(recognizer.reset).mockClear()
    calls.length = 0

    const segments = await engine.transcribe(new Float32Array(5120))

    expect(segments).toHaveLength(1)
    expect(recognizer.reset).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['getResult', 'reset'])
  })

  it('maps start_time + timestamps to absolute startMs/endMs', async () => {
    const { recognizer } = fakeRecognizer({
      isEndpoint: true,
      result: { text: 'ola', timestamps: [0.1, 0.9], start_time: 4.2 },
    })
    const engine = nemotronEngine(Promise.resolve(recognizer))
    await engine.warmup()

    const [segment] = await engine.transcribe(new Float32Array(5120))

    expect(segment).toEqual({ startMs: 4300, endMs: 5100, text: 'ola' })
  })

  it('endpoint with whitespace-only text: returns no segments but still resets', async () => {
    const { recognizer } = fakeRecognizer({
      isEndpoint: true,
      result: { text: '   ', timestamps: [0], start_time: 0 },
    })
    const engine = nemotronEngine(Promise.resolve(recognizer))
    await engine.warmup()
    vi.mocked(recognizer.reset).mockClear()

    const segments = await engine.transcribe(new Float32Array(5120))

    expect(segments).toEqual([])
    expect(recognizer.reset).toHaveBeenCalledTimes(1)
  })

  it('falls back to start_time for both edges when timestamps is empty', async () => {
    const { recognizer } = fakeRecognizer({
      isEndpoint: true,
      result: { text: 'ola', timestamps: [], start_time: 2.5 },
    })
    const engine = nemotronEngine(Promise.resolve(recognizer))
    await engine.warmup()

    const [segment] = await engine.transcribe(new Float32Array(5120))

    expect(segment.startMs).toBe(2500)
    expect(segment.endMs).toBe(2500)
  })

  it('close() frees stream and recognizer once each; a second close() does not repeat it', async () => {
    const { recognizer, stream } = fakeRecognizer()
    const engine = nemotronEngine(Promise.resolve(recognizer))
    await engine.warmup()

    await engine.close()
    await engine.close()

    expect(stream.free).toHaveBeenCalledTimes(1)
    expect(recognizer.free).toHaveBeenCalledTimes(1)
  })

  it('close() without warmup() resolves without touching anything', async () => {
    const { recognizer, stream } = fakeRecognizer()
    const engine = nemotronEngine(Promise.resolve(recognizer))

    await expect(engine.close()).resolves.toBeUndefined()

    expect(stream.free).not.toHaveBeenCalled()
    expect(recognizer.free).not.toHaveBeenCalled()
  })

  it('keeps one stream across windows: two transcribe() calls, one createStream() total', async () => {
    const { recognizer } = fakeRecognizer()
    const engine = nemotronEngine(Promise.resolve(recognizer))
    await engine.warmup()

    await engine.transcribe(new Float32Array(5120))
    await engine.transcribe(new Float32Array(5120))

    expect(recognizer.createStream).toHaveBeenCalledTimes(1)
  })

  it('transcribe() called right after warmup() without awaiting it (live-session.ts pattern) waits for the same warmup and does not crash', async () => {
    const { recognizer, stream } = fakeRecognizer({
      isEndpoint: true,
      result: { text: 'ola', timestamps: [0], start_time: 0 },
    })
    const engine = nemotronEngine(Promise.resolve(recognizer))

    void engine.warmup() // deliberately not awaited, like live-session.ts:106
    const segments = await engine.transcribe(new Float32Array(5120))

    expect(recognizer.createStream).toHaveBeenCalledTimes(1)
    expect(stream.acceptWaveform).toHaveBeenCalledWith(16000, expect.any(Float32Array))
    expect(segments).toEqual([{ startMs: 0, endMs: 0, text: 'ola' }])
  })

  it('transcribe() called before warmup() throws a contract error instead of crashing on undefined', async () => {
    const { recognizer } = fakeRecognizer()
    const engine = nemotronEngine(Promise.resolve(recognizer))

    await expect(engine.transcribe(new Float32Array(5120))).rejects.toThrow(
      'transcribe() chamado antes de warmup()',
    )
  })

  it('close() called before warmup() resolves waits for it and frees the resources it produced', async () => {
    const { recognizer, stream } = fakeRecognizer()
    const engine = nemotronEngine(Promise.resolve(recognizer))

    void engine.warmup()
    await engine.close()

    expect(stream.free).toHaveBeenCalledTimes(1)
    expect(recognizer.free).toHaveBeenCalledTimes(1)
  })

  it('close() called before a rejecting warmup() resolves anyway without touching anything', async () => {
    const engine = nemotronEngine(Promise.reject(new Error('404')))

    void engine.warmup().catch(() => {})
    await expect(engine.close()).resolves.toBeUndefined()
  })
})
