import type { Page, WebSocketRoute } from '@playwright/test'
import type { Atendimento } from './roteiro'

// FRONTEIRA SIMULADA: o gateway de fala (apps/gateway-fala, que fala com o NeMo-Speech e o TitaNet) não roda no E2E. O fake fala o
// protocolo do WebSocket /speech com as palavras e os falantes do roteiro; a captura, o PCM16 enviado e o perfil de voz cifrado
// (aberto no aparelho e mandado na abertura) são reais. O fake se alinha ao arquivo de áudio pelo tom de sincronismo.

const TAXA = 16000
const MARGEM_PALAVRA_S = 0.15
const ATRASO_FINAL_MS = 400

interface Palavra { texto: string; inicio_ms: number; fim_ms: number }
interface Enunciado { quem: 'profissional' | 'paciente'; texto: string; ouvido: string; inicioS: number; fimS: number }

function fracaoDoMarcador(bloco: Int16Array): number {
  const omega = 2 * Math.PI * 1000 / TAXA
  let real = 0
  let imaginario = 0
  let energia = 0
  for (let i = 0; i < bloco.length; i++) {
    const amostra = bloco[i]! / 32768
    real += amostra * Math.cos(omega * i)
    imaginario += amostra * Math.sin(omega * i)
    energia += amostra * amostra
  }
  return energia < 1e-3 ? 0 : (2 * (real * real + imaginario * imaginario)) / (bloco.length * energia)
}

function palavrasDe(enunciado: Enunciado, deslocamentoS: number): Palavra[] {
  const termos = enunciado.ouvido.split(/\s+/)
  const letras = termos.reduce((soma, termo) => soma + termo.length, 0)
  const largura = enunciado.fimS - enunciado.inicioS - 2 * MARGEM_PALAVRA_S
  let corrente = enunciado.inicioS + MARGEM_PALAVRA_S
  return termos.map((texto) => {
    const fim = corrente + largura * texto.length / letras
    const palavra = { texto, inicio_ms: Math.round((corrente - deslocamentoS) * 1000), fim_ms: Math.round((fim - deslocamentoS) * 1000) }
    corrente = fim
    return palavra
  })
}

class ServidorFalso {
  private recebidas = 0
  private deslocamentoS: number | null = null
  private frases: Palavra[][] = []
  private fins: [string, number][] = []
  private finalizadas = new Set<number>()
  private readonly ws: WebSocketRoute
  private readonly marcadorInicioS: number
  private readonly enunciados: Enunciado[]
  private readonly reveladas: Record<string, number>

  constructor(ws: WebSocketRoute, marcadorInicioS: number, enunciados: Enunciado[], reveladas: Record<string, number>) {
    this.ws = ws
    this.marcadorInicioS = marcadorInicioS
    this.enunciados = enunciados
    this.reveladas = reveladas
    ws.onMessage((mensagem) => {
      if (typeof mensagem === 'string') this.comando(JSON.parse(mensagem) as { type: string })
      else this.receber(new Int16Array(mensagem.buffer.slice(mensagem.byteOffset, mensagem.byteOffset + mensagem.length)))
    })
  }

  private receber(pcm: Int16Array): void {
    if (this.deslocamentoS === null && fracaoDoMarcador(pcm) > 0.5) {
      this.deslocamentoS = this.marcadorInicioS - this.recebidas / TAXA
      this.frases = this.enunciados.map((enunciado) => palavrasDe(enunciado, this.deslocamentoS!))
      this.fins = this.enunciados.map((enunciado) => [enunciado.texto, enunciado.fimS - MARGEM_PALAVRA_S - this.deslocamentoS!])
    }
    this.recebidas += pcm.length
    for (const [texto, fimS] of this.fins) if (fimS <= this.recebidas / TAXA && !(texto in this.reveladas)) this.reveladas[texto] = Date.now()
    this.estado(false)
  }

  private comando({ type }: { type: string }): void {
    if (type === 'iniciar') this.ws.send(JSON.stringify({ type: 'pronta' }))
    if (type !== 'concluir') return
    this.estado(true)
    this.ws.send(JSON.stringify({ type: 'concluida' }))
  }

  // Como o gateway: uma frase final por enunciado, depois da pausa, com o falante do roteiro; o que já foi ouvido e ainda não fechou
  // é a hipótese. Uma frase só sai quando todas as palavras dela foram ouvidas.
  private estado(concluido: boolean): void {
    const agoraMs = this.recebidas / 16
    const hipotese: Palavra[] = []
    this.frases.forEach((palavras, indice) => {
      if (this.finalizadas.has(indice)) return
      const ouvidas = palavras.filter((palavra) => palavra.fim_ms <= agoraMs)
      if (ouvidas.length === 0) return
      if (ouvidas.length === palavras.length && (concluido || palavras.at(-1)!.fim_ms <= agoraMs - ATRASO_FINAL_MS)) {
        this.finalizadas.add(indice)
        this.ws.send(JSON.stringify({ type: 'final', frase: indice, falante: this.enunciados[indice]!.quem, palavras, processado_ms: agoraMs }))
      } else hipotese.push(...ouvidas)
    })
    if (hipotese.length > 0 || !concluido) this.ws.send(JSON.stringify({ type: 'parcial', texto: hipotese.map((palavra) => palavra.texto).join(' '), processado_ms: agoraMs }))
  }
}

export interface AsrSimulado {
  /** Texto dito -> instante (Date.now) em que o fake terminou de receber o áudio da última palavra dele. */
  reveladas(): Promise<Record<string, number>>
  /** Quantas conexões de transcrição o app abriu. */
  sessoes(): Promise<number>
}

export async function simularAsr(page: Page, atendimento: Atendimento): Promise<AsrSimulado> {
  const enunciados: Enunciado[] = atendimento.enunciados.map(({ quem, texto, ouvido, inicioS, fimS }) => ({ quem, texto, ouvido, inicioS, fimS }))
  const reveladas: Record<string, number> = {}
  let sessoes = 0
  await page.routeWebSocket(/\/speech\/v1\/fala$/, (ws) => {
    sessoes++
    new ServidorFalso(ws, atendimento.marcadorInicioS, enunciados, reveladas)
  })
  return { reveladas: async () => reveladas, sessoes: async () => sessoes }
}
