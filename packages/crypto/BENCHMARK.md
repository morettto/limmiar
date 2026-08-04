# Argon2id benchmark — S01-01 calibration

Baseline params (OWASP minimum recommendation, OWASP Password Storage Cheat Sheet (github.com/OWASP/CheatSheetSeries), Argon2id section, fetched 2026-08-03): `memoryKiB=19456, iterations=2, parallelism=1`.

Only the **desktop/CI** row is an actual measurement, taken on the machine that ran
`node packages/crypto/scripts/run-benchmark.mjs`. This sandbox/repo has no physical
mobile hardware available, so the **mobile mid-range** and **mobile low-end** rows are
ESTIMATES: the real desktop/CI number scaled by a public single-core CPU benchmark
ratio (Geekbench 6 single-core rankings, topcpu.net, fetched 2026-08-03). They approximate relative single-core throughput, not
a direct Argon2id measurement on that hardware — treat them as calibration guidance,
not a guarantee.

| Profile | Measured or estimated | ms per call | Params | Source |
|---|---|---|---|---|
| desktop/CI | measured | 507.86 | memoryKiB=19456, iterations=2, parallelism=1 | Measured on this machine (Node v22.22.3), 2026-08-03T13:24:54.216Z |
| mobile mid-range | estimated | 1209.67 | memoryKiB=19456, iterations=2, parallelism=1 | Estimated: desktop/CI measurement × 2.38 (Geekbench 6 single-core rankings, topcpu.net, fetched 2026-08-03) |
| mobile low-end | estimated | 1487.92 | memoryKiB=19456, iterations=2, parallelism=1 | Estimated: desktop/CI measurement × 2.93 (Geekbench 6 single-core rankings, topcpu.net, fetched 2026-08-03) |

Regenerate with `node packages/crypto/scripts/run-benchmark.mjs`.
