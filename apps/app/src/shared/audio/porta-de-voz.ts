export interface Quadro {
  pcm: Float32Array
  // Amostras (16 kHz) desde o começo da captura.
  inicio: number
}

const AMOSTRAS_POR_MS = 16
// Dá ao reconhecedor o começo da frase, que a energia só confirma um quadro depois.
const PRE_ROLAGEM_MS = 300
// Mais que os 600 ms de silêncio com que o servidor fecha a frase.
const CAUDA_MS = 800
const JANELA_DO_PISO = 40
// Antes de ouvir o ambiente, vale um quarto silencioso; depois o piso é o quadro mais quieto da janela.
const PISO_INICIAL = 0.003
const PISO_MINIMO = 0.002
const FATOR_LIGAR = 3
const FATOR_DESLIGAR = 1.8

const rms = (pcm: Float32Array) => Math.sqrt(pcm.reduce((soma, valor) => soma + valor * valor, 0) / pcm.length)

// O servidor de transcrição processa silêncio mais devagar que o tempo real e acumula atraso: só a fala (com a pré-rolagem e a
// cauda que ele precisa para fechar a frase) vai para lá. Energia por quadro contra um piso de ruído adaptativo, com histerese.
export class PortaDeVoz {
  private posicao = 0
  private readonly recentes: number[] = new Array<number>(JANELA_DO_PISO).fill(PISO_INICIAL)
  private falando = false
  private silencioMs = 0
  private anteriores: Quadro[] = []

  passar(pcm: Float32Array): Quadro[] {
    const quadro = { pcm, inicio: this.posicao }
    this.posicao += pcm.length
    const duracaoMs = pcm.length / AMOSTRAS_POR_MS
    const energia = rms(pcm)
    this.recentes.shift()
    this.recentes.push(energia)
    const piso = Math.max(PISO_MINIMO, Math.min(...this.recentes))
    if (this.falando) {
      this.silencioMs = energia < piso * FATOR_DESLIGAR ? this.silencioMs + duracaoMs : 0
      if (this.silencioMs >= CAUDA_MS) this.falando = false
      return [quadro]
    }
    if (energia > piso * FATOR_LIGAR) {
      this.falando = true
      this.silencioMs = 0
      const saida = [...this.anteriores, quadro]
      this.anteriores = []
      return saida
    }
    this.anteriores.push(quadro)
    let total = this.anteriores.reduce((soma, anterior) => soma + anterior.pcm.length, 0)
    while (total - this.anteriores[0]!.pcm.length >= PRE_ROLAGEM_MS * AMOSTRAS_POR_MS) total -= this.anteriores.shift()!.pcm.length
    return []
  }
}
