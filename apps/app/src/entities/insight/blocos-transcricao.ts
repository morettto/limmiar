import type { PalavraAtribuida, RotuloLocutor } from '@limmiar/diarization'
import type { LinhaTranscricao } from './linhas-transcricao'

export interface BlocoTranscricao {
  id: string
  papel: RotuloLocutor | null
  pessoa: number | null
  inicioMs: number
  falaMs: number
  linhas: LinhaTranscricao[]
}

export function montarBlocos(linhas: readonly LinhaTranscricao[], palavras: readonly PalavraAtribuida[]): BlocoTranscricao[] {
  const blocos: { chave: string; bloco: BlocoTranscricao }[] = []
  for (const linha of linhas) {
    const chave = linha.papel === 'voce' ? 'voce' : JSON.stringify([linha.papel, linha.locutor])
    const numero = linha.papel === null && linha.locutor !== null ? /^pessoa_(\d+)$/.exec(linha.locutor) : null
    const ultimo = blocos.at(-1)
    if (ultimo?.chave === chave) ultimo.bloco.linhas.push(linha)
    else blocos.push({ chave, bloco: { id: linha.id, papel: linha.papel, pessoa: numero === null ? null : Number(numero[1]), inicioMs: linha.inicioMs, falaMs: 0, linhas: [linha] } })
  }
  return blocos.map(({ bloco }) => {
    let fimContado = bloco.inicioMs
    const doBloco = palavras.filter(palavra => bloco.linhas.some(linha => linha.locutor === palavra.locutor &&
      palavra.inicioMs >= linha.inicioMs && palavra.fimMs <= linha.fimMs)).sort((a, b) => a.inicioMs - b.inicioMs)
    for (const palavra of doBloco) {
      bloco.falaMs += Math.max(0, palavra.fimMs - Math.max(fimContado, palavra.inicioMs))
      fimContado = Math.max(fimContado, palavra.fimMs)
    }
    return bloco
  })
}

export function formatarInstante(ms: number): string {
  const segundos = Math.floor(ms / 1000)
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`
}
