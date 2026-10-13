import type { RotuloLocutor } from '@limmiar/diarization'
import type { LinhaTranscricao } from './linhas-transcricao'

export interface BlocoTranscricao {
  id: string
  papel: RotuloLocutor
  // 2, 3...: só quando há mais de uma voz que não é o profissional; com uma só, ela é "Paciente".
  pessoa: number | null
  inicioMs: number
  linhas: LinhaTranscricao[]
}

// O bloco só quebra quando outra pessoa fala. Voz sem papel decidido já tem coluna: enquanto ninguém foi confirmado como
// profissional, a primeira voz é ele e as outras são pacientes; depois da confirmação, toda voz nova é paciente. O TitaNet confirma
// ou corrige. Palavra que o servidor ainda não atribuiu fica com o bloco atual.
export function montarBlocos(linhas: readonly LinhaTranscricao[]): BlocoTranscricao[] {
  const blocos: { chave: string; bloco: BlocoTranscricao }[] = []
  const outras: string[] = []
  const provisoria = linhas.some((linha) => linha.papel === 'voce') ? undefined : linhas.find((linha) => linha.papel === null && linha.locutor !== null)?.locutor
  let atual = { papel: 'voce' as RotuloLocutor, chave: 'voce' }
  for (const linha of linhas) {
    const papel = linha.papel ?? (linha.locutor === null ? null : linha.locutor === provisoria ? 'voce' : 'paciente')
    if (papel !== null) atual = { papel, chave: papel === 'voce' ? 'voce' : `paciente:${linha.locutor}` }
    if (atual.papel === 'paciente' && !outras.includes(atual.chave)) outras.push(atual.chave)
    const ultimo = blocos.at(-1)
    if (ultimo?.chave === atual.chave) ultimo.bloco.linhas.push(linha)
    else blocos.push({ chave: atual.chave, bloco: { id: linha.id, papel: atual.papel, pessoa: null, inicioMs: linha.inicioMs, linhas: [linha] } })
  }
  return blocos.map(({ chave, bloco }) => outras.length > 1 && bloco.papel === 'paciente' ? { ...bloco, pessoa: outras.indexOf(chave) + 2 } : bloco)
}

export function formatarInstante(ms: number): string {
  const segundos = Math.floor(ms / 1000)
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`
}
