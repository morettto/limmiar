import { request, type ProblemResult } from '../../shared/api'
import { decodeBase64, encodeBase64 } from '../../shared/lib/base64'
import type { SealedMaterial } from './material-crypto'

export interface MaterialSummary extends Pick<SealedMaterial, 'materialId' | 'wrappedDek' | 'metadataCiphertext'> {
  authorized: boolean
  createdAt: string
}
export interface MaterialAccess { baseUrl: string; accountId: string; accessToken: string }
function path(access: MaterialAccess) { return `/accounts/${access.accountId}/materials` }

export async function listMaterials(access: MaterialAccess): Promise<{ ok: true; materials: MaterialSummary[] } | ProblemResult> {
  const result = await request(access.baseUrl, 'GET', path(access), undefined, access.accessToken)
  if (!result.ok) return result
  const body = await result.response.json() as { materials: (Omit<MaterialSummary, 'wrappedDek' | 'metadataCiphertext'> & { wrappedDek: string; metadataCiphertext: string })[] }
  return { ok: true, materials: body.materials.map(material => ({ ...material, wrappedDek: decodeBase64(material.wrappedDek), metadataCiphertext: decodeBase64(material.metadataCiphertext) })) }
}

export async function uploadMaterial(access: MaterialAccess, material: SealedMaterial): Promise<{ ok: true } | ProblemResult> {
  const result = await request(access.baseUrl, 'POST', path(access), { materialId: material.materialId,
    wrappedDek: encodeBase64(material.wrappedDek), metadataCiphertext: encodeBase64(material.metadataCiphertext), contentCiphertext: encodeBase64(material.contentCiphertext) }, access.accessToken)
  return result.ok ? { ok: true } : result
}

export async function getMaterialContent(access: MaterialAccess, id: string): Promise<{ ok: true; ciphertext: Uint8Array<ArrayBuffer> } | ProblemResult> {
  const result = await request(access.baseUrl, 'GET', `${path(access)}/${id}/content`, undefined, access.accessToken)
  if (!result.ok) return result
  const body = await result.response.json() as { contentCiphertext: string }
  return { ok: true, ciphertext: decodeBase64(body.contentCiphertext) }
}

export async function authorizeMaterial(access: MaterialAccess, id: string, authorized: boolean): Promise<{ ok: true } | ProblemResult> {
  const result = await request(access.baseUrl, 'PUT', `${path(access)}/${id}/authorization`, { authorized }, access.accessToken)
  return result.ok ? { ok: true } : result
}

export async function deleteMaterial(access: MaterialAccess, id: string): Promise<{ ok: true } | ProblemResult> {
  const result = await request(access.baseUrl, 'DELETE', `${path(access)}/${id}`, undefined, access.accessToken)
  return result.ok ? { ok: true } : result
}
