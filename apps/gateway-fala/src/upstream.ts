import WebSocket from 'ws'

export interface PalavraUpstream {
  texto: string
  inicioS: number
  fimS: number
}

// NeMo-Speech 0.2.0: o parcial chega como pedaços de texto da frase em curso (`delta`), sem tempos; a frase final traz só as
// suas palavras, com tempos. O gateway acumula os pedaços para mandar ao app o texto inteiro da frase em curso.
export type MensagemUpstream =
  | { tipo: 'parcial'; texto: string; processadoS: number }
  | { tipo: 'final'; palavras: PalavraUpstream[]; processadoS: number }
  | { tipo: 'confirmado' }

export interface Upstream {
  enviar(pcm: Int16Array): void
  confirmar(): void
  fechar(): void
}

export type AbrirUpstream = (idioma: string, aoMensagem: (mensagem: MensagemUpstream) => void, aoFechar: (erro: Error) => void) => Promise<Upstream>

export interface ConfigUpstream {
  url: string
  chave?: string
  endpointingMs: number
  aberturaMs: number
}

const DELTA = 'conversation.item.input_audio_transcription.delta'
const FINAL = 'conversation.item.input_audio_transcription.completed'

function palavraValida(palavra: unknown): palavra is { word: string; start: number; end: number } {
  return typeof palavra === 'object' && palavra !== null && 'word' in palavra && typeof palavra.word === 'string' &&
    'start' in palavra && Number.isFinite(palavra.start) && 'end' in palavra && Number.isFinite(palavra.end)
}

function criarTradutor() {
  let frase = ''
  return (evento: Record<string, unknown>): MensagemUpstream | undefined => {
    if (evento.type === 'input_audio_buffer.committed') return { tipo: 'confirmado' }
    const processadoS = typeof evento.audio_processed === 'number' ? evento.audio_processed : 0
    if (evento.type === DELTA && typeof evento.delta === 'string') {
      frase += evento.delta
      return { tipo: 'parcial', texto: frase.trim(), processadoS }
    }
    if (evento.type !== FINAL || !Array.isArray(evento.words) || !evento.words.every(palavraValida)) return undefined
    frase = ''
    return { tipo: 'final', palavras: evento.words.map((palavra) => ({ texto: palavra.word, inicioS: palavra.start, fimS: palavra.end })), processadoS }
  }
}

// Uma sessão upstream é um WebSocket do NeMo-Speech sem separação de vozes: quem fala é decidido aqui, frase a frase.
export function criarAbridorUpstream(config: ConfigUpstream): AbrirUpstream {
  return (idioma, aoMensagem, aoFechar) => new Promise((pronto, falhou) => {
    const traduzir = criarTradutor()
    const socket = new WebSocket(config.url, { headers: config.chave ? { Authorization: `Bearer ${config.chave}` } : {} })
    let aberto = false
    let fechadoAqui = false
    const abertura = setTimeout(() => socket.terminate(), config.aberturaMs)
    const upstream: Upstream = {
      enviar: (pcm) => socket.send(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)),
      confirmar: () => socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' })),
      fechar: () => { fechadoAqui = true; socket.close() },
    }
    socket.on('message', (dados) => {
      let evento: Record<string, unknown>
      try { evento = JSON.parse(String(dados)) as Record<string, unknown> } catch { return }
      if (evento.type === 'session.created' && !aberto) {
        aberto = true
        clearTimeout(abertura)
        socket.send(JSON.stringify({ type: 'session.update', session: { sample_rate: 16000, language: idioma,
          automatic_punctuation: true, word_timestamps: true, endpointing_ms: config.endpointingMs } }))
        pronto(upstream)
        return
      }
      if (evento.type === 'error') { socket.terminate(); return }
      const mensagem = traduzir(evento)
      if (mensagem) aoMensagem(mensagem)
    })
    socket.on('error', () => {})
    socket.on('close', () => {
      clearTimeout(abertura)
      const erro = new Error('A conexão com o serviço de transcrição foi encerrada.')
      if (!aberto) falhou(erro)
      else if (!fechadoAqui) aoFechar(erro)
    })
  })
}
