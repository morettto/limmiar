import { atribuirVozes, falanteNoInstante } from './atribuicao.ts'
import { BufferPcm } from './buffer-pcm.ts'
import type { Extrator } from './extrator.ts'
import { Locutores } from './locutores.ts'
import { AMOSTRAS_POR_MS, type Inicio, type Palavra, type Saida } from './protocolo.ts'
import type { AbrirUpstream, MensagemUpstream, PalavraUpstream, Upstream } from './upstream.ts'

export interface ParametrosSessao {
  // Quanto áudio fica na memória para recortar a frase; o resto é esquecido.
  bufferMs: number
  // Pausa em que a sessão upstream é reiniciada para limitar o que o servidor acumula, e o teto em que reinicia mesmo sem pausa.
  rotacaoMs: number
  rotacaoForcadaMs: number
  // A impressão de voz usa amostras independentes; respostas curtas aguardam contexto acústico.
  fraseMinimaMs: number
  vozMaximaMs: number
  // O fim de uma palavra do reconhecedor costuma sair antes do fim da fala.
  margemDepoisMs: number
  // Sem mudança de texto, um parcial só repete o `processado_ms` a cada tanto, para o app medir o atraso.
  repeticaoMs: number
}

export const PARAMETROS_PADRAO: ParametrosSessao = {
  bufferMs: 30_000, rotacaoMs: 120_000, rotacaoForcadaMs: 145_000, fraseMinimaMs: 1500, vozMaximaMs: 10_000,
  margemDepoisMs: 200, repeticaoMs: 500,
}

export interface Canal {
  enviar(saida: Saida): void
  // O navegador não acompanha: parciais antigos não valem a pena.
  ocupado(): boolean
  fechar(codigo: number): void
}

export interface Dependencias {
  abrirUpstream: AbrirUpstream
  extrator: Extrator
  parametros?: ParametrosSessao
  registrar?(evento: string): void
}

type MensagemEnfileirada = { ordem: number; mensagem: Exclude<MensagemUpstream, { tipo: 'parcial' }> }

const NORMAL = 1000
const FALHA = 1011

// Uma sessão de fala: recebe o PCM do navegador, repassa ao NeMo-Speech e devolve só o que é novo, com o falante de cada
// frase já resolvido. O PCM, a impressão de voz e as vozes agrupadas existem só aqui, na memória, até `encerrar`.
export class Sessao {
  private readonly inicio: Inicio
  private readonly canal: Canal
  private readonly deps: Dependencias
  private readonly parametros: ParametrosSessao
  private readonly buffer: BufferPcm
  private readonly locutores: Locutores | undefined
  private pendentes: { frase: number; instanteMs: number }[] = []
  private upstream: Upstream | undefined
  private deslocamentoMs = 0
  private amostrasNoUpstream = 0
  private proximaFrase = 0
  private fila: Int16Array[] = []
  private mensagens: MensagemEnfileirada[] = []
  private drenando = false
  private rotacionando = false
  private rotacao: Promise<void> | undefined
  private concluindo = false
  private encerrada = false
  private confirmacao: (() => void) | undefined
  private chaveParcial = ''
  private processadoEnviadoMs = 0
  private proximaOrdem = 0
  private ordemParcialEnviado = -1
  // Palavras das finais já recebidas e ainda não mandadas: o parcial as leva à frente da frase em curso, senão o app, que
  // troca a hipótese inteira a cada parcial, perderia a frase da tela enquanto ela espera a verificação.
  private palavrasEmEspera: string[] = []
  private parcialUpstream = { texto: '', processadoMs: 0 }

  constructor(inicio: Inicio, canal: Canal, deps: Dependencias) {
    this.inicio = inicio
    this.canal = canal
    this.deps = deps
    this.parametros = deps.parametros ?? PARAMETROS_PADRAO
    this.buffer = new BufferPcm(Math.round(this.parametros.bufferMs * AMOSTRAS_POR_MS))
    this.locutores = inicio.modo === 'presencial' ? new Locutores(inicio.perfil) : undefined
  }

  async abrir(): Promise<void> {
    const upstream = await this.abrirUpstream()
    if (this.encerrada) { upstream.fechar(); return }
    this.upstream = upstream
    this.canal.enviar({ type: 'pronta' })
  }

  pcm(amostras: Int16Array): void {
    if (this.encerrada || this.concluindo) return
    this.buffer.escrever(amostras)
    if (this.upstream && !this.rotacionando) this.enviarAoUpstream(amostras)
    else this.fila.push(amostras)
  }

