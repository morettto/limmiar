import { resolve } from 'node:path'
import { cruise } from 'dependency-cruiser'
import extractDepcruiseConfig from 'dependency-cruiser/config-utl/extract-depcruise-config'
import { describe, expect, it } from 'vitest'

describe('fsd-no-cross-slice', () => {
  it('flags exactly the sibling-slice imports, spares intra-slice/lower-layer/accepted-pair', async () => {
    const config = await extractDepcruiseConfig(resolve(import.meta.dirname, '.dependency-cruiser.cjs'))

    const { output } = await cruise(['src'], {
      ...config.options,
      ruleSet: config,
      validate: true,
      outputType: 'json',
      baseDir: resolve(import.meta.dirname, 'arch-fixture'),
    })

    const result = JSON.parse(output as string)
    const violations = result.summary.violations as Array<{ rule: { name: string }; from: string; to: string }>
    const sorted = violations
      .map((v) => ({ rule: { name: v.rule.name }, from: v.from, to: v.to }))
      .sort((a, b) => a.from.localeCompare(b.from))

    // Exact list, each entry naming its rule: proves the two narrow rules fire on their own,
    // not just the general one, and that intra-slice/lower-layer/both accepted pairs never
    // sneak into this array.
    expect(sorted).toEqual([
      {
        rule: { name: 'fsd-no-cross-slice-device-pairing-new' },
        from: 'src/features/device-pairing-new/PairNewDevice.ts',
        to: 'src/features/nota-fila/navegacao-teclado.ts',
      },
      {
        rule: { name: 'fsd-no-cross-slice' },
        from: 'src/features/nota-audio/reprodutor.ts',
        to: 'src/features/live-session/audio-crypto.ts',
      },
      {
        rule: { name: 'fsd-no-cross-slice' },
        from: 'src/features/nota-editor/EditorSoap.ts',
        to: 'src/features/nota-fila/navegacao-teclado.ts',
      },
      {
        rule: { name: 'fsd-no-cross-slice' },
        from: 'src/features/nota-fila/outro-importador.ts',
        to: 'src/features/totp-challenge/TotpChallenge.ts',
      },
      {
        rule: { name: 'fsd-no-cross-slice-recovery' },
        from: 'src/features/recovery/RecoveryScreen.ts',
        to: 'src/features/nota-fila/navegacao-teclado.ts',
      },
    ])
  })
})
