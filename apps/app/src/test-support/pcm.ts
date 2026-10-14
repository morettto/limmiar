/** PCM de teste determinístico: soma de senoides (amplitudes 0,3 e 0,2) a 16 kHz. */
export const tom = (amostras: number, ...hz: number[]): Float32Array =>
  Float32Array.from({ length: amostras }, (_, i) => hz.reduce((soma, f, k) => soma + [0.3, 0.2][k]! * Math.sin(2 * Math.PI * f * i / 16000), 0))