  async concluir(): Promise<void> {
    if (this.encerrada || this.concluindo) return
    this.concluindo = true
    try {
      await this.rotacao
      await this.confirmar()
      this.canal.enviar({ type: 'concluida' })
      this.encerrar()
      this.canal.fechar(NORMAL)
    } catch (erro) { this.falhar(erro) }
  }

  encerrar(): void {
    this.encerrada = true
    this.upstream?.fechar()
    this.upstream = undefined
    this.buffer.limpar()
    this.locutores?.limpar()
    this.pendentes = []
    this.fila = []
    this.mensagens = []
    this.palavrasEmEspera = []
  }

  private abrirUpstream(): Promise<Upstream> {
    return this.deps.abrirUpstream(this.inicio.idioma, (mensagem) => this.receber(mensagem), (erro) => this.falhar(erro))
  }

  private enviarAoUpstream(amostras: Int16Array): void {
    this.upstream!.enviar(amostras)
    this.amostrasNoUpstream += amostras.length
  }

  private confirmar(): Promise<void> {
    return new Promise((resolver) => {
      this.confirmacao = resolver
      this.upstream!.confirmar()
    })
  }

  private receber(mensagem: MensagemUpstream): void {
    if (this.encerrada) return
    const ordem = this.proximaOrdem++
    if (mensagem.tipo === 'parcial') {
      this.parcialUpstream = { texto: mensagem.texto, processadoMs: Math.round(this.deslocamentoMs + mensagem.processadoS * 1000) }
      this.enviarParcial(this.parcialUpstream.processadoMs, ordem)
      if (mensagem.texto === '' || this.amostrasNoUpstream / AMOSTRAS_POR_MS >= this.parametros.rotacaoForcadaMs) this.talvezRotacionar()
      return
    }
    if (mensagem.tipo === 'final') {
      this.parcialUpstream = { texto: '', processadoMs: Math.round(this.deslocamentoMs + mensagem.processadoS * 1000) }
      this.palavrasEmEspera.push(...mensagem.palavras.map((palavra) => palavra.texto))
      if (mensagem.palavras.length === 0) this.chaveParcial = ''
    }
    this.mensagens.push({ mensagem, ordem })
    if (!this.drenando) void this.drenar()
  }

  // Finais e confirmações, uma por vez e na ordem: a frase seguinte espera a anterior ser verificada. Os parciais não esperam.
  private async drenar(): Promise<void> {
    this.drenando = true
    try {
      for (let envelope = this.mensagens.shift(); envelope && !this.encerrada; envelope = this.mensagens.shift()) {
        await this.tratar(envelope)
      }
    } catch (erro) { this.falhar(erro) } finally { this.drenando = false }
  }

  private async tratar({ mensagem, ordem }: MensagemEnfileirada): Promise<void> {
    if (mensagem.tipo === 'confirmado') {
      this.confirmacao?.()
      return
    }
    const processadoMs = Math.round(this.deslocamentoMs + mensagem.processadoS * 1000)
    if (mensagem.palavras.length > 0) await this.finalizar(mensagem.palavras, processadoMs, ordem)
    this.talvezRotacionar()
  }

  private async finalizar(novas: PalavraUpstream[], processadoMs: number, ordem: number): Promise<void> {
    const palavras = novas.map((palavra) => this.palavra(palavra))
    if (this.inicio.modo === 'online') {
      this.canal.enviar({ type: 'final', ordem, frase: this.proximaFrase++, falante: this.inicio.falante,
        palavras, processado_ms: processadoMs })
      this.aposFinal(palavras.length, processadoMs, ordem)
    } else {
      for (let posicao = 0; posicao < palavras.length;) {
        const primeira = palavras[posicao]!
        const tetoMs = primeira.inicio_ms + this.parametros.vozMaximaMs - this.parametros.margemDepoisMs
        let fim = posicao + 1
        while (fim < palavras.length && palavras[fim]!.fim_ms <= tetoMs) fim++
        const lote = palavras.slice(posicao, fim)
        const fimMs = Math.min(lote.at(-1)!.fim_ms + this.parametros.margemDepoisMs, tetoMs + this.parametros.margemDepoisMs)
        const inicioMs = Math.max(0, fimMs - this.parametros.vozMaximaMs,
          (this.buffer.recebidas / AMOSTRAS_POR_MS) - this.parametros.bufferMs)
        const pcm = this.buffer.recortar(inicioMs * AMOSTRAS_POR_MS, fimMs * AMOSTRAS_POR_MS)
        const trechos = await atribuirVozes(pcm, inicioMs, this.parametros.fraseMinimaMs, this.deps.extrator, this.locutores!)
        if (this.encerrada) return
        this.pendentes = this.pendentes.filter(pendente => {
          const falante = falanteNoInstante(trechos, pendente.instanteMs)
          if (falante !== null) this.canal.enviar({ type: 'falante', frase: pendente.frase, falante })
          return falante === null && pendente.instanteMs >= inicioMs
        })
        for (let i = 0; i < lote.length;) {
          const palavra = lote[i]!
          const instanteMs = (palavra.inicio_ms + palavra.fim_ms) / 2
          const falante = falanteNoInstante(trechos, instanteMs)
          let ate = i + 1
          while (falante !== null && ate < lote.length &&
            falanteNoInstante(trechos, (lote[ate]!.inicio_ms + lote[ate]!.fim_ms) / 2) === falante) ate++
          const frase = this.proximaFrase++
          this.canal.enviar({ type: 'final', ordem, frase, falante, palavras: lote.slice(i, ate), processado_ms: processadoMs })
          if (falante === null) this.pendentes.push({ frase, instanteMs })
          i = ate
        }
        this.aposFinal(lote.length, processadoMs, ordem)
        posicao = fim
      }
    }
  }

