import { parentPort, workerData } from 'node:worker_threads'
import sherpa from 'sherpa-onnx-node'
import type { PedidoVoz } from './extrator.ts'
import { TAXA_AMOSTRAGEM } from './protocolo.ts'

const porta = parentPort!
const { modelo, modeloSegmentacao } = workerData as { modelo: string; modeloSegmentacao: string }
const extrator = new sherpa.SpeakerEmbeddingExtractor({ model: modelo, numThreads: 1, provider: 'cpu', debug: false })
const segmentador = new sherpa.OfflineSpeakerDiarization({
  segmentation: { pyannote: { model: modeloSegmentacao }, numThreads: 1, provider: 'cpu', debug: false },
  embedding: { model: modelo, numThreads: 1, provider: 'cpu', debug: false },
  clustering: { numClusters: -1, threshold: 0.5 }, minDurationOn: 0.3, minDurationOff: 0.5,
})
porta.postMessage({ tipo: 'pronto', dimensao: extrator.dim })

function embutir(pcm: Float32Array): Float32Array | null {
  try {
    const fluxo = extrator.createStream()
    fluxo.acceptWaveform({ samples: pcm, sampleRate: TAXA_AMOSTRAGEM })
    // Sem quadros suficientes o sherpa devolve memória solta em vez de falhar.
    if (!extrator.isReady(fluxo)) return null
    const embedding = Float32Array.from(extrator.compute(fluxo))
    const norma = Math.hypot(...embedding)
    return embedding.every(Number.isFinite) && Number.isFinite(norma) && norma > 0 ? embedding : null
  } catch { return null }
}

porta.on('message', ({ tipo, pcm }: PedidoVoz) => {
  try {
    if (tipo === 'segmentos') porta.postMessage({ tipo: 'segmentos', segmentos: pcm.length === 0 ? [] : segmentador.process(pcm) })
    else {
      const embedding = embutir(pcm)
      porta.postMessage({ tipo: 'embedding', embedding }, embedding ? [embedding.buffer as ArrayBuffer] : [])
    }
  } finally { pcm.fill(0) }
})
