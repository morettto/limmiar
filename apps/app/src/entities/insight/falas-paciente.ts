import type { PalavraAtribuida, RotuloLocutor } from '@limmiar/diarization'
import type { ConsultaInsight } from './insight'

export function selecionarFalasPaciente(palavras: readonly PalavraAtribuida[], papeis: Readonly<Record<string, RotuloLocutor | null>>,
  estavelAteMs: number): ConsultaInsight[] {
  const falas: ConsultaInsight[] = []
  let atual: ConsultaInsight | undefined
  let ultimoFimMs = 0
  let locutorAtual: string | null = null
  const concluir = () => {
    if (atual && atual.frase.trim()) falas.push(atual)
    atual = undefined
  }
  for (const palavra of palavras) {
    // Palavra ainda instável: a frase em curso pode continuar e não é julgada pela metade.
    if (palavra.fimMs >= estavelAteMs) return falas
    if (palavra.locutor === null || papeis[palavra.locutor] !== 'paciente') {
      concluir()
      continue
    }
    if (atual && (palavra.locutor !== locutorAtual || palavra.inicioMs - ultimoFimMs >= 900)) concluir()
    if (atual && `${atual.frase} ${palavra.texto}`.length > 2000) concluir()
    if (!atual) {
      atual = { id: `${palavra.inicioMs}:${palavra.locutor}`, frase: '', contexto: falas.slice(-5).map((fala) => fala.frase), fimMs: 0 }
    }
    atual.frase = atual.frase ? `${atual.frase} ${palavra.texto}` : palavra.texto
    atual.fimMs = palavra.fimMs
    ultimoFimMs = palavra.fimMs
    locutorAtual = palavra.locutor
    if (/[.!?…]["'”’)\]]*$/.test(atual.frase.trim())) concluir()
  }
  // O servidor só entrega a frase final depois de fechá-la pelo silêncio: sem pontuação, ela não espera a próxima voz.
  concluir()
  return falas
}
