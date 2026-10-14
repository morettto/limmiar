import type { PalavraAtribuida } from '@limmiar/diarization'
import { abrirTranscricao } from '../../shared/audio/transcricao-servidor'

// Quadros de 80 ms, como na captura ao vivo: a porta de voz do socket decide quadro a quadro o que é silêncio.
const AMOSTRAS_POR_ENVIO = 1280

async function decodificar(audio: Blob): Promise<Float32Array> {
  const decodificado = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await audio.arrayBuffer())
  const renderizador = new OfflineAudioContext(1, Math.ceil(decodificado.duration * 16000), 16000)
  const fonte = renderizador.createBufferSource()
  fonte.buffer = decodificado
  fonte.connect(renderizador.destination)
  fonte.start()
  return (await renderizador.startRendering()).getChannelData(0)
}

// Gravação inteira: o mesmo gateway da sessão ao vivo, com o PCM empurrado sem esperar o relógio, no ritmo em que o socket escoa.
// A impressão de voz do profissional é apagada ao fim, com ou sem sucesso.
export async function transcreverLocal(audio: Blob, signal: AbortSignal, perfil: number[]): Promise<PalavraAtribuida[]> {
  try {
    const pcm = await decodificar(audio)
    signal.throwIfAborted()
    const sessao = await abrirTranscricao({ identidade: { modo: 'presencial', perfil }, aoResultado: () => {}, falhar: () => {} })
    const descartar = () => sessao.descartar()
    signal.addEventListener('abort', descartar)
    try {
      for (let inicio = 0; inicio < pcm.length; inicio += AMOSTRAS_POR_ENVIO) {
        signal.throwIfAborted()
        sessao.enviar(pcm.subarray(inicio, inicio + AMOSTRAS_POR_ENVIO))
        await sessao.esvaziada()
      }
      const { palavras } = await sessao.concluir()
      signal.throwIfAborted()
      return palavras
    } finally {
      signal.removeEventListener('abort', descartar)
      sessao.descartar()
    }
  } finally { perfil.fill(0) }
}
