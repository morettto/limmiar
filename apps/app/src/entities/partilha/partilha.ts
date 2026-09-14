export type TipoPartilhavel = 'checkin'

export type EstadoPartilha = Readonly<Record<string, Readonly<Partial<Record<TipoPartilhavel, true>>>>>

export function comPartilha(
  estado: EstadoPartilha,
  chave: string,
  tipo: TipoPartilhavel,
  ativa: boolean,
): EstadoPartilha {
  const atual = estado[chave] ?? {}
  const proximo: Partial<Record<TipoPartilhavel, true>> = { ...atual }
  if (ativa) {
    proximo[tipo] = true
  } else {
    delete proximo[tipo]
  }
  return { ...estado, [chave]: proximo }
}
