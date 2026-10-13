declare const AudioWorkletProcessor: { new (): { port: MessagePort } }
declare function registerProcessor(nome: string, ctor: unknown): void
declare const sampleRate: number

const TAXA_SAIDA = 16000
// 80 ms: o texto só pode aparecer depois que o servidor recebe o áudio, então o bloco entra direto na latência.
const AMOSTRAS_POR_BLOCO = 1280

class RealtimePcm extends AudioWorkletProcessor {
  private buffer = new Float32Array(AMOSTRAS_POR_BLOCO)
  private escrito = 0
  private encerrado = false
  // O Firefox não liga um microfone de 44,1/48 kHz a um contexto de 16 kHz: o contexto roda na taxa do aparelho e a média por área reduz aqui.
  private razao = (typeof sampleRate === 'number' ? sampleRate : TAXA_SAIDA) / TAXA_SAIDA
  private soma = 0
  private peso = 0

  constructor() {
    super()
    this.port.onmessage = () => {
      this.encerrado = true
      if (this.escrito > 0) this.enviar(this.buffer.slice(0, this.escrito))
      this.port.postMessage({ type: 'drained' })
    }
  }

  private enviar(pcm: Float32Array<ArrayBuffer>) {
    this.port.postMessage({ pcm }, [pcm.buffer])
  }

  private saida(valor: number) {
    this.buffer[this.escrito++] = valor
    if (this.escrito === this.buffer.length) {
      this.enviar(this.buffer)
      this.buffer = new Float32Array(AMOSTRAS_POR_BLOCO)
      this.escrito = 0
    }
  }

  private entrar(amostra: number) {
    let resto = 1
    while (resto > 1e-9) {
      const cabe = Math.min(resto, this.razao - this.peso)
      this.soma += amostra * cabe
      this.peso += cabe
      resto -= cabe
      if (this.peso >= this.razao - 1e-9) {
        this.saida(this.soma / this.razao)
        this.soma = 0
        this.peso = 0
      }
    }
  }

  process(inputs: Float32Array[][]): boolean {
    if (this.encerrado) return false
    const canal = inputs[0]?.[0] ?? new Float32Array(128)
    for (const amostra of canal) this.entrar(amostra)
    return true
  }
}

registerProcessor('realtime-pcm', RealtimePcm)
