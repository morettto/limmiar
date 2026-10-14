import createVoiceRuntime from './limmiar-titanet.js'

const MODEL_SHA256 = 'd51abcf31717ef28162f26acb9d44dd4127c3d44c9b8624f699f3425daca8e77'
let runtime
let extractor

async function iniciar() {
  const response = await fetch(new URL('./titanet.onnx', import.meta.url))
  if (!response.ok) throw new Error('Modelo indisponível')
  const model = await response.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', model)
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  if (hash !== MODEL_SHA256) throw new Error('Modelo inválido')
  runtime = await createVoiceRuntime({ print: () => {}, printErr: () => {} })
  runtime.FS.writeFile('/titanet.onnx', new Uint8Array(model))
  extractor = runtime._voice_create()
  if (!extractor || runtime._voice_dimensions(extractor) !== 192) throw new Error('Extrator inválido')
  self.postMessage({ tipo: 'pronto', modelo: MODEL_SHA256 })
}

const pronto = iniciar()
void pronto.catch(() => self.postMessage({ tipo: 'erro' }))
self.onmessage = async ({ data }) => {
  let input = 0
  let output = 0
  try {
    await pronto
    const pcm = data.pcm
    if (!(pcm instanceof Float32Array) || pcm.length < 32000 || pcm.length > 240000 ||
        !pcm.every((value) => Number.isFinite(value) && Math.abs(value) <= 1)) throw new Error('PCM inválido')
    input = runtime._malloc(pcm.byteLength)
    if (!input) throw new Error('Memória insuficiente')
    runtime.HEAPF32.set(pcm, input / 4)
    output = runtime._voice_compute(extractor, input, pcm.length)
    if (!output) throw new Error('Embedding inválido')
    const embedding = Array.from(runtime.HEAPF32.subarray(output / 4, output / 4 + 192))
    const norm = Math.hypot(...embedding)
    if (!embedding.every(Number.isFinite) || !Number.isFinite(norm) || norm === 0) throw new Error('Embedding inválido')
    self.postMessage({ tipo: 'embedding', id: data.id, embedding: embedding.map((value) => value / norm) })
  } catch {
    self.postMessage({ tipo: 'erro', id: data.id })
  } finally {
    if (input) { runtime.HEAPU8.fill(0, input, input + data.pcm.byteLength); runtime._free(input) }
    if (output) { runtime.HEAPU8.fill(0, output, output + 192 * 4); runtime._voice_release(output) }
    if (data.pcm instanceof Float32Array) data.pcm.fill(0)
  }
}
