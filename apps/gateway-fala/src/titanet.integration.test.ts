import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { similaridadeCosseno } from '@limmiar/diarization'
import { atribuirVozes, falanteNoInstante } from './atribuicao.ts'
import { Locutores } from './locutores.ts'
import { criarExtratorTitanet } from './extrator.ts'
import { criarTrabalhadorTitanet } from './trabalhador-titanet.ts'

const SEGMENTACAO = process.env.GATEWAY_FALA_SEGMENTACAO ?? fileURLToPath(new URL('../../../.local/diarization/sherpa-onnx-pyannote-segmentation-3-0/model.onnx', import.meta.url))

const MODELO = process.env.GATEWAY_FALA_MODELO ?? fileURLToPath(new URL('../../app/public/models/voice-identity/titanet.onnx', import.meta.url))

// O mesmo PCM, 3 s da voz Maria (TTS), medido pelo extrator WASM do aparelho (apps/app/public/models/voice-identity/worker.js,
// no Chromium) e por este serviço (sherpa-onnx nativo). Rode `node tools/voice-identity/setup.mjs` para baixar o modelo.
describe.skipIf(!existsSync(MODELO) || !existsSync(SEGMENTACAO))('TitaNet no servidor, com o modelo real', () => {
  it('dá o mesmo embedding do aparelho para o mesmo PCM (cosseno >= 0,99)', async () => {
    const bytes = readFileSync(new URL('./fixtures/maria-3s.pcm', import.meta.url))
    const pcm = Float32Array.from(new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2), (amostra) => amostra / 32768)
    const doAparelho = JSON.parse(readFileSync(new URL('./fixtures/maria-3s.embedding-wasm.json', import.meta.url), 'utf8')) as number[]
    const extrator = await criarExtratorTitanet({ modelo: MODELO, modeloSegmentacao: SEGMENTACAO, threads: 1, aoQuebrar: (erro) => { throw erro } }, criarTrabalhadorTitanet)
    try {
      expect(extrator.dimensao).toBe(192)
      const doServidor = await extrator.embutir(pcm.slice())
      expect(doServidor).not.toBeNull()
      expect(similaridadeCosseno(doAparelho, [...doServidor!])).toBeGreaterThanOrEqual(0.99)
      expect(similaridadeCosseno([...(await extrator.embutir(pcm.slice()))!], [...doServidor!])).toBeCloseTo(1, 6)
    } finally { await extrator.encerrar() }
  }, 60_000)

  it('devolve null, sem quebrar o extrator, quando o áudio não tem nem 400 amostras', async () => {
    const extrator = await criarExtratorTitanet({ modelo: MODELO, modeloSegmentacao: SEGMENTACAO, threads: 1, aoQuebrar: (erro) => { throw erro } }, criarTrabalhadorTitanet)
    try {
      expect(await extrator.embutir(new Float32Array(10))).toBeNull()
    } finally { await extrator.encerrar() }
  }, 60_000)
  it('segmenta áudio real com o mesmo pool sem bloquear a extração posterior', async () => {
    const bytes = readFileSync(new URL('./fixtures/maria-3s.pcm', import.meta.url))
    const pcm = Float32Array.from(new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2), amostra => amostra / 32768)
    const extrator = await criarExtratorTitanet({ modelo: MODELO, modeloSegmentacao: SEGMENTACAO, threads: 1, aoQuebrar: erro => { throw erro } }, criarTrabalhadorTitanet)
    try {
      const segmentos = await extrator.segmentar(pcm.slice())
      expect(segmentos.length).toBeGreaterThan(0)
      expect(segmentos.every(segmento => Number.isFinite(segmento.start) && segmento.end > segmento.start && Number.isInteger(segmento.speaker))).toBe(true)
      expect(await extrator.embutir(pcm.slice())).not.toBeNull()
    } finally { await extrator.encerrar() }
  }, 60_000)

  it('atribui profissional e paciente dentro do mesmo áudio com modelos reais', async () => {
    const bytes = readFileSync(new URL('./fixtures/maria-zira-10s.pcm', import.meta.url))
    const pcm = Float32Array.from(new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2), amostra => amostra / 32768)
    const perfil = JSON.parse(readFileSync(new URL('./fixtures/maria-3s.embedding-wasm.json', import.meta.url), 'utf8')) as number[]
    const extrator = await criarExtratorTitanet({ modelo: MODELO, modeloSegmentacao: SEGMENTACAO, threads: 2, aoQuebrar: erro => { throw erro } }, criarTrabalhadorTitanet)
    const locutores = new Locutores(perfil)
    try {
      const trechos = await atribuirVozes(pcm.slice(), 0, 1500, extrator, locutores)
      expect(falanteNoInstante(trechos, 1000)).toBe('profissional')
      expect(falanteNoInstante(trechos, 8000)).toBe('paciente')
      expect(falanteNoInstante(trechos, 4400)).toBeNull()
      const mistura = Float32Array.from([...pcm.slice(0, 32000), ...pcm.slice(7 * 16000)])
      const misturados = await atribuirVozes(mistura, 0, 1500, extrator, locutores)
      expect(misturados.every(trecho => trecho.falante === null)).toBe(true)
      expect(await extrator.segmentar(new Float32Array())).toEqual([])
    } finally { locutores.limpar(); await extrator.encerrar() }
  }, 60_000)

})
