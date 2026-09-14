import { atribuirLocutores, type PalavraAsr, type TurnoLocutor } from './merge'
import { classificarLocutores, type LocutorCandidato } from './classify'
import { montarTranscricaoCanonica, type TrechoCanonico } from './canonico'

export function processarDiarizacao(
  palavras: readonly PalavraAsr[],
  turnos: readonly TurnoLocutor[],
  cadastrado: readonly number[],
  candidatos: readonly LocutorCandidato[],
  margemMinima?: number,
): readonly TrechoCanonico[] {
  const atribuidas = atribuirLocutores(palavras, turnos)
  const rotulos = classificarLocutores(cadastrado, candidatos, margemMinima)
  return montarTranscricaoCanonica(atribuidas, rotulos)
}
