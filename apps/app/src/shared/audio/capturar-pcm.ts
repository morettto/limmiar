import { t } from '@lingui/core/macro'
import workletUrl from './realtime-pcm.processor.ts?worker&url'

export interface CapturaPcm {
  pausar(pausada: boolean): void
  encerrar(): Promise<void>
  cancelar(): void
}

export interface ControleTrilhas {
  trilhas: 'proprias' | 'emprestadas'
  aoEncerrarTrilha?(): void
}

export async function capturarPcm(stream: MediaStream, signal: AbortSignal,
  receber: (pcm: Float32Array) => void, falhar: () => void, controle: ControleTrilhas): Promise<CapturaPcm> {
  const tracks = stream.getTracks()
  // O contexto roda na taxa do microfone (Firefox exige igualdade); o worklet reduz para 16 kHz.
  const taxa = stream.getAudioTracks()[0]?.getSettings().sampleRate
  const contexto = new AudioContext(taxa === undefined ? undefined : { sampleRate: taxa })
  const encerrarTrilha = controle.aoEncerrarTrilha ?? falhar
  let node: AudioWorkletNode | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let fechada = false
  let drenar: (() => void) | undefined
  let encerramento: Promise<void> | undefined
  const cancelar = () => {
    if (fechada) return
    fechada = true
    signal.removeEventListener('abort', cancelar)
    tracks.forEach((track) => {
      track.removeEventListener('ended', encerrarTrilha)
      if (controle.trilhas === 'proprias') track.stop()
    })
    source?.disconnect()
    node?.disconnect()
    drenar?.()
    void contexto.close()
  }
  signal.addEventListener('abort', cancelar)
  try {
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
    await contexto.audioWorklet.addModule(workletUrl)
    if (fechada) throw new DOMException('Cancelado', 'AbortError')
    await contexto.resume()
    if (fechada) throw new DOMException('Cancelado', 'AbortError')
    node = new AudioWorkletNode(contexto, 'realtime-pcm', { channelCount: 1, channelCountMode: 'explicit', numberOfOutputs: 0 })
    node.onprocessorerror = falhar
    node.port.onmessage = ({ data }: MessageEvent<{ pcm?: Float32Array; type?: string }>) => {
      if (fechada) return
      if (data.pcm) receber(data.pcm)
      else if (data.type === 'drained') drenar?.()
    }
    source = contexto.createMediaStreamSource(stream)
    source.connect(node)
    tracks.forEach((track) => track.addEventListener('ended', encerrarTrilha))
    return {
      pausar: (pausada) => { tracks.forEach((track) => { track.enabled = !pausada }) },
      cancelar,
      encerrar: () => {
        encerramento ??= new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => { reject(new Error(t`O microfone não concluiu a captura.`)) }, 5000)
          drenar = () => { clearTimeout(timeout); resolve() }
          node!.port.postMessage({ type: 'stop' })
        }).finally(cancelar)
        return encerramento
      },
    }
  } catch (erro) { cancelar(); throw erro }
}
