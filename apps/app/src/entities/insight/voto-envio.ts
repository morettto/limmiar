import type { CryptoKey } from '@limmiar/crypto'
import { enviarVoto, type BibliografiaInsight } from './insight'
import { lerConsentimento } from './consentimento-voto'
import { lerVotos, marcarEnviado } from './voto-store'

const MAX_POR_VEZ = 20

/** Reenvia votos consentidos ainda não aceitos; para na primeira falha e tenta de novo na próxima chamada. */
export async function enviarPendentes(kek: CryptoKey, accountId: string, bibliografia: BibliografiaInsight | undefined): Promise<void> {
  if (!bibliografia || lerConsentimento(accountId) !== 'sim') return
  const pendentes = (await lerVotos(kek, accountId)).filter((voto) => voto.consentiu && !voto.enviado).slice(0, MAX_POR_VEZ)
  for (const voto of pendentes) {
    try {
      if (!(await enviarVoto(voto, bibliografia))) return
    } catch {
      return
    }
    await marcarEnviado(kek, accountId, voto)
  }
}
