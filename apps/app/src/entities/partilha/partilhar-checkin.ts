import type { CryptoKey } from '@limmiar/crypto'
import type { CheckIn } from '../checkin/checkin'
import { listarVinculos } from '../vinculo/api'
import { garantirParDeChaves } from '../vinculo/par-de-chaves'
import { enviarItemPartilhado } from './api'
import { cifrarItem } from './cifra'
import { destinatarios, type ItemPartilhado } from './partilha'
import { lerEstadoPartilha } from './preferencias'

/**
 * O único módulo que decide "cifrar para a profissional". Falha fechada, sem retentativa: qualquer
 * falha ao ler preferências, listar vínculos ou enviar lança. Zero destinatários nunca chama
 * `cifrarItem` nem pede a privada da paciente.
 */
export async function partilharCheckIn(p: {
  baseUrl: string
  accountId: string
  accessToken: string
  kek: CryptoKey
  checkin: CheckIn
}): Promise<{ partilhadoCom: string[] }> {
  const { estado } = await lerEstadoPartilha(p)

  const vinculosResultado = await listarVinculos(p.baseUrl, p.accountId, p.accessToken)
  if (!vinculosResultado.ok) {
    throw new Error(`partilharCheckIn: falha ao listar vínculos (${vinculosResultado.code})`)
  }

  const dest = destinatarios(estado, vinculosResultado.vinculos, p.accountId, 'checkin')
  if (dest.length === 0) {
    return { partilhadoCom: [] }
  }

  const { privateKey } = await garantirParDeChaves(p)
  const item: ItemPartilhado = { tipo: 'checkin', checkin: p.checkin }
  const partilhadoCom: string[] = []
  for (const vinculo of dest) {
    // destinatarios() já garante chavePublicaDoPar !== null para cada vínculo devolvido.
    const publicaProfissional = vinculo.chavePublicaDoPar as Uint8Array
    const ciphertext = cifrarItem({
      privadaPaciente: privateKey,
      publicaProfissional,
      pacienteAccountId: p.accountId,
      profissionalAccountId: vinculo.profissionalAccountId,
      item,
    })
    const enviado = await enviarItemPartilhado(
      p.baseUrl,
      p.accountId,
      p.accessToken,
      vinculo.profissionalAccountId,
      ciphertext,
    )
    if (!enviado.ok) {
      throw new Error(`partilharCheckIn: falha ao enviar item partilhado (${enviado.code})`)
    }
    partilhadoCom.push(vinculo.profissionalAccountId)
  }
  return { partilhadoCom }
}
