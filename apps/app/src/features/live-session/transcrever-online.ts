import type { PalavraAtribuida } from '@limmiar/diarization'
import { transcreverAoVivo, type SessaoTranscricao, type TranscricaoAoVivo } from './transcrever-ao-vivo'

export const PAPEIS_ONLINE = { 'online-profissional': 'voce', 'online-paciente': 'paciente' } as const

export async function transcreverOnline(local: MediaStream, remoto: MediaStream, signal: AbortSignal,
  atualizar: (transcricao: TranscricaoAoVivo) => void, falhar: (erro: Error) => void,
  inicioMs: number): Promise<SessaoTranscricao> {
  const inicio = performance.now()
  const fontes = [local, remoto]
  const ids = Object.keys(PAPEIS_ONLINE)
  const resultados: TranscricaoAoVivo[] = [{ palavras: [], finais: 0, estavelAteMs: 0 }, { palavras: [], finais: 0, estavelAteMs: 0 }]
  const deslocamentos = [inicioMs, inicioMs]
  const capturadas = new Set<number>()
  const abort = new AbortController()
  const sessoes: SessaoTranscricao[] = []
  const cancelar = () => abort.abort()
  signal.addEventListener('abort', cancelar)
  let encerramento: Promise<void> | undefined
  function publicar() {
    const paciente = resultados[1]!
    const ultimaFinal = paciente.palavras[paciente.finais - 1]
    const palavras: PalavraAtribuida[] = resultados.flatMap((resultado, indice) => resultado.palavras.map(palavra => ({
      ...palavra, locutor: ids[indice]!, inicioMs: palavra.inicioMs + deslocamentos[indice]!, fimMs: palavra.fimMs + deslocamentos[indice]!,
    }))).sort((a, b) => a.inicioMs - b.inicioMs || a.fimMs - b.fimMs)
    // Das duas trilhas, vale o aviso mais grave: "reconectando" vem depois de "atrasada" na ordem alfabética.
    const aviso = resultados.flatMap(resultado => resultado.aviso ?? []).sort().at(-1)
    // O papel vem da trilha autenticada; aguardar diarização atrasaria frases já finalizadas.
    atualizar({ palavras, finais: resultados.reduce((total, resultado) => total + resultado.finais, 0),
      estavelAteMs: deslocamentos[1]! + (ultimaFinal ? ultimaFinal.fimMs + 1 : 0), ...(aviso && { aviso }) })
  }
  try {
    if (signal.aborted) cancelar()
    // A trilha original conserva o mute do WebRTC; a captura não é dona dela.
    for (let indice = 0; indice < fontes.length; indice++) {
      sessoes.push(await transcreverAoVivo(fontes[indice]!, abort.signal, resultado => {
        resultados[indice] = resultado; publicar()
      }, erro => { if (!abort.signal.aborted) { falhar(erro); abort.abort() } }, {
        trilhas: 'emprestadas',
        falante: indice === 0 ? 'profissional' : 'paciente',
        receberPcm: pcm => {
          if (capturadas.has(indice)) return
          capturadas.add(indice)
          deslocamentos[indice] = inicioMs + Math.max(0, Math.round(performance.now() - inicio - pcm.length / 16))
        },
      }))
    }
    return {
      pausar(pausada) { sessoes.forEach(sessao => sessao.pausar(pausada)) },
      encerrar() {
        encerramento ??= Promise.all(sessoes.map(sessao => sessao.encerrar())).then(() => {}).finally(() => {
          signal.removeEventListener('abort', cancelar); abort.abort()
        })
        return encerramento
      },
    }
  } catch (erro) { signal.removeEventListener('abort', cancelar); abort.abort(); throw erro }
}
