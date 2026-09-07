import { readFileSync, readdirSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { cruise } from 'dependency-cruiser'
import extractDepcruiseConfig from 'dependency-cruiser/config-utl/extract-depcruise-config'
import { describe, expect, it } from 'vitest'

const FSD_LAYERS = ['pages', 'widgets', 'features', 'entities'] as const

const sliceDirs = (root: string, layer: string) => {
  const layerDir = resolve(root, layer)
  try {
    return readdirSync(layerDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

const looseLayerRootFiles = (root: string, layer: string) => {
  const layerDir = resolve(root, layer)
  try {
    return readdirSync(layerDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

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
    // not just the general one, that intra-slice/lower-layer/both accepted pairs never sneak
    // into this array, and that a file loose at a layer root (no slice folder) also violates.
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
      {
        rule: { name: 'fsd-no-loose-layer-files' },
        from: 'src/features/solto.ts',
        to: 'src/entities/nota/nota.ts',
      },
    ])
  })
})

describe('fsd layer roots have no loose files', () => {
  it('src/<layer> root has no .ts/.tsx file outside a slice folder', () => {
    // Filesystem-level net, independent of depcruise's edge model: fsd-no-loose-layer-files
    // only fires when the loose file has an outgoing import, so a zero-import loose file or
    // one only ever imported by others would slip past it. This test just lists files.
    for (const layer of FSD_LAYERS) {
      expect(looseLayerRootFiles(resolve(import.meta.dirname, 'src'), layer), `src/${layer}`).toEqual([])
    }
  })
})

describe('arch-fixture slice names track src', () => {
  it('every slice folder the fixture reuses from a real slice name still exists in src', () => {
    // Not regenerated from src: that would couple this regex test to whatever slices happen
    // to exist for reasons unrelated to the rule logic. Cross-checking names is enough.
    for (const layer of FSD_LAYERS) {
      const fixtureSlices = sliceDirs(resolve(import.meta.dirname, 'arch-fixture/src'), layer)
      const realSlices = sliceDirs(resolve(import.meta.dirname, 'src'), layer)
      for (const slice of fixtureSlices) {
        expect(realSlices, `arch-fixture/src/${layer}/${slice} não existe em src/${layer}`).toContain(slice)
      }
    }
  })
})

const SRC = resolve(import.meta.dirname, 'src')
const PURGAR_CONTA = resolve(SRC, 'app/providers/purgar-conta.ts')

const semExtensao = (caminho: string) => relative(SRC, caminho).split(sep).join('/').replace(/\.tsx?$/, '')

const ficheirosDeProducao = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const caminho = resolve(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'test-support' ? [] : ficheirosDeProducao(caminho)
    return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) ? [caminho] : []
  })

/** Módulos que abrem a raiz OPFS e cujo nome importado não aparece dentro do literal `PURGAS`
 *  de `purgar-conta.ts`. Um blob escrito por um deles sobreviveria ao logout. */
function modulosOpfsSemPurga(
  modulos: ReadonlyArray<readonly [modulo: string, fonte: string]>,
  fontePurgarConta: string,
): string[] {
  // Até ao `]` na coluna 0: o `[]` da anotação de tipo e o de cada entrada fecham antes.
  const literalPurgas = /const PURGAS[^=]*=\s*\[([\s\S]*?)\n\]/.exec(fontePurgarConta)?.[1] ?? ''
  // Identificadores citados dentro do literal, não o texto cru: importar um tipo do mesmo
  // módulo não pode passar por entrada de purga.
  const citados = new Set(literalPurgas.split(/[^A-Za-z0-9_$]+/))
  const registados = new Set<string>()
  for (const [, nomes, especificador] of fontePurgarConta.matchAll(/import \{([^}]+)\} from '([^']+)'/g)) {
    const naLista = nomes.split(',').some((nome) => citados.has(nome.trim()))
    if (naLista) registados.add(semExtensao(resolve(dirname(PURGAR_CONTA), especificador)))
  }
  return modulos
    .filter(([, fonte]) => fonte.includes('navigator.storage.getDirectory'))
    .map(([modulo]) => modulo)
    .filter((modulo) => !registados.has(modulo))
}

describe('purgas de conta cobrem quem abre a raiz OPFS', () => {
  // A convenção `<raiz OPFS>/<accountId>` vive em `dirIndiceDaConta` (S18-12); este teste é a
  // outra metade: quem abre a raiz tem de estar em `PURGAS`, ou o blob sobrevive ao logout.
  it('todo módulo de produção que chama navigator.storage.getDirectory() tem entrada em PURGAS', () => {
    const modulos = ficheirosDeProducao(SRC).map((f) => [semExtensao(f), readFileSync(f, 'utf8')] as const)

    expect(modulosOpfsSemPurga(modulos, readFileSync(PURGAR_CONTA, 'utf8'))).toEqual([])
  })

  it('um módulo novo que abre a raiz OPFS sem entrada em PURGAS é apanhado', () => {
    const gravadorNovo = ['features/live-session/chunk-writer', 'await navigator.storage.getDirectory()'] as const

    expect(modulosOpfsSemPurga([gravadorNovo], readFileSync(PURGAR_CONTA, 'utf8'))).toEqual([
      'features/live-session/chunk-writer',
    ])
  })
})
