import type { PalavraAtribuida } from './palavra.ts'
import type { RotuloLocutor } from './classify.ts'

export interface TrechoCanonico {
  locutor: RotuloLocutor
  palavras: readonly PalavraAtribuida[]
}

export function montarTranscricaoCanonica(
  palavras: readonly PalavraAtribuida[],
  rotulos: ReadonlyMap<string, RotuloLocutor | null>,
): readonly TrechoCanonico[] {
  const trechos: TrechoCanonico[] = []
  let atual: { locutor: RotuloLocutor; palavras: PalavraAtribuida[] } | null = null

  for (const palavra of palavras) {
    // Stryker disable next-line ConditionalExpression: Map.get(null) returns undefined like this null branch; the check narrows the key type.
    const rotulo = palavra.locutor === null ? null : (rotulos.get(palavra.locutor) ?? null)

    if (rotulo === null) {
      atual = null
      continue
    }

    if (atual !== null && atual.locutor === rotulo) {
      atual.palavras.push(palavra)
    } else {
      atual = { locutor: rotulo, palavras: [palavra] }
      trechos.push(atual)
    }
  }

  return trechos
}
