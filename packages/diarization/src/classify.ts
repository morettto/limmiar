export type RotuloLocutor = 'voce' | 'paciente'

// Não calibrado com voz humana ainda: 0,7 (o padrão do NeMo verify_speakers) recusou uma leitura real no Zen,
// e vozes distintas ficam abaixo de 0,4 em TitaNet. Vale para o cadastro no aparelho e para o gateway de fala.
export const LIMIAR_MESMA_VOZ = 0.5

export function similaridadeCosseno(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length || !a.every(Number.isFinite) || !b.every(Number.isFinite)) return NaN
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
