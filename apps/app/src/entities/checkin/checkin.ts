export type Nivel = 1 | 2 | 3 | 4 | 5
export type DiaLocal = string

export interface CheckIn {
  dia: DiaLocal
  sono: Nivel
  ansiedade: Nivel
  frase: string | null
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

// getFullYear/getMonth/getDate (local fields), nunca toISOString() (UTC): perto da meia-noite
// local, os dois divergem em até um dia inteiro.
export function diaLocal(agora: Date): DiaLocal {
  return `${agora.getFullYear()}-${pad2(agora.getMonth() + 1)}-${pad2(agora.getDate())}`
}

// Construtor por campos (ano, mês, dia), não aritmética de milissegundos: o Date lida com o
// underflow do dia (ex. dia 0 vira o último dia do mês anterior) já no fuso local, sem passar
// por UTC.
function diasAntes(dia: DiaLocal, n: number): DiaLocal {
  const [ano, mes, diaDoMes] = dia.split('-').map(Number) as [number, number, number]
  return diaLocal(new Date(ano, mes - 1, diaDoMes - n))
}

/** `dias` entradas, da mais antiga à mais recente (`ate` é a última). Lacuna = sem check-in nesse dia; nunca interpola. */
export function serieComLacunas(
  checkins: readonly CheckIn[],
  ate: DiaLocal,
  dias: number,
): ReadonlyArray<{ dia: DiaLocal; checkin: CheckIn | null }> {
  const porDia = new Map(checkins.map((c) => [c.dia, c]))
  const serie: { dia: DiaLocal; checkin: CheckIn | null }[] = []
  for (let i = dias - 1; i >= 0; i--) {
    const dia = diasAntes(ate, i)
    serie.push({ dia, checkin: porDia.get(dia) ?? null })
  }
  return serie
}
