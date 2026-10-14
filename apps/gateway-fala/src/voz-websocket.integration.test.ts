import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import { describe, expect, it, vi } from 'vitest'
import { criarExtratorTitanet, type Extrator } from './extrator.ts'
import type { Saida } from './protocolo.ts'
import { criarServidor } from './servidor.ts'
import { criarTrabalhadorTitanet } from './trabalhador-titanet.ts'
import { AbridorFalso, adiado } from './test-support/falsos.ts'

const modelo = fileURLToPath(new URL('../../app/public/models/voice-identity/titanet.onnx', import.meta.url))
const modeloSegmentacao = fileURLToPath(new URL('../../../.local/diarization/sherpa-onnx-pyannote-segmentation-3-0/model.onnx', import.meta.url))
const perfil = JSON.parse(readFileSync(new URL('./fixtures/maria-3s.embedding-wasm.json', import.meta.url), 'utf8')) as number[]
const pcm = readFileSync(new URL('./fixtures/maria-zira-10s.pcm', import.meta.url))

async function conectar(adaptar: (extrator: Extrator) => Extrator = extrator => extrator) {
  const extrator = await criarExtratorTitanet({ modelo, modeloSegmentacao, threads: 2, aoQuebrar: erro => { throw erro } }, criarTrabalhadorTitanet)
  const abridor = new AbridorFalso()
  const registrar = vi.fn()
  const servidor = criarServidor({ extrator: adaptar(extrator), abrirUpstream: abridor.abrir, pingMs: 60_000, registrar })
  await new Promise<void>(resolve => servidor.http.listen(0, '127.0.0.1', resolve))
  const ws = new WebSocket(`ws://127.0.0.1:${(servidor.http.address() as AddressInfo).port}/v1/fala`)
  const mensagens: Saida[] = []
  ws.on('message', bytes => mensagens.push(JSON.parse(bytes.toString()) as Saida))
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  ws.send(JSON.stringify({ type: 'iniciar', modo: 'presencial', perfil, sample_rate: 16000, idioma: 'pt' }))
  await vi.waitFor(() => expect(mensagens).toEqual([{ type: 'pronta' }]))
  for (let posicao = 0; posicao < pcm.length; posicao += 16000) ws.send(pcm.subarray(posicao, posicao + 16000))
  await vi.waitFor(() => expect(abridor.abertos[0]!.amostras).toBe(160000))
  return { ws, mensagens, up: abridor.abertos[0]!, registrar,
    fechar: async () => { ws.terminate(); await servidor.fechar(); await extrator.encerrar() } }
}

// Só o ASR é simulado: rede, protocolo, sessão, segmentação e identidade usam o código/modelos reais.
describe.skipIf(!existsSync(modelo) || !existsSync(modeloSegmentacao))('voz pelo WebSocket com modelos nativos', () => {
  it('separa profissional, trecho curto incerto e paciente dentro da mesma frase, sem IDs extras', async () => {
    const ambiente = await conectar()
    try {
      ambiente.up.palavras([['Profissional sintético', 0.7, 1.5], ['Resposta breve', 4.2, 4.6], ['Paciente sintético', 7.5, 8.5]], 3, 10)
      await vi.waitFor(() => expect(ambiente.mensagens.filter(m => m.type === 'final')).toHaveLength(3), { timeout: 10_000 })
      const finais = ambiente.mensagens.filter(m => m.type === 'final')
      expect(finais.map(m => m.falante)).toEqual(['profissional', null, 'paciente'])
      expect(finais.flatMap(m => m.palavras).map(p => p.inicio_ms)).toEqual([700, 4200, 7500])
      expect(new Set(finais.map(m => m.frase)).size).toBe(3)
      ambiente.ws.send(JSON.stringify({ type: 'concluir' }))
      await vi.waitFor(() => expect(ambiente.mensagens.at(-1)).toEqual({ type: 'concluida' }))
      expect(ambiente.registrar.mock.calls.flat().join('')).not.toContain('sintético')
      expect(ambiente.up.fechado).toBe(true)
    } finally { await ambiente.fechar() }
  }, 60_000)

  it('fechar durante segmentação não publica resultados tardios', async () => {
    const espera = adiado<void>()
    const entrou = adiado<void>()
    const terminou = adiado<void>()
    const ambiente = await conectar(extrator => ({ ...extrator, segmentar: async audio => {
      entrou.resolver(); await espera.promessa
      try { return await extrator.segmentar(audio) } finally { terminou.resolver() }
    } }))
    try {
      ambiente.up.palavras([['Privado sintético', 0.7, 1.5]], 1, 2)
      await entrou.promessa
      const fechou = new Promise<void>(resolve => ambiente.ws.once('close', () => resolve()))
      ambiente.ws.close(); await fechou
      await vi.waitFor(() => expect(ambiente.up.fechado).toBe(true))
      espera.resolver(); await terminou.promessa
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(ambiente.mensagens).toEqual([{ type: 'pronta' }])
      expect(ambiente.registrar.mock.calls.flat().join('')).not.toContain('Privado')
    } finally { espera.resolver(); await ambiente.fechar() }
  }, 60_000)
})
