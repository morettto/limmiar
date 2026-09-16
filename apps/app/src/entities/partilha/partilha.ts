export type { ItemPartilhado } from '../../shared/lib/item-partilhado'

export type TipoPartilhavel = 'checkin'


export type EstadoPartilha = Readonly<Record<string, Readonly<Partial<Record<TipoPartilhavel, true>>>>>

export function comPartilha(
  estado: EstadoPartilha,
  chave: string,
  tipo: TipoPartilhavel,
  ativa: boolean,
): EstadoPartilha {
  // ponytail: um só TipoPartilhavel, o registo da chave é substituído inteiro; ao nascer um
  // segundo tipo, voltar a copiar o registo anterior (e testar que o outro tipo sobrevive).
  return { ...estado, [chave]: ativa ? { [tipo]: true } : {} }
}
