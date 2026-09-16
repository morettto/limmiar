export type ItemPartilhado = {
  tipo: 'checkin'
  checkin: {
    dia: string
    sono: 1 | 2 | 3 | 4 | 5
    ansiedade: 1 | 2 | 3 | 4 | 5
    frase: string | null
  }
}
