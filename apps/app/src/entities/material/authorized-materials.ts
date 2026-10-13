import type { CryptoKey } from '@limmiar/crypto'
import { getMaterialContent, listMaterials, type MaterialAccess } from './api'
import { materialHash, openMaterialContent, openMaterialMetadata } from './material-crypto'
import { listPreparedMaterials, prepareLocalMaterial } from './local-material'

export async function prepareAuthorizedMaterials(access: MaterialAccess, kek: CryptoKey): Promise<{ materialIds: string[]; pending: number }> {
  const list = await listMaterials(access)
  if (!list.ok) throw new Error('material.unavailable')
  const prepared = await listPreparedMaterials(access).catch(() => null)
  const authorized = list.materials.filter(item => item.authorized)
  const results = await Promise.all(authorized.map(async item => {
    try {
      const { metadata, dek } = await openMaterialMetadata(kek, access.accountId, item)
      if (prepared?.some(ready => ready.materialId === item.materialId && ready.ready && ready.sha256 === metadata.sha256)) return item.materialId
      const content = await getMaterialContent(access, item.materialId)
      // Stryker disable next-line ConditionalExpression: equivalent, reading `ciphertext` off a failure throws into the same catch.
      if (!content.ok) return null
      const bytes = await openMaterialContent(dek, access.accountId, item.materialId, content.ciphertext)
      if (await materialHash(bytes) !== metadata.sha256) return null
      await prepareLocalMaterial(access, item.materialId, metadata, bytes)
      return item.materialId
    } catch { return null }
  }))
  const materialIds = results.filter((id): id is string => id !== null)
  return { materialIds, pending: authorized.length - materialIds.length }
}
