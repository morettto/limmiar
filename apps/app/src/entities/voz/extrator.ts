import { t } from '@lingui/core/macro'
import { embeddingValido, MODELO_VOZ } from './modelo'

export interface ExtratorVoz {
  extrair(pcm: Float32Array): Promise<number[]>
  encerrar(): void
}

export function criarExtratorVoz(signal: AbortSignal): Promise<ExtratorVoz> {
  if (signal.aborted) return Promise.reject(new DOMException('Cancelado', 'AbortError'))
  return new Promise((resolve, reject) => {
    const worker = new Worker('/models/voice-identity/worker.js', { type: 'module' })
    const pendentes = new Map<number, { resolver(embedding: number[]): void; rejeitar(erro: Error): void }>()
    let fechada = false
    let iniciada = false
    let proximoId = 0
    const timeout = setTimeout(() => falhar(), 60000)
    function encerrar() {
      if (fechada) return
      fechada = true
      clearTimeout(timeout)
      signal.removeEventListener('abort', encerrar)
      worker.terminate()
      const erro = new DOMException('Cancelado', 'AbortError')
      reject(erro)
      pendentes.forEach((pendente) => pendente.rejeitar(erro))
      pendentes.clear()
    }
    function falhar() {
      const erro = new Error(t`Não foi possível reconhecer a voz localmente.`)
      reject(erro)
      pendentes.forEach((pendente) => pendente.rejeitar(erro))
      encerrar()
    }
    const extrator: ExtratorVoz = {
      encerrar,
      extrair: (pcm) => {
        if (fechada) return Promise.reject(new DOMException('Cancelado', 'AbortError'))
        // O ganho automático do navegador passa de 1 por pouco; acima de 1,5 o sinal é inválido.
        if (pcm.length < 32000 || pcm.length > 240000 || !pcm.every((valor) => Number.isFinite(valor) && Math.abs(valor) <= 1.5)) {
          return Promise.reject(new Error(t`Amostra de voz inválida.`))
        }
        return new Promise<number[]>((resolver, rejeitar) => {
          const id = ++proximoId
          const copia = pcm.map((valor) => Math.max(-1, Math.min(1, valor)))
          const limite = setTimeout(falhar, 15000)
          pendentes.set(id, {
            resolver: (embedding) => { clearTimeout(limite); pendentes.delete(id); resolver(embedding) },
            rejeitar: (erro) => { clearTimeout(limite); pendentes.delete(id); rejeitar(erro) },
          })
          try { worker.postMessage({ id, pcm: copia }, [copia.buffer]) }
          catch { copia.fill(0); falhar() }
        })
      },
    }
    signal.addEventListener('abort', encerrar)
    worker.onerror = falhar
    worker.onmessageerror = falhar
    worker.onmessage = ({ data }: MessageEvent<Record<string, unknown>>) => {
      if (!data) { falhar(); return }
      if (data.tipo === 'pronto' && !iniciada && data.modelo === MODELO_VOZ) {
        iniciada = true
        clearTimeout(timeout)
        resolve(extrator)
      } else if (data.tipo === 'embedding' && typeof data.id === 'number' && embeddingValido(data.embedding)) {
        pendentes.get(data.id)?.resolver(data.embedding)
      } else { falhar() }
    }
  })
}
