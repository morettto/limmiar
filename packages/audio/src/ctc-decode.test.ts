import { describe, expect, it } from 'vitest'
import { ctcGreedy } from './ctc-decode.ts'

const VOCAB = ['_', 'a', 'b'] // index 0 is the CTC blank

/** Builds a flat [time, vocabSize] logits array where `bestPerStep[t]` wins argmax at step t. */
function logitsFor(bestPerStep: number[], vocabSize: number): Float32Array {
  const logits = new Float32Array(bestPerStep.length * vocabSize)
  bestPerStep.forEach((best, t) => {
    logits[t * vocabSize + best] = 10
  })
  return logits
}

describe('ctcGreedy', () => {
  it('returns an empty string for empty logits', () => {
    expect(ctcGreedy(new Float32Array(0), VOCAB.length, VOCAB)).toBe('')
  })

  it('returns an empty string for a non-positive vocabSize', () => {
    expect(ctcGreedy(new Float32Array(4), 0, VOCAB)).toBe('')
    expect(ctcGreedy(new Float32Array(4), -1, VOCAB)).toBe('')
  })

  it('returns an empty string when every step argmaxes to the blank', () => {
    const logits = logitsFor([0, 0, 0], VOCAB.length)
    expect(ctcGreedy(logits, VOCAB.length, VOCAB)).toBe('')
  })

  it('collapses consecutive repeats and drops the blank', () => {
    // a, a, b, _, b -> "a" (collapsed), "b", blank resets, "b" again (new run)
    const logits = logitsFor([1, 1, 2, 0, 2], VOCAB.length)
    expect(ctcGreedy(logits, VOCAB.length, VOCAB)).toBe('abb')
  })

  it('picks the argmax per step, not just the first non-zero logit', () => {
    const logits = new Float32Array(VOCAB.length)
    logits[1] = 0.1
    logits[2] = 5 // 'b' wins despite coming after 'a' in the vocab
    expect(ctcGreedy(logits, VOCAB.length, VOCAB)).toBe('b')
  })
})
