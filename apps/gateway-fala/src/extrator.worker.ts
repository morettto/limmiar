import { parentPort, workerData } from 'node:worker_threads'
import sherpa from 'sherpa-onnx-node'
import { TAXA_AMOSTRAGEM } from './protocolo.ts'

const porta = parentPort!
const extrator = new sherpa.SpeakerEmbeddingExtractor({ model: (workerData as { modelo: string }).modelo, numThreads: 1, provider: 'cpu', debug: false })
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

porta.on('message', (pcm: Float32Array) => {
  const embedding = embutir(pcm)
  pcm.fill(0)
  porta.postMessage({ tipo: 'embedding', embedding }, embedding ? [embedding.buffer as ArrayBuffer] : [])
})
