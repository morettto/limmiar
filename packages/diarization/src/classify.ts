export type RotuloLocutor = 'voce' | 'paciente'

export interface LocutorCandidato {
  locutor: string // mesmo id opaco de TurnoLocutor.locutor
  embedding: readonly number[]
}

function similaridadeCosseno(a: readonly number[], b: readonly number[]): number {
  let produto = 0
  let normaA = 0
  let normaB = 0
  for (let i = 0; i < a.length; i++) {
    produto += a[i]! * b[i]!
    normaA += a[i]! * a[i]!
    normaB += b[i]! * b[i]!
  }
  return produto / (Math.sqrt(normaA) * Math.sqrt(normaB))
}

export function classificarLocutores(
  cadastrado: readonly number[],
  candidatos: readonly LocutorCandidato[],
  margemMinima = 0.05,
): Map<string, RotuloLocutor | null> {
  const resultado = new Map<string, RotuloLocutor | null>()
  // Guarda por clareza: sem ela o corpo devolveria o mesmo mapa vazio, por isso
  // é um mutante equivalente que a mutação nunca mata.
  if (candidatos.length === 0) return resultado

  const pontuados = candidatos.map((c) => ({
    locutor: c.locutor,
    score: similaridadeCosseno(cadastrado, c.embedding),
  }))
  const scoresOrdenados = pontuados.map((p) => p.score).sort((a, b) => b - a)
  const maior = scoresOrdenados[0]!
  const segundo = scoresOrdenados[1] ?? -Infinity
  // negar a comparação (em vez de `<`) faz NaN (score sem norma, ou tamanhos
  // incompatíveis) cair no branch ambíguo — `NaN < x` e `NaN >= x` são ambos
  // `false`, mas só o segundo, negado, marca ambiguo=true por omissão.
  const ambiguo = !(maior - segundo >= margemMinima)

  for (const { locutor, score } of pontuados) {
    resultado.set(locutor, ambiguo ? null : score === maior ? 'voce' : 'paciente')
  }
  return resultado
}
