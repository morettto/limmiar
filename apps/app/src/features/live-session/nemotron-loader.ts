import type { AsrRecognizer } from '@limmiar/audio'

/** Base dos artefactos. Tem de terminar em `/`. Dev: `public/models/` (gitignored).
 *  Produção: object store externo — ver decisão 5 do desenho da fatia 6. */
const BASE = import.meta.env.VITE_ASR_MODEL_BASE_URL ?? '/models/'

/** Config do reconhecedor online. Paths são MEMFS (vêm no `.data`), não URLs. */
const CONFIG = {
  featConfig: { sampleRate: 16000, featureDim: 128 },
  modelConfig: {
    transducer: { encoder: './encoder.onnx', decoder: './decoder.onnx', joiner: './joiner.onnx' },
    tokens: './tokens.txt',
    numThreads: 1, // o build WASM não tem pthreads — decisão 9
    provider: 'cpu', // único EP disponível
    modelType: 'nemotron', // rejeita decode que não seja greedy
    debug: 0, // upstream traz 1 e enche a consola
  },
  decodingMethod: 'greedy_search',
  maxActivePaths: 4,
  enableEndpoint: 1,
}

/** Instância Emscripten. Só o que este ficheiro usa: `createOnlineRecognizer`
 *  é anexado ao módulo pelo `--post-js` da nossa build (decisão 3). */
interface ModuloSherpa {
  createOnlineRecognizer(modulo: ModuloSherpa, config: typeof CONFIG): AsrRecognizer
}

/** Fábrica exportada por `sherpa-onnx-wasm-main-asr.mjs` (`-sMODULARIZE=1 -sEXPORT_ES6=1`). */
type FabricaModulo = (opcoes: { locateFile: (ficheiro: string) => string }) => Promise<ModuloSherpa>

export interface GlueSherpa {
  default: FabricaModulo
}

/** Seam de plataforma: `import()` de uma URL só conhecida em runtime não é
 *  intercetável por `vi.mock`. Mesmo padrão de `WriteSealed` em `chunk-store.ts`
 *  e de `engine`/`storage`/`gpu` em `live-session.ts`. Decisão 6. */
export type ImportarGlue = (url: string) => Promise<GlueSherpa>

// ponytail: carga não é cancelável; o Worker morre com terminate() e leva o
// download atrás (decisão 8 do desenho da fatia 6).
export async function carregarReconhecedor(importarGlue: ImportarGlue): Promise<AsrRecognizer> {
  try {
    const glue = await importarGlue(BASE + 'sherpa-onnx-wasm-main-asr.mjs')
    const mod = await glue.default({ locateFile: (ficheiro) => BASE + ficheiro })
    return mod.createOnlineRecognizer(mod, CONFIG)
  } catch (error) {
    const causa = error instanceof Error ? error.message : String(error)
    throw new Error(`ASR: falhou a carregar de ${BASE} — ${causa}`, { cause: error })
  }
}
