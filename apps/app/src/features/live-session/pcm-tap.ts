import pcmTapUrl from './pcm-tap.processor.ts?worker&url' // Vite bundla o worklet + deps
import type { Ring } from '@limmiar/audio'

const SAMPLE_RATE_HZ = 16000

/**
 * Tomada B: liga `stream` a um `AudioWorkletNode` que empurra PCM em `ring`.
 * Resample (16kHz) e downmix (mono) são nativos do `AudioContext`/`channelCount`
 * — zero DSP neste ficheiro (decisão 1 do desenho). Rejeita se o browser não
 * tiver `AudioWorklet`/SAB — o chamador (`live-session`) trata como best-effort.
 */
export async function ligarTap(stream: MediaStream, ring: Ring): Promise<() => void> {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE_HZ })
  await ctx.audioWorklet.addModule(pcmTapUrl)
  await ctx.resume()

  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'pcm-tap', {
    // `ring.header` é a view Int32Array no offset 0 do SAB — `.buffer` é o
    // próprio SAB (decisão 4 do desenho).
    processorOptions: { sab: ring.header.buffer as SharedArrayBuffer },
    channelCount: 1,
    channelCountMode: 'explicit',
    // ponytail: sink zero-output; se um browser não puxar, gain 0 → destination
    numberOfOutputs: 0,
  })
  source.connect(node)

  return () => {
    source.disconnect()
    node.disconnect()
    void ctx.close()
  }
}
