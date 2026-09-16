import type { Vinculo } from '../../entities/vinculo/api'
import type { EstadoPartilha, TipoPartilhavel } from '../../entities/partilha/partilha'

export type { ItemPartilhado } from '../../shared/lib/item-partilhado'

// profissionalAccountId isolado não bastaria: um vínculo novo com a mesma dupla
// paciente-profissional (depois de desvincular e vincular de novo) precisa de nunca herdar a
// partilha do vínculo anterior, por isso vinculadoEm entra na chave.
export function chaveDoVinculo(v: Vinculo): string {
  return `${v.profissionalAccountId}|${v.vinculadoEm}`
}

type VinculoComChave = Vinculo & { chavePublicaDoPar: Uint8Array }

export function destinatarios(
  estado: EstadoPartilha,
  vinculos: readonly Vinculo[],
  pacienteAccountId: string,
  tipo: TipoPartilhavel,
): VinculoComChave[] {
  return vinculos.filter(
    (v): v is VinculoComChave =>
      v.pacienteAccountId === pacienteAccountId &&
      v.chavePublicaDoPar !== null &&
      estado[chaveDoVinculo(v)]?.[tipo] === true,
  )
}
