import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'
import { criarAbridorUpstream, type MensagemUpstream } from './upstream.ts'
import { esperar } from './test-support/falsos.ts'

const ABERTURA = 300
let servidores: WebSocketServer[] = []

interface Ouvido { cabecalhos: Record<string, string | string[] | undefined>; textos: unknown[]; binarios: Buffer[]; ws?: WebSocket }

async function subir(aoConectar: (ws: WebSocket, ouvido: Ouvido) => void) {
  const ouvido: Ouvido = { cabecalhos: {}, textos: [], binarios: [] }
  const servidor = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  servidores.push(servidor)
  await new Promise((resolver) => servidor.once('listening', resolver))
  servidor.on('connection', (ws, requisicao) => {
    ouvido.cabecalhos = requisicao.headers
    ouvido.ws = ws
    ws.on('message', (dados, binario) => { if (binario) ouvido.binarios.push(dados as Buffer); else ouvido.textos.push(JSON.parse(String(dados))) })
    aoConectar(ws, ouvido)
  })
  const url = `ws://127.0.0.1:${(servidor.address() as AddressInfo).port}/v1/audio/transcriptions/realtime`
  return { url, ouvido }
}

const criado = (ws: WebSocket) => ws.send(JSON.stringify({ type: 'session.created' }))
const PARCIAL = 'conversation.item.input_audio_transcription.delta'
const FINAL = 'conversation.item.input_audio_transcription.completed'

afterEach(async () => {
  await Promise.all(servidores.map((servidor) => new Promise((resolver) => { servidor.clients.forEach((ws) => ws.terminate()); servidor.close(resolver) })))
  servidores = []
})

