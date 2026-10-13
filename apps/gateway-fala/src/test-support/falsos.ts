import type { Extrator } from '../extrator.ts'
import type { Inicio, Saida } from '../protocolo.ts'
import type { Canal, ParametrosSessao } from '../sessao.ts'
import type { AbrirUpstream, MensagemUpstream, Upstream } from '../upstream.ts'

export const esperar = () => new Promise<void>((resolver) => setImmediate(resolver))

// Parâmetros pequenos para os testes andarem em segundos de áudio, não em minutos.
export const PARAMETROS: ParametrosSessao = {
  bufferMs: 10_000, rotacaoMs: 1000, rotacaoForcadaMs: 3000, fraseMinimaMs: 500, vozMaximaMs: 1500,
  margemAntesMs: 100, margemDepoisMs: 200, repeticaoMs: 500,
}

// Duas "vozes" distinguíveis: o PCM de teste é uma constante, e a constante escolhe o vetor.
export const VOZ_A = Array.from({ length: 8 }, (_, i) => (i === 0 ? 1 : 0))
export const VOZ_B = Array.from({ length: 8 }, (_, i) => (i === 1 ? 1 : 0))
export const VOZ_C = Array.from({ length: 8 }, (_, i) => (i === 2 ? 1 : 0))
export const AMPLITUDE = { A: 1000, B: 2000, C: 3000 } as const
const VETOR: Record<number, number[]> = { 1000: VOZ_A, 2000: VOZ_B, 3000: VOZ_C }

export const INICIO_PRESENCIAL: Inicio = { modo: 'presencial', idioma: 'pt', perfil: VOZ_A }

export function pcmConstante(ms: number, amplitude: number): Int16Array {
  return new Int16Array(ms * 16).fill(amplitude)
}

export class ExtratorFalso implements Extrator {
  readonly dimensao = 8
  chamadas: number[] = []
  retorno: ((pcm: Float32Array) => Promise<Float32Array | null>) | undefined

  embutir(pcm: Float32Array): Promise<Float32Array | null> {
    this.chamadas.push(pcm.length)
    if (this.retorno) return this.retorno(pcm)
    return Promise.resolve(Float32Array.from(VETOR[Math.round(pcm[pcm.length >> 1]! * 32768)]!))
  }

  encerrar(): Promise<void> { return Promise.resolve() }
}

export class UpstreamFalso implements Upstream {
  enviados: Int16Array[] = []
  confirmacoes = 0
  fechado = false
  autoConfirmar = true
  readonly aoMensagem: (mensagem: MensagemUpstream) => void
  readonly aoFechar: (erro: Error) => void
  readonly idioma: string

  constructor(idioma: string, aoMensagem: (mensagem: MensagemUpstream) => void, aoFechar: (erro: Error) => void) {
    this.idioma = idioma
    this.aoMensagem = aoMensagem
    this.aoFechar = aoFechar
  }

  get amostras(): number { return this.enviados.reduce((total, pcm) => total + pcm.length, 0) }
  enviar(pcm: Int16Array): void { this.enviados.push(pcm) }
  confirmar(): void {
    this.confirmacoes++
    if (this.autoConfirmar) queueMicrotask(() => this.aoMensagem({ tipo: 'confirmado' }))
  }
  fechar(): void { this.fechado = true }
  private finaisEnviadas = 0
  // O NeMo-Speech fecha a sessão com uma frase final vazia.
  finalVazio(): void { this.aoMensagem({ tipo: 'final', palavras: [], processadoS: 0 }) }
  // Os testes descrevem o estado acumulado (todas as palavras, quantas são finais); o falso o traduz como o NeMo-Speech
  // 0.2.0 manda: uma frase final só com as palavras novas e, depois, o texto da frase em curso.
  palavras(palavras: [string, number, number][], finais: number, processadoS = 0, cauda = ''): void {
    const novas = palavras.slice(this.finaisEnviadas, finais)
    if (novas.length > 0) {
      this.finaisEnviadas = finais
      this.aoMensagem({ tipo: 'final', palavras: novas.map(([texto, inicioS, fimS]) => ({ texto, inicioS, fimS })), processadoS })
    }
    const texto = [...palavras.slice(finais).map(([palavra]) => palavra), cauda].filter(Boolean).join(' ')
    this.aoMensagem({ tipo: 'parcial', texto, processadoS })
  }
}

export class AbridorFalso {
  abertos: UpstreamFalso[] = []
  falhaNaProxima: Error | undefined
  // Segura a próxima abertura até esta promessa resolver.
  seguraProxima: Promise<void> | undefined
  readonly abrir: AbrirUpstream = async (idioma, aoMensagem, aoFechar) => {
    if (this.falhaNaProxima) throw this.falhaNaProxima
    const espera = this.seguraProxima
    this.seguraProxima = undefined
    await espera
    const upstream = new UpstreamFalso(idioma, aoMensagem, aoFechar)
    this.abertos.push(upstream)
    return upstream
  }
}

export class CanalFalso implements Canal {
  saidas: Saida[] = []
  codigos: number[] = []
  cheio = false
  enviar(saida: Saida): void { this.saidas.push(saida) }
  ocupado(): boolean { return this.cheio }
  fechar(codigo: number): void { this.codigos.push(codigo) }
  de<T extends Saida['type']>(tipo: T): Extract<Saida, { type: T }>[] {
    return this.saidas.filter((saida): saida is Extract<Saida, { type: T }> => saida.type === tipo)
  }
}

export function adiado<T>() {
  let resolver!: (valor: T) => void
  let rejeitar!: (erro: unknown) => void
  const promessa = new Promise<T>((resolve, reject) => { resolver = resolve; rejeitar = reject })
  return { promessa, resolver, rejeitar }
}
