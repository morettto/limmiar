import { t } from '@lingui/core/macro'
import type { RotuloLocutor } from '@limmiar/diarization'
import { capturarPcm, type CapturaPcm } from '../../shared/audio/capturar-pcm'
import { abrirTranscricao, type FalanteDaTrilha, type ResultadoTranscricao, type SessaoServidor } from '../../shared/audio/transcricao-servidor'

export type TranscricaoAoVivo = ResultadoTranscricao

export interface SessaoTranscricao {
  pausar(pausada: boolean): void
  encerrar(): Promise<void>
}

// Presencial (microfone próprio): o gateway reconhece o profissional por `perfil` e a sessão apaga a impressão ao encerrar.
// Teleconsulta (trilha emprestada): a trilha já é uma pessoa só e o gateway só carimba `falante`.
export type CapturaTranscricao =
  | { trilhas: 'proprias'; perfil: number[] }
  | { trilhas: 'emprestadas'; falante: FalanteDaTrilha; receberPcm?(pcm: Float32Array): void }

export const papelDoFalante = (falante: string): RotuloLocutor | null => falante === 'profissional' ? 'voce' : falante === 'paciente' ? 'paciente' : null

// A abertura do socket tem limite de 10 s; conservar esse áudio evita perder a primeira fala durante a conexão.
const AMOSTRAS_NA_ABERTURA = 16000 * 10

// A transcrição e a identificação de quem fala rodam no gateway de fala, que recebe o PCM só em memória.
export async function transcreverAoVivo(stream: MediaStream, signal: AbortSignal,
  atualizar: (transcricao: TranscricaoAoVivo) => void, falhar: (erro: Error) => void,
  controle: CapturaTranscricao): Promise<SessaoTranscricao> {
  const capturaAbort = new AbortController()
  let captura: CapturaPcm | undefined
  let sessaoServidor: SessaoServidor | undefined
  let fila: Float32Array[] = []
  let amostrasNaFila = 0
  let ultimo!: ResultadoTranscricao
  let encerrada = false
  let encerramento: Promise<void> | undefined
  let concluir!: () => void
  let rejeitar!: (erro: Error) => void
  const finalizada = new Promise<void>((resolve, reject) => { concluir = resolve; rejeitar = reject })
  void finalizada.catch(() => {})
  function fechar() {
    if (encerrada) return
    encerrada = true
    signal.removeEventListener('abort', cancelar)
    capturaAbort.abort()
    captura?.cancelar()
    fila = []
    if (controle.trilhas === 'proprias') {
      stream.getTracks().forEach((track) => track.stop())
      controle.perfil.fill(0)
    }
    sessaoServidor?.descartar()
  }
  function erro(causa: Error) {
    if (encerrada) return
    fechar()
    rejeitar(causa)
    falhar(causa)
  }
  function cancelar() { erro(new DOMException('Cancelado', 'AbortError')) }
  signal.addEventListener('abort', cancelar)
  try {
    if (signal.aborted) cancelar()
    if (encerrada) throw new DOMException('Cancelado', 'AbortError')
    const capturando = capturarPcm(stream, capturaAbort.signal, (pcm) => {
      if (encerrada) return
      // Stryker disable next-line ConditionalExpression: equivalent, a presencial control has no `receberPcm`, so calling it is a no-op.
      if (controle.trilhas === 'emprestadas') controle.receberPcm?.(pcm)
      if (sessaoServidor) sessaoServidor.enviar(pcm)
      else {
        amostrasNaFila += pcm.length
        if (amostrasNaFila > AMOSTRAS_NA_ABERTURA) { erro(new Error(t`Não foi possível iniciar a gravação.`)); return }
        fila.push(pcm)
      }
    }, () => erro(new Error(t`O microfone foi interrompido.`)), {
      trilhas: controle.trilhas,
      aoEncerrarTrilha: controle.trilhas === 'emprestadas' ? () => { void encerrar().catch(() => {}) } : undefined,
    }).then((aberta) => {
      if (encerrada) { aberta.cancelar(); throw new DOMException('Cancelado', 'AbortError') }
      captura = aberta
    })
    const conectando = abrirTranscricao({
      identidade: controle.trilhas === 'proprias' ? { modo: 'presencial', perfil: controle.perfil } : { modo: 'online', falante: controle.falante },
      aoResultado: (resultado) => { if (!encerrada) { ultimo = resultado; atualizar(resultado) } },
      falhar: erro,
    }).then((aberta) => {
      if (encerrada) { aberta.descartar(); throw new DOMException('Cancelado', 'AbortError') }
      sessaoServidor = aberta
      fila.forEach((pcm) => aberta.enviar(pcm))
      fila = []
    })
    await Promise.all([capturando, conectando])
    return {
      pausar: (pausada) => captura!.pausar(pausada),
      encerrar,
    }
  } catch (causa) { fechar(); throw causa }

  function encerrar(): Promise<void> {
    encerramento ??= (async () => {
      try {
        if (!encerrada) {
          await captura!.encerrar()
          if (!encerrada) ultimo = await sessaoServidor!.concluir()
          if (!encerrada) { atualizar(ultimo); fechar(); concluir() }
        }
      } catch { erro(new Error(t`Não foi possível concluir a captura.`)) }
      return finalizada
    })()
    return encerramento
  }
}