describe('criarAbridorUpstream', () => {
  it('abre a sessão, configura sem separação de vozes e usa o idioma pedido', async () => {
    const { url, ouvido } = await subir(criado)
    const upstream = await criarAbridorUpstream({ url, endpointingMs: 600, aberturaMs: ABERTURA })('pt-BR', () => {}, () => {})
    await vi.waitFor(() => expect(ouvido.textos).toHaveLength(1))
    expect(ouvido.textos).toEqual([{ type: 'session.update', session: { sample_rate: 16000, language: 'pt-BR',
      automatic_punctuation: true, word_timestamps: true, endpointing_ms: 600 } }])
    expect(JSON.stringify(ouvido.textos)).not.toContain('diariz')
    upstream.fechar()
  })

  it('manda a chave de API do NeMo-Speech, e só quando existe', async () => {
    const com = await subir(criado)
    const upstreamCom = await criarAbridorUpstream({ url: com.url, chave: 'segredo', endpointingMs: 600, aberturaMs: ABERTURA })('pt', () => {}, () => {})
    expect(com.ouvido.cabecalhos.authorization).toBe('Bearer segredo')
    const sem = await subir(criado)
    const upstreamSem = await criarAbridorUpstream({ url: sem.url, endpointingMs: 600, aberturaMs: ABERTURA })('pt', () => {}, () => {})
    expect(sem.ouvido.cabecalhos.authorization).toBeUndefined()
    upstreamCom.fechar()
    upstreamSem.fechar()
  })

  it('envia o PCM como binário, sem copiar além dos bytes do trecho, e o commit como JSON', async () => {
    const { url, ouvido } = await subir(criado)
    const upstream = await criarAbridorUpstream({ url, endpointingMs: 600, aberturaMs: ABERTURA })('pt', () => {}, () => {})
    upstream.enviar(Int16Array.from([1, -2, 3]).subarray(1))
    upstream.confirmar()
    await vi.waitFor(() => expect(ouvido.textos).toHaveLength(2))
    expect([...new Int16Array(ouvido.binarios[0]!.buffer, ouvido.binarios[0]!.byteOffset, 2)]).toEqual([-2, 3])
    expect(ouvido.textos[1]).toEqual({ type: 'input_audio_buffer.commit' })
    upstream.fechar()
  })

  it('acumula os pedaços da frase em curso e entrega a frase final com as palavras e os tempos', async () => {
    const { url, ouvido } = await subir(criado)
    const recebidas: MensagemUpstream[] = []
    const upstream = await criarAbridorUpstream({ url, endpointingMs: 600, aberturaMs: ABERTURA })('pt', (m) => recebidas.push(m), () => {})
    const ws = ouvido.ws!
    const evento = (corpo: object) => ws.send(JSON.stringify(corpo))
    evento({ type: PARCIAL, delta: 'Bom', audio_processed: 0.88 })
    evento({ type: PARCIAL, delta: ' di' })
    evento({ type: FINAL, transcript: 'Bom dia', audio_processed: 1.5, words: [{ word: 'Bom', start: 0.64, end: 0.72, confidence: 1 }, { word: 'dia', start: 0.9, end: 1.1 }] })
    evento({ type: PARCIAL, delta: ' Eu' })
    evento({ type: 'input_audio_buffer.committed' })
    await vi.waitFor(() => expect(recebidas).toHaveLength(5))
    expect(recebidas).toEqual([
      { tipo: 'parcial', texto: 'Bom', processadoS: 0.88 },
      { tipo: 'parcial', texto: 'Bom di', processadoS: 0 },
      { tipo: 'final', processadoS: 1.5, palavras: [{ texto: 'Bom', inicioS: 0.64, fimS: 0.72 }, { texto: 'dia', inicioS: 0.9, fimS: 1.1 }] },
      { tipo: 'parcial', texto: 'Eu', processadoS: 0 },
      { tipo: 'confirmado' },
    ])
    upstream.fechar()
  })

  it('ignora o que não entende: JSON inválido, eventos de outro tipo, parcial sem texto, palavras malformadas', async () => {
    const { url, ouvido } = await subir(criado)
    const recebidas: MensagemUpstream[] = []
    const upstream = await criarAbridorUpstream({ url, endpointingMs: 600, aberturaMs: ABERTURA })('pt', (m) => recebidas.push(m), () => {})
    const ws = ouvido.ws!
    const evento = (corpo: object) => ws.send(JSON.stringify(corpo))
    ws.send('isto não é json')
    evento({ type: 'session.updated' })
    evento({ type: 'session.created' })
    evento({ type: PARCIAL, delta: 3 })
    evento({ type: FINAL, words: 'não é lista' })
    evento({ type: FINAL, words: [{ word: 5, start: 0, end: 1 }] })
    evento({ type: FINAL, words: [null] })
    evento({ type: FINAL, words: [{ word: 'a', start: 'x', end: 1 }] })
    evento({ type: FINAL, words: [{ word: 'a', start: 0, end: null }] })
    evento({ type: FINAL, words: [] })
    await vi.waitFor(() => expect(recebidas).toHaveLength(1))
    expect(recebidas[0]).toEqual({ tipo: 'final', palavras: [], processadoS: 0 })
    expect(ouvido.textos).toHaveLength(1)
    upstream.fechar()
  })

  it('avisa quando o servidor fecha depois de aberto, mas não quando quem fecha é o gateway', async () => {
    const { url, ouvido } = await subir(criado)
    const aoFechar = vi.fn()
    const upstream = await criarAbridorUpstream({ url, endpointingMs: 600, aberturaMs: ABERTURA })('pt', () => {}, aoFechar)
    ouvido.ws!.close()
    await vi.waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1))
    expect(aoFechar.mock.calls[0]![0]).toBeInstanceOf(Error)

    const outra = await subir(criado)
    const aoFecharOutra = vi.fn()
    const segunda = await criarAbridorUpstream({ url: outra.url, endpointingMs: 600, aberturaMs: ABERTURA })('pt', () => {}, aoFecharOutra)
    segunda.fechar()
    await esperar()
    await vi.waitFor(() => expect(outra.ouvido.ws!.readyState).toBe(3))
    expect(aoFecharOutra).not.toHaveBeenCalled()
    upstream.fechar()
  })

  it('trata um evento de erro do servidor como queda', async () => {
    const { url, ouvido } = await subir(criado)
    const aoFechar = vi.fn()
    await criarAbridorUpstream({ url, endpointingMs: 600, aberturaMs: ABERTURA })('pt', () => {}, aoFechar)
    ouvido.ws!.send(JSON.stringify({ type: 'error', error: { message: 'x' } }))
    await vi.waitFor(() => expect(aoFechar).toHaveBeenCalledTimes(1))
  })

  it('falha ao abrir se o servidor fecha antes do session.created, demora demais ou não existe', async () => {
    const fecha = await subir((ws) => ws.close())
    await expect(criarAbridorUpstream({ url: fecha.url, endpointingMs: 600, aberturaMs: ABERTURA })('pt', () => {}, () => {})).rejects.toThrow(/encerrada/)
    const mudo = await subir(() => {})
    await expect(criarAbridorUpstream({ url: mudo.url, endpointingMs: 600, aberturaMs: 50 })('pt', () => {}, () => {})).rejects.toThrow(/encerrada/)
    const ausente = await subir(() => {})
    await Promise.all(servidores.map((servidor) => new Promise((resolver) => { servidor.clients.forEach((ws) => ws.terminate()); servidor.close(resolver) })))
    servidores = []
    await expect(criarAbridorUpstream({ url: ausente.url, endpointingMs: 600, aberturaMs: ABERTURA })('pt', () => {}, () => {})).rejects.toThrow(/encerrada/)
  })
})
