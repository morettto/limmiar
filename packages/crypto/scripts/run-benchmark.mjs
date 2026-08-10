// Manual calibration script — NOT run in CI. Run by hand:
//   node packages/crypto/scripts/run-benchmark.mjs
// Measures deriveKey on THIS machine ("desktop/CI") and derives two estimated
// mobile profiles from a public single-core CPU benchmark ratio, then writes
// packages/crypto/BENCHMARK.md.
import { writeFile } from 'node:fs/promises'
import { measureArgon2id } from '../src/benchmark.ts'

// OWASP Password Storage Cheat Sheet, Argon2id section (fetched 2026-08-03):
// https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Password_Storage_Cheat_Sheet.md
// "Use Argon2id with a minimum configuration of 19 MiB of memory, an
// iteration count of 2, and 1 degree of parallelism."
const OWASP_SOURCE =
  'OWASP Password Storage Cheat Sheet (github.com/OWASP/CheatSheetSeries), Argon2id section, fetched 2026-08-03'
const baselineParams = { memoryKiB: 19456, iterations: 2, parallelism: 1 }

// Slowdown multipliers, single-core Geekbench 6 scores (topcpu.net, fetched 2026-08-03):
//   mainstream desktop/laptop CPUs — Intel Core i5-14500 2667, i7-14700 2866,
//   AMD Ryzen 5 7600 2995, Ryzen 7 7700 2829, i5-13600K 2692, Ryzen 7 5800X 2230
//   -> average ~2713
//   mobile mid-range — Snapdragon 7 Gen 3: 1139
//   mobile low-end    — Snapdragon 4 Gen 2: 926
// This repo has no physical mobile hardware to measure against, so the two
// mobile rows below are ESTIMATES obtained by scaling the real desktop/CI
// measurement by these public score ratios — not independent measurements.
const DESKTOP_REFERENCE_SCORE = 2713
const MID_RANGE_MOBILE_SCORE = 1139
const LOW_END_MOBILE_SCORE = 926
const MID_RANGE_MULTIPLIER = DESKTOP_REFERENCE_SCORE / MID_RANGE_MOBILE_SCORE
const LOW_END_MULTIPLIER = DESKTOP_REFERENCE_SCORE / LOW_END_MOBILE_SCORE
const CPU_BENCHMARK_SOURCE = 'Geekbench 6 single-core rankings, topcpu.net, fetched 2026-08-03'

const { msPerCall } = await measureArgon2id(baselineParams)

const measuredAt = new Date().toISOString()
const rows = [
  {
    profile: 'desktop/CI',
    kind: 'measured',
    msPerCall,
    source: `Measured on this machine (Node ${process.version}), ${measuredAt}`,
  },
  {
    profile: 'mobile mid-range',
    kind: 'estimated',
    msPerCall: msPerCall * MID_RANGE_MULTIPLIER,
    source: `Estimated: desktop/CI measurement × ${MID_RANGE_MULTIPLIER.toFixed(2)} (${CPU_BENCHMARK_SOURCE})`,
  },
  {
    profile: 'mobile low-end',
    kind: 'estimated',
    msPerCall: msPerCall * LOW_END_MULTIPLIER,
    source: `Estimated: desktop/CI measurement × ${LOW_END_MULTIPLIER.toFixed(2)} (${CPU_BENCHMARK_SOURCE})`,
  },
]

const paramsDescription = `memoryKiB=${baselineParams.memoryKiB}, iterations=${baselineParams.iterations}, parallelism=${baselineParams.parallelism}`

const table = rows
  .map((row) => `| ${row.profile} | ${row.kind} | ${row.msPerCall.toFixed(2)} | ${paramsDescription} | ${row.source} |`)
  .join('\n')

const markdown = `# Argon2id benchmark — S01-01 calibration

Baseline params (OWASP minimum recommendation, ${OWASP_SOURCE}): \`${paramsDescription}\`.

Only the **desktop/CI** row is an actual measurement, taken on the machine that ran
\`node packages/crypto/scripts/run-benchmark.mjs\`. This sandbox/repo has no physical
mobile hardware available, so the **mobile mid-range** and **mobile low-end** rows are
ESTIMATES: the real desktop/CI number scaled by a public single-core CPU benchmark
ratio (${CPU_BENCHMARK_SOURCE}). They approximate relative single-core throughput, not
a direct Argon2id measurement on that hardware — treat them as calibration guidance,
not a guarantee.

| Profile | Measured or estimated | ms per call | Params | Source |
|---|---|---|---|---|
${table}

Regenerate with \`node packages/crypto/scripts/run-benchmark.mjs\`.
`

await writeFile(new URL('../BENCHMARK.md', import.meta.url), markdown)

console.log(markdown)
