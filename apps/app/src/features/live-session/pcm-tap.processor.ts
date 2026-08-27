import { CHUNK_FRAMES, attachRing, isSilent, push } from '@limmiar/audio'
import type { Ring } from '@limmiar/audio'

// @types/audioworklet não instalado; 2 declarações locais > 1 dependência
// nova (decisão 1/7 do desenho da fatia 4).
declare const AudioWorkletProcessor: { new (): object }
declare function registerProcessor(nome: string, ctor: unknown): void

interface PcmTapOptions {
  processorOptions: { sab: SharedArrayBuffer }
}

/**
 * Corre na audio thread. Acumula quanta de 128 frames até `CHUNK_FRAMES`
 * (320ms @16kHz), aplica o gate de silêncio sobre o bloco inteiro e empurra
 * no ring best-effort — zero `postMessage`, zero alocação por quantum.
 */
class PcmTap extends AudioWorkletProcessor {
  private readonly ring: Ring
  private readonly buffer = new Float32Array(CHUNK_FRAMES)
  private escrito = 0

  constructor(options: PcmTapOptions) {
    super()
    this.ring = attachRing(options.processorOptions.sab)
  }

  process(inputs: Float32Array[][]): boolean {
    const canal = inputs[0]?.[0]
    if (!canal) return true

    this.buffer.set(canal, this.escrito)
    this.escrito += canal.length

    if (this.escrito === CHUNK_FRAMES) {
      if (!isSilent(this.buffer)) push(this.ring, this.buffer)
      this.escrito = 0
    }

    return true
  }
}

registerProcessor('pcm-tap', PcmTap)
