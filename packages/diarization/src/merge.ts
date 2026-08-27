export interface TurnoLocutor {
  // saída do diarizador
  locutor: string // id opaco ("SPEAKER_00", …) — não interpretado aqui
  inicioMs: number // inteiros; intervalo meio-aberto [inicioMs, fimMs)
  fimMs: number
}

export interface PalavraAsr {
  // saída do ASR
  texto: string
  inicioMs: number
  fimMs: number
}

export interface PalavraAtribuida extends PalavraAsr {
  locutor: string | null // null === indeterminado
}

function sobreposicao(p: PalavraAsr, t: TurnoLocutor): number {
  // palavra degenerada (o ASR emite-as) conta como 1ms, para pertencer a
  // exatamente um lado de uma fronteira [a,b)/[b,c).
  const fim = Math.max(p.fimMs, p.inicioMs + 1)
  return Math.max(0, Math.min(fim, t.fimMs) - Math.max(p.inicioMs, t.inicioMs))
}

// ponytail: O(palavras × turnos) — varredura completa por palavra. ~9k palavras × ~500 turnos numa sessão de 50 min corre em milissegundos; se algum dia doer, dois ponteiros sobre turnos ordenados.
export function atribuirLocutores(
  palavras: readonly PalavraAsr[],
  turnos: readonly TurnoLocutor[],
): PalavraAtribuida[] {
  return palavras.map((palavra) => {
    const pesos = new Map<string, number>()
    for (const turno of turnos) {
      const peso = sobreposicao(palavra, turno)
      pesos.set(turno.locutor, (pesos.get(turno.locutor) ?? 0) + peso)
    }

    let vencedor: string | null = null
    let maiorPeso = 0
    for (const [locutor, peso] of pesos) {
      if (peso > maiorPeso) {
        maiorPeso = peso
        vencedor = locutor
      } else if (peso === maiorPeso) {
        vencedor = null
      }
    }

    return { ...palavra, locutor: vencedor }
  })
}
