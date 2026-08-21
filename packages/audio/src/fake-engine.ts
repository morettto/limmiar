import type { TranscriptionEngine, TranscriptionSegment } from './transcription-engine.ts'

const SAMPLE_RATE_HZ = 16000

export interface FakeEngineOptions {
  /** Override the default deterministic transcription for scripted scenarios. */
  transcribe?: (pcm: Float32Array) => TranscriptionSegment[]
}

function defaultTranscribe(pcm: Float32Array): TranscriptionSegment[] {
  if (pcm.length === 0) return []
  const endMs = Math.round((pcm.length / SAMPLE_RATE_HZ) * 1000)
  return [{ startMs: 0, endMs, text: `[fake:${pcm.length}]` }]
}

/**
 * Deterministic `TranscriptionEngine` test double: same input length always
 * produces the same output, no `Math.random`, no un-injected `Date.now`.
 */
export function fakeEngine(opts: FakeEngineOptions = {}): TranscriptionEngine {
  const transcribe = opts.transcribe ?? defaultTranscribe
  return {
    async warmup() {},
    async transcribe(pcm) {
      return transcribe(pcm)
    },
    async close() {},
  }
}
