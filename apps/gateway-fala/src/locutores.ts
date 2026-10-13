import { LIMIAR_MESMA_VOZ, similaridadeCosseno } from '@limmiar/diarization'

export const PROFISSIONAL = 'profissional'

const unitario = (vetor: ArrayLike<number>): number[] => {
  const valores = Array.from(vetor)
  const norma = Math.hypot(...valores)
  return valores.map((valor) => valor / norma)
}

// Quem fala, frase a frase: casou com a impressão de voz do profissional (mesmo limiar do cadastro no aparelho) é ele; quem
// não casou é agrupado por similaridade entre si, na ordem em que aparece. A impressão só vive nesta instância.
export class Locutores {
  private readonly perfil: number[]
  private readonly vozes: { nome: string; soma: number[] }[] = []

  constructor(perfil: readonly number[]) { this.perfil = unitario(perfil) }

  identificar(embedding: ArrayLike<number>): string {
    const voz = unitario(embedding)
    if (similaridadeCosseno(this.perfil, voz) >= LIMIAR_MESMA_VOZ) return PROFISSIONAL
    let melhor = this.vozes[0]
    let melhorSimilaridade = -Infinity
    for (const candidata of this.vozes) {
      const similaridade = similaridadeCosseno(candidata.soma, voz)
      if (similaridade > melhorSimilaridade) { melhor = candidata; melhorSimilaridade = similaridade }
    }
    if (melhor && melhorSimilaridade >= LIMIAR_MESMA_VOZ) {
      voz.forEach((valor, i) => { melhor.soma[i]! += valor })
      return melhor.nome
    }
    const nome = this.vozes.length === 0 ? 'paciente' : `pessoa_${this.vozes.length + 1}`
    this.vozes.push({ nome, soma: voz })
    return nome
  }

  limpar(): void {
    this.perfil.fill(0)
    this.vozes.forEach(({ soma }) => soma.fill(0))
    this.vozes.length = 0
  }
}
