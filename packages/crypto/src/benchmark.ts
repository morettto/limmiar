// Explicit .ts extension: this module is also run directly by Node (scripts/run-benchmark.mjs), whose native TS support requires it, unlike the bare specifiers used elsewhere.
import { deriveKey, type Argon2Params } from './argon2id.ts'

export interface BenchmarkResult {
  msPerCall: number
}

// Manual calibration tool run by a human against real hardware to pick per-device-tier Argon2Params (excluded from vite.config.ts / stryker.config.mjs as non-gated logic).
export async function measureArgon2id(params: Argon2Params, iterations = 5): Promise<BenchmarkResult> {
  const password = new Uint8Array(32).fill(0x01)
  const salt = new Uint8Array(16).fill(0x02)

  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    await deriveKey(password, salt, params)
  }
  const elapsed = performance.now() - start

  return { msPerCall: elapsed / iterations }
}
