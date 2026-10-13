import { t } from '@lingui/core/macro'
import type { PalavraAtribuida } from '@limmiar/diarization'
import { MapaDeTempo } from './mapa-de-tempo'
import { PortaDeVoz } from './porta-de-voz'

export type AvisoTranscricao = 'reconectando' | 'atrasada'

export interface ResultadoTranscricao {
  palavras: PalavraAtribuida[]
  finais: number
  estavelAteMs: number
  aviso?: AvisoTranscricao
}

export interface SessaoServidor {
  enviar(pcm: Float32Array): void
  esvaziada(): Promise<void>
  concluir(): Promise<ResultadoTranscricao>
  descartar(): void
}

export type FalanteDaTrilha = 'profissional' | 'paciente'

// Presencial: o gateway reconhece o profissional pela impressão de voz (já decifrada aqui) e agrupa as outras vozes.
// Online: cada trilha WebRTC já é uma pessoa, e o gateway só carimba o falante.
export type Identidade = { modo: 'presencial'; perfil: readonly number[] } | { modo: 'online'; falante: FalanteDaTrilha }

export interface OpcoesTranscricao {
  identidade: Identidade
  aoResultado(resultado: ResultadoTranscricao): void
  falhar(erro: Error): void
}

interface PalavraDoGateway { texto: string; inicio_ms: number; fim_ms: number }
interface EventoDoGateway {
  type?: string
  palavras?: unknown
  texto?: unknown
  frase?: unknown
  falante?: unknown
  processado_ms?: unknown
  mensagem?: unknown
}

const ROTA = '/v1/fala'
const ATRASO_MS = 2000
// PCM16 a 16 kHz: 32 bytes por ms.
const ATRASO_BYTES = ATRASO_MS * 32
const ESPERAS_DE_RECONEXAO_MS = [0, 1000, 2000, 4000, 8000]
const ABERTURA_MS = 10_000
// O servidor pode estar atrasado em relação ao áudio, mas manda eventos enquanto trabalha: silêncio total é falha.
const SILENCIO_MS = 30_000

// Constante de build, como VITE_COPILOTO_BASE_URL: `pnpm dev` proxia /speech, um build hospedado nomeia a origem do gateway.
function endereco(): string {
  const base = (import.meta.env.VITE_SPEECH_BASE_URL ?? '/speech').replace(/\/+$/, '')
  return new URL(base + ROTA, location.href).href.replace(/^http/, 'ws')
}

const paraPcm16 = (pcm: Float32Array) => Int16Array.from(pcm, (amostra) => Math.round(Math.max(-1, Math.min(1, amostra)) * 32767))

function palavrasValidas(palavras: unknown): palavras is PalavraDoGateway[] {
  return Array.isArray(palavras) && palavras.every((palavra: unknown) => typeof palavra === 'object' && palavra !== null &&
    'texto' in palavra && typeof palavra.texto === 'string' && 'inicio_ms' in palavra && Number.isFinite(palavra.inicio_ms) &&
    'fim_ms' in palavra && Number.isFinite(palavra.fim_ms))
}

interface Conclusao { promessa: Promise<ResultadoTranscricao>; resolver(resultado: ResultadoTranscricao): void; rejeitar(erro: Error): void }

class Transcricao implements SessaoServidor {
  private socket!: WebSocket
  private situacao: 'abrindo' | 'aberta' | 'reconectando' | 'encerrada' = 'abrindo'
  // Os tempos do gateway contam só o áudio que ele recebeu desde que o socket abriu: sem silêncio e sem a captura da queda.
  private mapa = new MapaDeTempo()
  private readonly porta = new PortaDeVoz()
  private tentativa = 0
  private atrasada = false
  private servidorAtrasado = false
  private fila: { pcm: Int16Array<ArrayBuffer>; inicio: number }[] = []
  // As finais só crescem (inclusive depois de uma queda); a hipótese em curso é substituída a cada parcial.
  private finais: PalavraAtribuida[] = []
  private hipotese: PalavraAtribuida[] = []
  // Onde cada frase do gateway começou e acabou em `finais`, para corrigir o falante de uma frase curta. Vale por socket.
  private frases = new Map<number, [number, number]>()
  private conclusao: Conclusao | undefined
  private concluirAoAbrir = false
  private erro: Error | undefined
  private abertura: ReturnType<typeof setTimeout> | undefined
  private espera: ReturnType<typeof setTimeout> | undefined
  private silencio: ReturnType<typeof setTimeout> | undefined
  private pronta!: (sessao: SessaoServidor) => void
  private recusada!: (erro: Error) => void
  private readonly opcoes: OpcoesTranscricao

