import type { PalavraAtribuida, RotuloLocutor } from '@limmiar/diarization'
import type { ConsultaInsight } from './insight'

const SILENCIO_FIM_TURNO_MS = 2500

// Passada final sobre a fala inteira do paciente: pega o sentido que só existe juntando frases.
export function selecionarTurnosPaciente(palavras: readonly PalavraAtribuida[], papeis: Readonly<Record<string, RotuloLocutor | null>>,
  estavelAteMs: number, falas: readonly ConsultaInsight[]): ConsultaInsight[] {
  const porId = new Map(falas.map((fala) => [fala.id, fala]))
  const turnos: ConsultaInsight[] = []
  let atuais: ConsultaInsight[] = []
  let ultimoFimMs = 0
  const concluir = () => {
    const frase = atuais.map((fala) => fala.frase).join(' ')
    if (atuais.length >= 2 && frase.length <= 2000) {
      turnos.push({ id: `turno:${atuais[0]!.id}`, frase, contexto: atuais[0]!.contexto, ancoras: atuais.map((fala) => fala.id) })
    }
    atuais = []
  }
  for (const palavra of palavras) {
    if (palavra.fimMs >= estavelAteMs) return turnos
    // Stryker disable next-line ConditionalExpression: equivalent, `papeis[null]` is undefined, which is not 'paciente' either.
    if (palavra.locutor === null || papeis[palavra.locutor] !== 'paciente') {
      concluir()
      continue
    }
    const fala = porId.get(`${palavra.inicioMs}:${palavra.locutor}`)
    if (fala) atuais.push(fala)
    ultimoFimMs = palavra.fimMs
  }
  if (estavelAteMs - ultimoFimMs >= SILENCIO_FIM_TURNO_MS) concluir()
  return turnos
}
