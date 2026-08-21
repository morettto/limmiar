/** A transcribed span of speech, in milliseconds relative to session start. */
export interface TranscriptionSegment {
  startMs: number
  endMs: number
  text: string
}

/**
 * Contract for an ASR backend. Real implementations (ONNX/Nemotron worker)
 * and test doubles (`fakeEngine`) both implement this — see README.md for
 * why it stays a named interface even with one production implementation
 * (the seam a later slice's worker swaps a real engine into).
 */
export interface TranscriptionEngine {
  warmup(): Promise<void>
  transcribe(pcm: Float32Array): Promise<TranscriptionSegment[]>
  close(): Promise<void>
}
