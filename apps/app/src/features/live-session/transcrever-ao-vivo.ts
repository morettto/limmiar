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

// O gateway só devolve "profissional" ou o nome de outra pessoa ("paciente", "pessoa_2"...).
export const papelDoFalante = (falante: string): RotuloLocutor => falante === 'profissional' ? 'voce' : 'paciente'

// A transcrição e a identificação de quem fala rodam no gateway de fala, que recebe o PCM só em memória.
export async function transcreverAoVivo(stream: MediaStream, signal: AbortSignal,
  atualizar: (transcricao: TranscricaoAoVivo) => void, falhar: (erro: Error) => void,
  controle: CapturaTranscricao): Promise<SessaoTranscricao> {
  const capturaAbort = new AbortController()
  let captura: CapturaPcm | undefined
  let sessaoServidor: SessaoServidor | undefined
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
    const aberta = await abrirTranscricao({
      identidade: controle.trilhas === 'proprias' ? { modo: 'presencial', perfil: controle.perfil } : { modo: 'online', falante: controle.falante },
      aoResultado: (resultado) => { if (!encerrada) { ultimo = resultado; atualizar(resultado) } },
      falhar: erro,
    })
    if (encerrada) { aberta.descartar(); throw new DOMException('Cancelado', 'AbortError') }
    sessaoServidor = aberta
    captura = await capturarPcm(stream, capturaAbort.signal, (pcm) => {
      if (encerrada) return
      // Stryker disable next-line ConditionalExpression: equivalent, a presencial control has no `receberPcm`, so calling it is a no-op.
      if (controle.trilhas === 'emprestadas') controle.receberPcm?.(pcm)
      sessaoServidor!.enviar(pcm)
    }, () => erro(new Error(t`O microfone foi interrompido.`)), {
      trilhas: controle.trilhas,
      aoEncerrarTrilha: controle.trilhas === 'emprestadas' ? () => { void encerrar().catch(() => {}) } : undefined,
    })
    if (encerrada) { captura.cancelar(); throw new Error(t`A captura foi cancelada.`) }
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
