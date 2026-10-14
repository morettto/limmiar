import { LIMIAR_MESMA_VOZ, similaridadeCosseno } from '@limmiar/diarization'

export const PROFISSIONAL = 'profissional'

const unitario = (vetor: ArrayLike<number>): number[] => {
  const valores = Array.from(vetor)
  const norma = Math.hypot(...valores)
  return valores.map((valor) => valor / norma)
}

interface Voz { nome: string; ancora: number[]; recentes: number[][] }

export class Locutores {
  private readonly vozes: Voz[]
  private profissionalReconhecido = false

  constructor(perfil: readonly number[]) {
    this.vozes = [{ nome: PROFISSIONAL, ancora: unitario(perfil), recentes: [] }]
  }

  private avaliar(voz: number[]): { conhecida: Voz | undefined; similaridade: number } {
    const candidatas = this.vozes.map(candidata => ({ candidata, similaridade: Math.max(
      similaridadeCosseno(candidata.ancora, voz), ...candidata.recentes.map(prototipo => similaridadeCosseno(prototipo, voz)),
    ) })).sort((a, b) => b.similaridade - a.similaridade)
    const melhor = candidatas[0]
    if (!melhor) return { conhecida: undefined, similaridade: -Infinity }
    const segunda = candidatas[1]?.similaridade ?? -Infinity
    const conhecida = melhor.similaridade >= LIMIAR_MESMA_VOZ && melhor.similaridade - segunda >= 0.08 ? melhor.candidata : undefined
    return { conhecida, similaridade: melhor.similaridade }
  }

  reconhecer(embedding: ArrayLike<number>): string | null {
    const conhecida = this.avaliar(unitario(embedding)).conhecida
    return conhecida?.nome ?? null
  }

  identificar(embedding: ArrayLike<number>, confirmacao?: ArrayLike<number>): string | null {
    const voz = unitario(embedding)
    const primeira = this.avaliar(voz)
    if (!confirmacao) {
      if (primeira.conhecida?.nome === PROFISSIONAL) this.profissionalReconhecido = true
      return primeira.conhecida?.nome ?? null
    }
    const outra = unitario(confirmacao)
    const segunda = this.avaliar(outra)
    if (primeira.conhecida) {
      if (segunda.conhecida === primeira.conhecida && similaridadeCosseno(voz, outra) >= LIMIAR_MESMA_VOZ) {
        if (primeira.conhecida.nome === PROFISSIONAL) this.profissionalReconhecido = true
        const recentes = primeira.conhecida.recentes
        recentes.push(voz, outra)
        for (const antiga of recentes.splice(0, Math.max(0, recentes.length - 2))) antiga.fill(0)
      }
      return primeira.conhecida.nome
    }
    if (!this.profissionalReconhecido || segunda.conhecida || primeira.similaridade >= 0.4 || segunda.similaridade >= 0.4 ||
      !(similaridadeCosseno(voz, outra) >= LIMIAR_MESMA_VOZ)) return null
    const nome = this.vozes.length === 1 ? 'paciente' : `pessoa_${this.vozes.length}`
    this.vozes.push({ nome, ancora: voz, recentes: [outra] })
    return nome
  }

  limpar(): void {
    for (const voz of this.vozes) {
      voz.ancora.fill(0)
      voz.recentes.forEach(prototipo => prototipo.fill(0))
    }
    this.vozes.length = 0
    this.profissionalReconhecido = false
  }
}
