import type { TranscriptionSegment } from '@limmiar/audio'

/** Append-only store of transcription segments, shaped for `useSyncExternalStore`. */
export interface SegmentStore {
  /** Contrato `useSyncExternalStore`: devolve o unsubscribe. */
  subscribe(aoMudar: () => void): () => void
  /** Referência estável entre mudanças — nunca reconstrói o array sem append real. */
  getSnapshot(): readonly TranscriptionSegment[]
  /** Chamada pelo `onSegments` do asr-loop. Lote vazio não notifica. */
  acrescentar(segmentos: readonly TranscriptionSegment[]): void
}

export function criarSegmentStore(): SegmentStore {
  let atual: readonly TranscriptionSegment[] = []
  const listeners = new Set<() => void>()

  return {
    subscribe(aoMudar) {
      listeners.add(aoMudar)
      return () => listeners.delete(aoMudar)
    },
    getSnapshot() {
      return atual
    },
    acrescentar(segmentos) {
      if (segmentos.length === 0) return
      atual = [...atual, ...segmentos]
      listeners.forEach((aoMudar) => aoMudar())
    },
  }
}
