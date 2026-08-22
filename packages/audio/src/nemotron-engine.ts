import type { TranscriptionEngine, TranscriptionSegment } from './transcription-engine.ts'

const SAMPLE_RATE_HZ = 16000 // ring-buffer.ts:27 documents it; asr-loop.ts and
// fake-engine.ts each keep their own copy too — see README.md decision on
// why a shared `SAMPLE_RATE_HZ` export isn't worth reopening 100%-covered
// modules for a value that never changes.

// 320ms of silence @16kHz — same quantum `CHUNK_FRAMES` documents in
// ring-buffer.ts, copied here rather than imported (decision 8: this file
// doesn't know about the ring at all).
const WARMUP_FRAMES = 5120

/** Subconjunto usado do JSON de `SherpaOnnxGetOnlineStreamResultAsJson`. */
export interface AsrResult {
  text: string
  /** Segundos, relativos ao início do segmento corrente (zera em `reset`). */
  timestamps: number[]
  /** Segundos, início do segmento corrente relativo ao início do stream. */
  start_time: number
}

/** Satisfeito por `OnlineStream` do sherpa-onnx sem adapter nenhum. */
export interface AsrStream {
  acceptWaveform(sampleRate: number, samples: Float32Array): void
  free(): void
}

/** Satisfeito por `OnlineRecognizer` do sherpa-onnx sem adapter nenhum. */
export interface AsrRecognizer {
  createStream(): AsrStream
  isReady(stream: AsrStream): boolean
  decode(stream: AsrStream): void
  isEndpoint(stream: AsrStream): boolean
  reset(stream: AsrStream): void
  getResult(stream: AsrStream): AsrResult
  free(): void
}

function decodeUntilNotReady(recognizer: AsrRecognizer, stream: AsrStream): void {
  while (recognizer.isReady(stream)) recognizer.decode(stream)
}

function toSegment(result: AsrResult): TranscriptionSegment[] {
  // ponytail: só finalizados; parcial ao vivo exige SegmentStore.revisarUltimo — mudança de contrato, não deste ficheiro
  if (result.text.trim() === '') return []
  // ponytail: relógio = áudio alimentado, não relógio de parede; a linha exata vem do passe canónico
  const first = result.timestamps[0] ?? 0
  const last = result.timestamps.at(-1) ?? 0
  return [
    {
      startMs: Math.round((result.start_time + first) * 1000),
      endMs: Math.round((result.start_time + last) * 1000),
      text: result.text,
    },
  ]
}

/**
 * `TranscriptionEngine` por cima de um reconhecedor streaming. Recebe a
 * *promessa* do reconhecedor: o carregamento (WASM + pesos) arranca no
 * arranque do Worker e `warmup()` é o ponto onde se espera por ele.
 */
export function nemotronEngine(recognizer: Promise<AsrRecognizer>): TranscriptionEngine {
  // Sem isto, se `warmup()` nunca for chamado (ex.: encerramento antes do
  // carregamento) uma rejeição da promessa ficaria por tratar.
  void recognizer.catch(() => {})

  let readyPromise: Promise<{ rec: AsrRecognizer; stream: AsrStream }> | undefined

  return {
    async warmup() {
      if (readyPromise) {
        await readyPromise
        return // já aquecido (ou a aquecer) — chamada dupla é no-op
      }

      readyPromise = (async () => {
        const rec = await recognizer
        const stream = rec.createStream()
        stream.acceptWaveform(SAMPLE_RATE_HZ, new Float32Array(WARMUP_FRAMES))
        decodeUntilNotReady(rec, stream)
        rec.reset(stream)
        return { rec, stream }
      })()
      await readyPromise
    },

    async transcribe(pcm) {
      // live-session.ts chama warmup() sem `await` antes de arrancar o loop
      // que chama transcribe() — esperar a mesma promessa (em vez de ler
      // `rec`/`stream` soltos) é o que fecha essa corrida: se warmup() ainda
      // não resolveu, transcribe() espera por ela em vez de ver `undefined`.
      if (!readyPromise) throw new Error('transcribe() chamado antes de warmup()')
      const { rec, stream } = await readyPromise

      stream.acceptWaveform(SAMPLE_RATE_HZ, pcm)
      decodeUntilNotReady(rec, stream)

      if (!rec.isEndpoint(stream)) return []

      const result = rec.getResult(stream)
      rec.reset(stream)
      return toSegment(result)
    },

    async close() {
      // ponytail: chamador tem de serializar warmup/transcribe/close (asr.worker.ts
      // já faz via fila) — sem isso, close() a correr em paralelo com um transcribe()
      // em curso liberta stream/recognizer enquanto ainda estão a ser usados
      if (!readyPromise) return
      const ready = await readyPromise.catch(() => undefined)
      readyPromise = undefined
      if (!ready) return
      ready.stream.free()
      ready.rec.free()
    },
  }
}
