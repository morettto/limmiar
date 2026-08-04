// Explicit .ts extension (vs the bare specifier used elsewhere in this package):
// this module is also run directly by Node (scripts/run-benchmark.mjs), whose
// native TS support, unlike Vite/Vitest's bundler resolution, requires it.
import { deriveKey, type Argon2Params } from './argon2id.ts'

export interface BenchmarkResult {
  msPerCall: number
}

// Manual calibration tool (see vite.config.ts / stryker.config.mjs exclusions) — run by a
// human against real hardware to pick per-device-tier Argon2Params, not gated logic.
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
