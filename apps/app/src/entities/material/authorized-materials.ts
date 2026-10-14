import type { CryptoKey } from '@limmiar/crypto'
import { listMaterials, type MaterialAccess } from './api'
import { openMaterialMetadata } from './material-crypto'
import { listPreparedMaterials } from './local-material'

export interface SessionMaterial { materialId: string; title: string; ready: boolean }
export async function prepareAuthorizedMaterials(access: MaterialAccess, kek: CryptoKey): Promise<{ materialIds: string[]; pending: number; materials: SessionMaterial[] }> {
  const list = await listMaterials(access)
  if (!list.ok) throw new Error('material.unavailable')
  const prepared = await listPreparedMaterials(access)
  const materials = await Promise.all(list.materials.filter(item => item.authorized).map(async item => {
    const { metadata } = await openMaterialMetadata(kek, access.accountId, item)
    return { materialId: item.materialId, title: metadata.title,
      ready: prepared.some(ready => ready.materialId === item.materialId && ready.ready && ready.sha256 === metadata.sha256) }
  }))
  const materialIds = materials.filter(item => item.ready).map(item => item.materialId)
  return { materialIds, pending: materials.length - materialIds.length, materials }
}
