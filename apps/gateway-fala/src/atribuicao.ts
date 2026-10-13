import type { Falante } from './protocolo.ts'

export interface FraseNoTempo {
  id: number
  inicioMs: number
  fimMs: number
}

export interface Revisao {
  frase: number
  falante: Falante
}

interface Verificada { frase: FraseNoTempo; falante: Falante }
interface Pendente { frase: FraseNoTempo; falante: Falante | null }

// Frase curta demais para medir a voz herda o falante da anterior e fica à espera: quando a próxima frase verificada chega,
// cada pendente fica com a verificada mais próxima no tempo (a anterior a ela ou esta).
export class Atribuicao {
  private ultimo: Falante | null = null
  private anterior: Verificada | undefined
  private pendentes: Pendente[] = []

  resolver(frase: FraseNoTempo, verificado: Falante | null): { falante: Falante | null; revisoes: Revisao[] } {
    if (verificado === null) {
      this.pendentes.push({ frase, falante: this.ultimo })
      return { falante: this.ultimo, revisoes: [] }
    }
    const atual = { frase, falante: verificado }
    const revisoes: Revisao[] = []
    for (const pendente of this.pendentes) {
      const maisProxima = this.anterior === undefined || frase.inicioMs - pendente.frase.fimMs < pendente.frase.inicioMs - this.anterior.frase.fimMs ? atual : this.anterior
      if (maisProxima.falante !== pendente.falante) revisoes.push({ frase: pendente.frase.id, falante: maisProxima.falante })
    }
    this.pendentes = []
    this.anterior = atual
    this.ultimo = verificado
    return { falante: verificado, revisoes }
  }
}
