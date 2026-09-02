import { CHUNK_FRAMES, droppedFrames, pull, waitFor, type Ring } from './ring-buffer.ts'
import type { TranscriptionEngine, TranscriptionSegment } from './transcription-engine.ts'

const DEFAULT_WINDOW_FRAMES = 5 * CHUNK_FRAMES // ~1.6s @16kHz per transcribe() call
const SAMPLE_RATE_HZ = 16000 // same rate CHUNK_FRAMES documents in ring-buffer.ts

// ponytail: fixed poll cadence, not an instant abort reaction. Ceiling: up to
// this many ms of abort latency while idle. Upgrade path: race `waitFor`
// against a promise resolved by the signal's 'abort' event.
const POLL_TIMEOUT_MS = 200

export interface AsrLoopStats {
  rtf: number
  droppedFrames: number
  windows: number
}

export interface RunAsrLoopOptions {
  ring: Ring
  engine: TranscriptionEngine
  signal: AbortSignal
  windowFrames?: number
  onSegments: (segments: TranscriptionSegment[]) => void | Promise<void>
  onStats: (stats: AsrLoopStats) => void | Promise<void>
  now?: () => number
}

/**
 * Consumes `ring` in fixed-size windows until `signal.aborted`. A partial
 * window is never processed: the loop waits for a full one or for abort, and a
 * trailing partial window is left unread (README.md, "O que este loop não faz").
 */
function statsSnapshot(
  ring: Ring,
  processingMs: number,
  audioMs: number,
  windows: number,
): AsrLoopStats {
  return {
    rtf: audioMs === 0 ? 0 : processingMs / audioMs,
    droppedFrames: droppedFrames(ring),
    windows,
  }
}

export async function runAsrLoop({
  ring,
  engine,
  signal,
  windowFrames = DEFAULT_WINDOW_FRAMES,
  onSegments,
  onStats,
  now = Date.now,
}: RunAsrLoopOptions): Promise<AsrLoopStats> {
  // Single-producer/single-consumer ring: only `waitFor` grows `available` and
  // only this loop shrinks it, so after `waitFor` confirms a full window `pull`
  // always fills `windowBuffer` — no partial-window branch here.
  const windowBuffer = new Float32Array(windowFrames)
  let processingMs = 0
  let audioMs = 0
  let windows = 0

  while (!signal.aborted) {
    const ready = await waitFor(ring, windowFrames, POLL_TIMEOUT_MS)
    if (signal.aborted) break
    if (!ready) continue

    pull(ring, windowBuffer)

    const t0 = now()
    const segments = await engine.transcribe(windowBuffer)
    const t1 = now()

    processingMs += t1 - t0
    audioMs += (windowFrames / SAMPLE_RATE_HZ) * 1000
    windows += 1

    await onSegments(segments)
    await onStats(statsSnapshot(ring, processingMs, audioMs, windows))
  }

  return statsSnapshot(ring, processingMs, audioMs, windows)
}

