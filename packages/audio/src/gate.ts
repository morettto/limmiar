/**
 * RMS (root-mean-square) energy of a PCM block. Pure, no state.
 * An empty block has zero energy (avoids dividing by zero).
 */
export function rms(block: Float32Array): number {
  if (block.length === 0) return 0
  let sumOfSquares = 0
  for (let i = 0; i < block.length; i++) {
    const sample = block[i]
    sumOfSquares += sample * sample
  }
  return Math.sqrt(sumOfSquares / block.length)
}

/**
 * Default energy threshold below which a block is treated as silence.
 * 0.01 RMS on a [-1, 1] normalized PCM stream — quiet room tone / mic
 * self-noise sits well under this, a spoken word sits well over it.
 */
export const DEFAULT_SILENCE_RMS = 0.01

/**
 * Decides whether a PCM block is silent enough to skip (not pushed onto
 * the ring / not sent to the ASR engine). Pure, no state.
 */
export function isSilent(
  block: Float32Array,
  threshold: number = DEFAULT_SILENCE_RMS,
): boolean {
  return rms(block) < threshold
}
