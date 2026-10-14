import { t } from '@lingui/core/macro'
import { i18n } from '@lingui/core'
import type { CryptoKey } from '@limmiar/crypto'
import { translateProblemCode } from '../../shared/api'
import { obterAssinatura } from './api'
import { lerNota } from './ler-nota'
import { verificarAssinatura } from './nota-crypto'
import { ESTADO_ASSINADA, type Nota } from './nota'

export async function abrirNotas(plaintexts: readonly Uint8Array[], patientId: string, dek: CryptoKey,
  baseUrl: string, accountId: string, accessToken: string): Promise<Nota[]> {
  const notas = new Map<string, Nota>()
  for (const bytes of plaintexts) {
    const nota = lerNota(bytes, patientId)
    if (nota) notas.set(nota.id, nota)
  }
  return Promise.all([...notas.values()].map(async (nota) => {
    const assinatura = await obterAssinatura(baseUrl, accountId, accessToken, nota.id)
    if (!assinatura.ok) {
      if (assinatura.code === 'notes.signature_not_found') return nota
      throw new Error(translateProblemCode(assinatura.code, assinatura.params, i18n))
    }
    if (assinatura.revision !== nota.revisao) throw new Error(t`A revisão do prontuário não corresponde à nota assinada.`)
    if (!await verificarAssinatura(dek, nota, assinatura.signature)) throw new Error(t`A assinatura não corresponde ao conteúdo da nota.`)
    return { ...nota, estado: ESTADO_ASSINADA }
  }))
}
