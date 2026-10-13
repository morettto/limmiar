const AMOSTRAS_POR_MS = 16

interface Trecho { servidor: number; real: number }

// O servidor conta só o áudio que recebeu: o silêncio não enviado some da linha do tempo dele. Este mapa guarda onde cada
// trecho enviado começou na captura (em amostras, a 16 kHz) para devolver os tempos das palavras ao relógio da sessão.
export class MapaDeTempo {
  private readonly trechos: Trecho[] = []
  private enviadas = 0

  get enviadoMs(): number { return this.enviadas / AMOSTRAS_POR_MS }

  registrar(real: number, amostras: number): void {
    const ultimo = this.trechos.at(-1)
    if (!ultimo || real !== ultimo.real + this.enviadas - ultimo.servidor) this.trechos.push({ servidor: this.enviadas, real })
    this.enviadas += amostras
  }

  // O fim de uma palavra que acaba onde outro trecho começa ainda pertence ao trecho anterior.
  paraRealMs(servidorMs: number, aoFim = false): number {
    const alvo = Math.round(servidorMs * AMOSTRAS_POR_MS)
    let baixo = 0
    let alto = this.trechos.length - 1
    while (baixo < alto) {
      const meio = (baixo + alto + 1) >> 1
      if (aoFim ? this.trechos[meio]!.servidor < alvo : this.trechos[meio]!.servidor <= alvo) baixo = meio
      else alto = meio - 1
    }
    const trecho = this.trechos[baixo] ?? { servidor: 0, real: 0 }
    return Math.round((trecho.real + alvo - trecho.servidor) / AMOSTRAS_POR_MS)
  }
}
