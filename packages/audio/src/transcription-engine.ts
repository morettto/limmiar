/** A transcribed span of speech, in milliseconds relative to session start. */
export interface TranscriptionSegment {
  startMs: number
  endMs: number
  text: string
}

/**
 * Contract for an ASR backend, implemented by the Nemotron worker and by
 * `fakeEngine`. README.md says why it stays a named interface with one
 * production implementation.
 */
export interface TranscriptionEngine {
  warmup(): Promise<void>
  transcribe(pcm: Float32Array): Promise<TranscriptionSegment[]>
  close(): Promise<void>
}
