// Anel de PCM16 em memória, indexado pela amostra absoluta da sessão: guarda só o necessário para recortar uma frase.
export class BufferPcm {
  private readonly amostras: Int16Array
  private total = 0

  constructor(capacidade: number) { this.amostras = new Int16Array(capacidade) }

  get recebidas(): number { return this.total }

  escrever(pcm: Int16Array): void {
    const capacidade = this.amostras.length
    const util = pcm.length > capacidade ? pcm.subarray(pcm.length - capacidade) : pcm
    const inicio = (this.total + pcm.length - util.length) % capacidade
    const primeira = Math.min(util.length, capacidade - inicio)
    this.amostras.set(util.subarray(0, primeira), inicio)
    this.amostras.set(util.subarray(primeira), 0)
    this.total += pcm.length
  }

  // Devolve só o que ainda está no anel; vazio quando o trecho já saiu dele ou ainda não chegou.
  recortar(de: number, ate: number): Float32Array {
    const capacidade = this.amostras.length
    const inicio = Math.max(0, Math.round(de), this.total - capacidade)
    const fim = Math.min(Math.round(ate), this.total)
    const saida = new Float32Array(Math.max(0, fim - inicio))
    for (let i = 0; i < saida.length; i++) saida[i] = this.amostras[(inicio + i) % capacidade]! / 32768
    return saida
  }

  limpar(): void {
    this.amostras.fill(0)
    this.total = 0
  }
}
