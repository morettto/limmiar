import { t } from '@lingui/core/macro'
import { LIMIAR_MESMA_VOZ, similaridadeCosseno } from '@limmiar/diarization'
import { criarExtratorVoz } from '../../entities/voz/extrator'
import { DIMENSOES_VOZ } from '../../entities/voz/modelo'
import { capturarPcm, type CapturaPcm } from '../../shared/audio/capturar-pcm'

export async function capturarPerfil(signal: AbortSignal, progresso: (segundos: number) => void): Promise<number[]> {
  const pcm = new Float32Array(240000)
  const extrator = await criarExtratorVoz(signal)
  const capturaAbort = new AbortController()
  let encerrada = false
  let captura: CapturaPcm | undefined
  let stream: MediaStream | undefined
  let limite: ReturnType<typeof setTimeout> | undefined
  let capturadas = 0
  let rejeitar!: (erro: Error) => void
  const cancelar = () => rejeitar(new DOMException('Cancelado', 'AbortError'))
  const amostra = new Promise<void>((resolve, reject) => {
    rejeitar = reject
    limite = setTimeout(() => reject(new Error(t`O microfone não concluiu a captura.`)), 45000)
    signal.addEventListener('abort', cancelar)
    void (async () => {
      try {
        if (signal.aborted) throw new DOMException('Cancelado', 'AbortError')
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (signal.aborted || encerrada) { stream.getTracks().forEach((track) => track.stop()); return }
        captura = await capturarPcm(stream, capturaAbort.signal, (parte) => {
          const tamanho = Math.min(parte.length, pcm.length - capturadas)
          pcm.set(parte.subarray(0, tamanho), capturadas)
          capturadas += tamanho
          progresso(Math.floor(capturadas / 16000))
          if (capturadas === pcm.length) resolve()
        }, () => reject(new Error(t`O microfone foi interrompido.`)), { trilhas: 'proprias' })
      } catch (erro) { reject(erro) }
    })()
  })
  const vetores: number[][] = []
  try {
    await amostra
    clearTimeout(limite)
    captura!.cancelar()
    for (let inicio = 0; inicio < pcm.length; inicio += 80000) {
      const trecho = pcm.subarray(inicio, inicio + 80000)
      const energia = trecho.reduce((soma, valor) => soma + valor * valor, 0) / trecho.length
      // Stryker disable next-line EqualityOperator: equivalent, a float mean energy never lands exactly on the threshold.
      if (energia < 0.00001) throw new Error(t`A amostra não contém fala suficiente.`)
      vetores.push(await extrator.extrair(trecho))
    }
    const minima = Math.min(similaridadeCosseno(vetores[0]!, vetores[1]!), similaridadeCosseno(vetores[0]!, vetores[2]!),
      similaridadeCosseno(vetores[1]!, vetores[2]!))
    const similaridade = minima.toFixed(2)
    if (minima < LIMIAR_MESMA_VOZ) throw new Error(t`A voz variou durante a amostra (similaridade ${similaridade}).`)
    const media = Array.from({ length: DIMENSOES_VOZ }, (_, indice) => vetores.reduce((soma, vetor) => soma + vetor[indice]!, 0))
    const norma = Math.hypot(...media)
    return media.map((valor) => valor / norma)
  } finally {
    encerrada = true
    capturaAbort.abort()
    clearTimeout(limite)
    signal.removeEventListener('abort', cancelar)
    captura?.cancelar()
    stream?.getTracks().forEach((track) => track.stop())
    extrator.encerrar()
    pcm.fill(0)
    vetores.forEach((vetor) => vetor.fill(0))
  }
}
