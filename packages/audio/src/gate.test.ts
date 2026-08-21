import { describe, expect, it } from 'vitest'
import { DEFAULT_SILENCE_RMS, isSilent, rms } from './gate.ts'

describe('rms', () => {
  it('is zero for an empty block (no division by zero)', () => {
    expect(rms(new Float32Array(0))).toBe(0)
  })

  it('is zero for a silent (all-zero) block', () => {
    expect(rms(new Float32Array(4))).toBe(0)
  })

  it('computes the root-mean-square of the samples', () => {
    // [1, -1, 1, -1] -> mean(square) = 1 -> sqrt(1) = 1
    expect(rms(new Float32Array([1, -1, 1, -1]))).toBe(1)
  })

  it('is not affected by sign (symmetric around zero)', () => {
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5)
  })
})

describe('isSilent', () => {
  it('is true for a block quieter than the default threshold', () => {
    expect(isSilent(new Float32Array([0.0001, -0.0001]))).toBe(true)
  })

  it('is false for a block louder than the default threshold', () => {
    expect(isSilent(new Float32Array([0.5, -0.5]))).toBe(false)
  })

  it('accepts a custom threshold', () => {
    const block = new Float32Array([0.02, -0.02])
    expect(isSilent(block, 0.01)).toBe(false)
    expect(isSilent(block, 0.5)).toBe(true)
  })

  it('exports the default threshold used when none is passed', () => {
    expect(isSilent(new Float32Array([DEFAULT_SILENCE_RMS * 2]))).toBe(false)
  })
})