  // O app só limpa a hipótese com uma final mais nova que ela. Se o último parcial é mais novo, ele ainda mostra estas
  // palavras e a correção tem de sair, mesmo com o navegador ocupado, senão a frase aparece duas vezes.
  private aposFinal(emitidas: number, processadoMs: number, ordem: number): void {
    this.palavrasEmEspera.splice(0, emitidas)
    this.processadoEnviadoMs = Math.max(this.processadoEnviadoMs, processadoMs)
    if (this.ordemParcialEnviado > ordem) {
      this.mandarParcial(Math.max(this.processadoEnviadoMs, this.parcialUpstream.processadoMs), this.proximaOrdem++)
      return
    }
    this.chaveParcial = ''
    if (this.textoParcial() !== '') this.enviarParcial(this.processadoEnviadoMs, this.proximaOrdem++)
  }

  private textoParcial(): string {
    return [...this.palavrasEmEspera, this.parcialUpstream.texto].filter(Boolean).join(' ')
  }

  private enviarParcial(processadoMs: number, ordem: number): void {
    if (this.textoParcial() === this.chaveParcial && processadoMs - this.processadoEnviadoMs < this.parametros.repeticaoMs) return
    if (this.canal.ocupado()) return
    this.mandarParcial(processadoMs, ordem)
  }

  private mandarParcial(processadoMs: number, ordem: number): void {
    const texto = this.textoParcial()
    this.chaveParcial = texto
    this.processadoEnviadoMs = processadoMs
    this.ordemParcialEnviado = ordem
    this.canal.enviar({ type: 'parcial', ordem, texto, processado_ms: processadoMs })
  }

  private talvezRotacionar(): void {
    if (this.rotacionando || this.concluindo || this.amostrasNoUpstream / AMOSTRAS_POR_MS < this.parametros.rotacaoMs) return
    this.rotacionando = true
    this.rotacao = this.rotacionar()
  }

  // O NeMo-Speech acumula estado por sessão. Fechar a sessão numa pausa e abrir outra mantém o relógio: o deslocamento soma
  // o áudio já enviado, e o PCM que chega no meio espera na fila.
  private async rotacionar(): Promise<void> {
    try {
      await this.confirmar()
      this.upstream!.fechar()
      this.upstream = undefined
      this.deslocamentoMs += this.amostrasNoUpstream / AMOSTRAS_POR_MS
      this.amostrasNoUpstream = 0
      const novo = await this.abrirUpstream()
      if (this.encerrada) { novo.fechar(); return }
      this.upstream = novo
      for (const amostras of this.fila.splice(0)) this.enviarAoUpstream(amostras)
    } catch (erro) { this.falhar(erro) } finally { this.rotacionando = false }
  }

  private palavra(palavra: PalavraUpstream): Palavra {
    return { texto: palavra.texto, inicio_ms: Math.round(this.deslocamentoMs + palavra.inicioS * 1000), fim_ms: Math.round(this.deslocamentoMs + palavra.fimS * 1000) }
  }

  private falhar(causa: unknown): void {
    if (this.encerrada) return
    this.deps.registrar?.(`sessao.falha: ${causa instanceof Error ? causa.message : 'desconhecida'}`)
    this.canal.enviar({ type: 'erro', mensagem: 'O serviço de transcrição falhou.' })
    this.encerrar()
    this.canal.fechar(FALHA)
  }
}
