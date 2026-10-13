import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { similaridadeCosseno } from '@limmiar/diarization'
import { criarExtratorTitanet } from './extrator.ts'
import { criarTrabalhadorTitanet } from './trabalhador-titanet.ts'

const MODELO = process.env.GATEWAY_FALA_MODELO ?? fileURLToPath(new URL('../../app/public/models/voice-identity/titanet.onnx', import.meta.url))

// O mesmo PCM, 3 s da voz Maria (TTS), medido pelo extrator WASM do aparelho (apps/app/public/models/voice-identity/worker.js,
// no Chromium) e por este serviço (sherpa-onnx nativo). Rode `node tools/voice-identity/setup.mjs` para baixar o modelo.
describe.skipIf(!existsSync(MODELO))('TitaNet no servidor, com o modelo real', () => {
  it('dá o mesmo embedding do aparelho para o mesmo PCM (cosseno >= 0,99)', async () => {
    const bytes = readFileSync(new URL('./fixtures/maria-3s.pcm', import.meta.url))
    const pcm = Float32Array.from(new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2), (amostra) => amostra / 32768)
    const doAparelho = JSON.parse(readFileSync(new URL('./fixtures/maria-3s.embedding-wasm.json', import.meta.url), 'utf8')) as number[]
    const extrator = await criarExtratorTitanet({ modelo: MODELO, threads: 1, aoQuebrar: (erro) => { throw erro } }, criarTrabalhadorTitanet)
    try {
      expect(extrator.dimensao).toBe(192)
      const doServidor = await extrator.embutir(pcm.slice())
      expect(doServidor).not.toBeNull()
      expect(similaridadeCosseno(doAparelho, [...doServidor!])).toBeGreaterThanOrEqual(0.99)
      expect(similaridadeCosseno([...(await extrator.embutir(pcm.slice()))!], [...doServidor!])).toBeCloseTo(1, 6)
    } finally { await extrator.encerrar() }
  }, 60_000)

  it('devolve null, sem quebrar o extrator, quando o áudio não tem nem 400 amostras', async () => {
    const extrator = await criarExtratorTitanet({ modelo: MODELO, threads: 1, aoQuebrar: (erro) => { throw erro } }, criarTrabalhadorTitanet)
    try {
      expect(await extrator.embutir(new Float32Array(10))).toBeNull()
    } finally { await extrator.encerrar() }
  }, 60_000)
})
