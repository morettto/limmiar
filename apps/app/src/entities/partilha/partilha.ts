import type { CheckIn } from '../checkin/checkin'
import type { Vinculo } from '../vinculo/api'

export type TipoPartilhavel = 'checkin'

export type ItemPartilhado = { tipo: 'checkin'; checkin: CheckIn }

export type EstadoPartilha = Readonly<Record<string, Readonly<Partial<Record<TipoPartilhavel, true>>>>>

// profissionalAccountId isolado não bastaria: um vínculo novo com a mesma dupla
// paciente-profissional (depois de desvincular e vincular de novo) precisa de nunca herdar a
// partilha do vínculo anterior, por isso vinculadoEm entra na chave.
export function chaveDoVinculo(v: Vinculo): string {
  return `${v.profissionalAccountId}|${v.vinculadoEm}`
}

export function comPartilha(
  estado: EstadoPartilha,
  vinculo: Vinculo,
  tipo: TipoPartilhavel,
  ativa: boolean,
): EstadoPartilha {
  const chave = chaveDoVinculo(vinculo)
  const atual = estado[chave] ?? {}
  const proximo: Partial<Record<TipoPartilhavel, true>> = { ...atual }
  if (ativa) {
    proximo[tipo] = true
  } else {
    delete proximo[tipo]
  }
  return { ...estado, [chave]: proximo }
}

export function destinatarios(
  estado: EstadoPartilha,
  vinculos: readonly Vinculo[],
  pacienteAccountId: string,
  tipo: TipoPartilhavel,
): Vinculo[] {
  return vinculos.filter(
    (v) =>
      v.pacienteAccountId === pacienteAccountId &&
      v.chavePublicaDoPar !== null &&
      estado[chaveDoVinculo(v)]?.[tipo] === true,
  )
}
