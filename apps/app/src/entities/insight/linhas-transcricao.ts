import type { PalavraAtribuida, RotuloLocutor } from '@limmiar/diarization'
import type { ConsultaInsight } from './insight'

export interface LinhaTranscricao {
  id: string
  texto: string
  inicioMs: number
  fimMs: number
  papel: RotuloLocutor | null
  locutor: string | null
  consultaId: string | null
  // Ainda é hipótese do servidor: o texto pode mudar.
  parcial: boolean
}

// As palavras a partir de `finais` são hipótese; uma linha nunca mistura final com hipótese.
export function montarLinhasTranscricao(palavras: readonly PalavraAtribuida[],
  papeis: Readonly<Record<string, RotuloLocutor | null>>, consultas: readonly ConsultaInsight[], finais = palavras.length): LinhaTranscricao[] {
  const inicios = new Map(consultas.map((consulta) => [consulta.id, consulta]))
  const linhas: LinhaTranscricao[] = []
  let indice = 0
  while (indice < palavras.length) {
    const primeira = palavras[indice]!
    const id = `${primeira.inicioMs}:${primeira.locutor}`
    // Stryker disable next-line ConditionalExpression: equivalent, `papeis[null]` is undefined, which also becomes null.
    const papel = primeira.locutor === null ? null : papeis[primeira.locutor] ?? null
    const consulta = papel === 'paciente' ? inicios.get(id) : undefined
    let texto = primeira.texto
    const limite = indice < finais ? finais : palavras.length
    let fim = indice + 1
    if (consulta) {
      while (texto.length < consulta.frase.length && fim < limite && palavras[fim]!.locutor === primeira.locutor) {
        texto += ` ${palavras[fim++]!.texto}`
      }
    }
    const consultaId = consulta && texto === consulta.frase ? consulta.id : null
    if (consultaId === null) {
      texto = primeira.texto
      fim = indice + 1
      while (fim < limite && palavras[fim]!.locutor === primeira.locutor &&
        palavras[fim]!.inicioMs - palavras[fim - 1]!.fimMs < 900 &&
        !/[.!?…]["'”’)\]]*$/.test(texto.trim()) &&
        !inicios.has(`${palavras[fim]!.inicioMs}:${palavras[fim]!.locutor}`)) {
        texto += ` ${palavras[fim++]!.texto}`
      }
    }
    linhas.push({ id: `${indice}:${id}`, texto, inicioMs: primeira.inicioMs, fimMs: palavras[fim - 1]!.fimMs, papel, locutor: primeira.locutor, consultaId, parcial: indice >= finais })
    indice = fim
  }
  return linhas
}