  constructor(opcoes: OpcoesTranscricao) { this.opcoes = opcoes }

  abrir(): Promise<SessaoServidor> {
    return new Promise((pronta, recusada) => {
      this.pronta = pronta
      this.recusada = recusada
      this.conectar()
    })
  }

  enviar(pcm: Float32Array): void {
    for (const { pcm: voz, inicio } of this.porta.passar(pcm)) {
      if (this.situacao === 'aberta') {
        this.mandar(paraPcm16(voz), inicio)
        const atrasada = this.socket.bufferedAmount > ATRASO_BYTES
        if (atrasada !== this.atrasada) { this.atrasada = atrasada; this.emitir() }
      } else if (this.situacao === 'reconectando') this.fila.push({ pcm: paraPcm16(voz), inicio })
    }
  }

  esvaziada(): Promise<void> {
    return new Promise((resolver) => {
      const verificar = () => {
        if (this.situacao === 'encerrada' || (this.situacao === 'aberta' && this.socket.bufferedAmount <= ATRASO_BYTES)) resolver()
        else setTimeout(verificar, 25)
      }
      verificar()
    })
  }

  concluir(): Promise<ResultadoTranscricao> {
    if (this.conclusao) return this.conclusao.promessa
    if (this.situacao === 'encerrada') return Promise.reject(this.erro ?? new DOMException('Cancelado', 'AbortError'))
    let resolver!: Conclusao['resolver']
    let rejeitar!: Conclusao['rejeitar']
    const promessa = new Promise<ResultadoTranscricao>((resolve, reject) => { resolver = resolve; rejeitar = reject })
    this.conclusao = { promessa, resolver, rejeitar }
    if (this.situacao === 'aberta') this.enviarConclusao()
    else this.concluirAoAbrir = true
    return promessa
  }

  descartar(): void {
    if (this.situacao === 'encerrada') return
    this.fechar()
    this.conclusao?.rejeitar(new DOMException('Cancelado', 'AbortError'))
  }

  private conectar(): void {
    const socket = new WebSocket(endereco())
    this.socket = socket
    this.abertura = setTimeout(() => socket.close(), ABERTURA_MS)
    socket.onopen = () => {
      const { identidade } = this.opcoes
      socket.send(JSON.stringify({ type: 'iniciar', sample_rate: 16000, idioma: 'pt', modo: identidade.modo,
        ...(identidade.modo === 'presencial' ? { perfil: identidade.perfil } : { falante: identidade.falante }) }))
    }
    socket.onmessage = ({ data }) => { if (socket === this.socket) this.tratar(data) }
    socket.onclose = () => { if (socket === this.socket) this.aoFechar() }
  }

  private tratar(dados: unknown): void {
    let evento: EventoDoGateway | null
    try { evento = JSON.parse(String(dados)) as EventoDoGateway | null } catch { return }
    switch (evento?.type) {
      case 'pronta': this.aoPreparar(); break
      case 'parcial': this.aplicarParcial(evento); break
      case 'final': this.aplicarFinal(evento); break
      case 'falante': this.corrigirFalante(evento); break
      case 'concluida': this.aoConfirmar(); break
      case 'erro': {
        const detalhe = String(evento.mensagem ?? t`sem detalhe`)
        this.falhar(new Error(t`O serviço de transcrição falhou: ${detalhe}`))
        break
      }
    }
    if (this.conclusao && this.situacao === 'aberta') this.armarSilencio()
  }

  private aoPreparar(): void {
    if (this.situacao !== 'abrindo' && this.situacao !== 'reconectando') return
    clearTimeout(this.abertura)
    const reabertura = this.situacao === 'reconectando'
    this.mapa = new MapaDeTempo()
    this.frases = new Map()
    this.tentativa = 0
    this.situacao = 'aberta'
    this.fila.forEach(({ pcm, inicio }) => this.mandar(pcm, inicio))
    this.fila = []
    if (this.concluirAoAbrir) this.enviarConclusao()
    if (reabertura) this.emitir()
    else this.pronta(this)
  }

  private palavra({ texto, inicio_ms, fim_ms }: PalavraDoGateway, locutor: string | null): PalavraAtribuida {
    return { texto, inicioMs: this.mapa.paraRealMs(inicio_ms), fimMs: this.mapa.paraRealMs(fim_ms, true), locutor }
  }

  private aplicarProcessado({ processado_ms: processado }: EventoDoGateway): void {
    // O gateway lê o socket sem atraso mesmo quando o modelo não acompanha: o atraso real é o áudio que ele já processou.
    if (typeof processado === 'number') this.servidorAtrasado = this.mapa.enviadoMs - processado > ATRASO_MS
  }

