export function codificarWav(pcm: Float32Array, sampleRate = 16000): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) {
    throw new Error('Taxa de áudio inválida.')
  }
  const dataBytes = pcm.length * 2
  if (dataBytes > 0xffffffff - 36) throw new Error('Áudio excede o limite RIFF/WAVE.')
  const bytes = new Uint8Array(44 + dataBytes)
  const view = new DataView(bytes.buffer)
  for (const [offset, texto] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) {
    for (let i = 0; i < texto.length; i++) view.setUint8(offset + i, texto.charCodeAt(i))
  }
  view.setUint32(4, 36 + dataBytes, true)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < pcm.length; i++) {
    const sample = pcm[i]!
    if (!Number.isFinite(sample)) throw new Error('Amostra de áudio inválida.')
    const clamped = Math.max(-1, Math.min(1, sample))
    view.setInt16(44 + i * 2, Math.round(clamped * (clamped < 0 ? 32768 : 32767)), true)
  }
  return bytes
}
