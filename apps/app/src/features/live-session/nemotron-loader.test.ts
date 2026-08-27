import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AsrRecognizer } from '@limmiar/audio'
import type { GlueSherpa, ImportarGlue } from './nemotron-loader'

const CONFIG_ESPERADO = {
  featConfig: { sampleRate: 16000, featureDim: 128 },
  modelConfig: {
    transducer: { encoder: './encoder.onnx', decoder: './decoder.onnx', joiner: './joiner.onnx' },
    tokens: './tokens.txt',
    numThreads: 1,
    provider: 'cpu',
    modelType: 'nemotron',
    debug: 0,
  },
  decodingMethod: 'greedy_search',
  maxActivePaths: 4,
  enableEndpoint: 1,
}

// `BASE` é um `const` de topo de módulo lido de `import.meta.env` — só se
// resolve outra vez com módulo re-importado depois do `vi.stubEnv`, mesma
// técnica de `router.test.tsx:24` (`loadRouterAt`).
async function carregar(importarGlue: ImportarGlue) {
  vi.resetModules()
  const { carregarReconhecedor } = await import('./nemotron-loader')
  return carregarReconhecedor(importarGlue)
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('carregarReconhecedor', () => {
  it('sucesso: pede o glue na base default, chama a fábrica com locateFile e devolve o recognizer sem adapter', async () => {
    const recognizerFalso = {} as AsrRecognizer
    const createOnlineRecognizer = vi.fn().mockReturnValue(recognizerFalso)
    const modFalso = { createOnlineRecognizer }
    const criarModulo = vi.fn().mockResolvedValue(modFalso)
    const importarGlue: ImportarGlue = vi.fn().mockResolvedValue({ default: criarModulo } satisfies GlueSherpa)

    const resultado = await carregar(importarGlue)

    expect(importarGlue).toHaveBeenCalledWith('/models/sherpa-onnx-wasm-main-asr.mjs')
    expect(criarModulo).toHaveBeenCalledOnce()
    const opcoes = criarModulo.mock.calls[0][0] as { locateFile: (f: string) => string }
    expect(opcoes.locateFile('sherpa-onnx-wasm-main-asr.wasm')).toBe(
      '/models/sherpa-onnx-wasm-main-asr.wasm',
    )
    expect(createOnlineRecognizer).toHaveBeenCalledWith(modFalso, CONFIG_ESPERADO)
    expect(resultado).toBe(recognizerFalso)
  })

  it('base por VITE_ASR_MODEL_BASE_URL: glue e locateFile sob o host configurado', async () => {
    vi.stubEnv('VITE_ASR_MODEL_BASE_URL', 'https://cdn.exemplo/asr/')
    const createOnlineRecognizer = vi.fn().mockReturnValue({} as AsrRecognizer)
    const criarModulo = vi.fn().mockResolvedValue({ createOnlineRecognizer })
    const importarGlue: ImportarGlue = vi.fn().mockResolvedValue({ default: criarModulo } satisfies GlueSherpa)

    await carregar(importarGlue)

    expect(importarGlue).toHaveBeenCalledWith('https://cdn.exemplo/asr/sherpa-onnx-wasm-main-asr.mjs')
    const opcoes = criarModulo.mock.calls[0][0] as { locateFile: (f: string) => string }
    expect(opcoes.locateFile('sherpa-onnx-wasm-main-asr.wasm')).toBe(
      'https://cdn.exemplo/asr/sherpa-onnx-wasm-main-asr.wasm',
    )
  })

  it('glue rejeita (404/CORS/DNS) → erro nomeia a base e a causa, cause preservada', async () => {
    const causa = new Error('Failed to fetch dynamically imported module')
    const importarGlue: ImportarGlue = vi.fn().mockRejectedValue(causa)

    await expect(carregar(importarGlue)).rejects.toMatchObject({
      message: expect.stringContaining('/models/') as unknown as string,
      cause: causa,
    })
    await expect(carregar(importarGlue)).rejects.toThrow(/Failed to fetch dynamically imported module/)
  })

  it('módulo rejeita (WASM/.data inválido, OOM) → mesma forma de erro', async () => {
    const causa = new Error('out of memory')
    const criarModulo = vi.fn().mockRejectedValue(causa)
    const importarGlue: ImportarGlue = vi.fn().mockResolvedValue({ default: criarModulo } satisfies GlueSherpa)

    await expect(carregar(importarGlue)).rejects.toMatchObject({
      message: expect.stringContaining('/models/') as unknown as string,
      cause: causa,
    })
  })

  it('causa não-Error: mensagem stringificada', async () => {
    const importarGlue: ImportarGlue = vi.fn().mockRejectedValue('boom')

    await expect(carregar(importarGlue)).rejects.toMatchObject({
      message: expect.stringContaining('boom') as unknown as string,
      cause: 'boom',
    })
  })
})
