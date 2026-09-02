import type { PalavraAtribuida } from './merge'
import type { RotuloLocutor } from './classify'

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
    // `=== null` é para o tipo (Map.get exige `string`); em runtime `.get(null)`
    // devolveria `undefined` na mesma, por isso é um mutante equivalente.
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