  private aplicarParcial(evento: EventoDoGateway): void {
    const { texto, processado_ms: processado } = evento
    if (typeof texto !== 'string' || typeof processado !== 'number') return
    // O parcial é o texto da frase em curso, ainda sem tempos: entra como um trecho só, no instante já processado.
    this.hipotese = texto === '' ? [] : [this.palavra({ texto, inicio_ms: processado, fim_ms: processado }, null)]
    this.aplicarProcessado(evento)
    this.emitir()
  }

  private aplicarFinal(evento: EventoDoGateway): void {
    const { palavras, frase, falante } = evento
    if (!palavrasValidas(palavras) || !Number.isInteger(frase) || (falante !== null && typeof falante !== 'string')) return
    this.frases.set(frase as number, [this.finais.length, this.finais.length + palavras.length])
    this.finais.push(...palavras.map((palavra) => this.palavra(palavra, falante)))
    this.hipotese = []
    this.aplicarProcessado(evento)
    this.emitir()
  }

  private corrigirFalante({ frase, falante }: EventoDoGateway): void {
    const trecho = this.frases.get(frase as number)
    if (!trecho || typeof falante !== 'string') return
    for (let i = trecho[0]; i < trecho[1]; i++) this.finais[i] = { ...this.finais[i]!, locutor: falante }
    this.emitir()
  }

  private aoConfirmar(): void {
    if (!this.conclusao) return
    this.atrasada = false
    this.servidorAtrasado = false
    this.hipotese = []
    const resultado = this.resultado()
    this.fechar()
    this.conclusao.resolver(resultado)
  }

  private aoFechar(): void {
    clearTimeout(this.abertura)
    clearTimeout(this.silencio)
    if (this.situacao === 'abrindo') { this.falhar(new Error(t`Não foi possível conectar ao serviço de transcrição.`)); return }
    if (this.situacao === 'aberta') {
      // Só as palavras finais sobrevivem à queda; a hipótese em curso morre com o socket.
      this.situacao = 'reconectando'
      this.hipotese = []
      this.atrasada = false
      this.servidorAtrasado = false
      this.concluirAoAbrir = this.conclusao !== undefined
      this.emitir()
    }
    if (this.tentativa === ESPERAS_DE_RECONEXAO_MS.length) { this.falhar(new Error(t`A conexão com a transcrição foi perdida.`)); return }
    this.espera = setTimeout(() => this.conectar(), ESPERAS_DE_RECONEXAO_MS[this.tentativa++])
  }

  private falhar(erro: Error): void {
    const abrindo = this.situacao === 'abrindo'
    this.fechar()
    this.erro = erro
    this.conclusao?.rejeitar(erro)
    if (abrindo) this.recusada(erro)
    else this.opcoes.falhar(erro)
  }

  private fechar(): void {
    this.situacao = 'encerrada'
    clearTimeout(this.abertura)
    clearTimeout(this.espera)
    clearTimeout(this.silencio)
    this.fila = []
    this.socket.onopen = null
    this.socket.onmessage = null
    this.socket.onclose = null
    this.socket.close()
  }

  private mandar(pcm: Int16Array<ArrayBuffer>, inicio: number): void {
    this.mapa.registrar(inicio, pcm.length)
    this.socket.send(pcm)
  }

  private enviarConclusao(): void {
    this.socket.send(JSON.stringify({ type: 'concluir' }))
    this.armarSilencio()
  }

  private armarSilencio(): void {
    clearTimeout(this.silencio)
    this.silencio = setTimeout(() => this.falhar(new Error(t`O serviço de transcrição parou de responder.`)), SILENCIO_MS)
  }

  private emitir(): void { this.opcoes.aoResultado(this.resultado()) }

  private resultado(): ResultadoTranscricao {
    const palavras = [...this.finais, ...this.hipotese]
    // Cada frase final já chega com o falante resolvido: nada mais vai mudar o texto ou o falante antes do fim das finais.
    const estavelAteMs = this.finais.length === 0 ? 0 : this.finais.at(-1)!.fimMs + 1
    const aviso = this.situacao === 'reconectando' ? 'reconectando' : this.atrasada || this.servidorAtrasado ? 'atrasada' : undefined
    return { palavras, finais: this.finais.length, estavelAteMs, ...(aviso && { aviso }) }
  }
}

export function abrirTranscricao(opcoes: OpcoesTranscricao): Promise<SessaoServidor> {
  return new Transcricao(opcoes).abrir()
}
