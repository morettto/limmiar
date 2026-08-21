/**
 * Greedy CTC decode: `logits` is a flat [time, vocabSize] array (row-major,
 * one row of `vocabSize` scores per time step). Picks the argmax per step,
 * collapses consecutive repeats, and drops the blank token (vocab index 0).
 * Pure, no state.
 */
export function ctcGreedy(
  logits: Float32Array,
  vocabSize: number,
  vocab: string[],
): string {
  if (vocabSize <= 0) return ''

  const steps = Math.floor(logits.length / vocabSize)
  let previous = -1
  let text = ''

  for (let t = 0; t < steps; t++) {
    const offset = t * vocabSize
    let best = 0
    let bestScore = logits[offset]
    for (let v = 1; v < vocabSize; v++) {
      const score = logits[offset + v]
      if (score > bestScore) {
        bestScore = score
        best = v
      }
    }

    if (best !== previous && best !== 0) {
      text += vocab[best]
    }
    previous = best
  }

  return text
}
