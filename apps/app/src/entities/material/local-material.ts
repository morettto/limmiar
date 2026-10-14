import { COPILOTO_BASE_URL } from '../../shared/api/copiloto'
import type { MaterialAccess } from './api'
import type { MaterialMetadata } from './material-crypto'

const LOCAL_ACERVO = `${COPILOTO_BASE_URL}/api/acervo`
export type PreparedMaterial = { materialId: string; ready: true; sha256: string; paragraphs: number; preparedAt: string }
  | { materialId: string; ready: false; sha256: string; stage: 'aguardando' | 'organizando' | 'falhou'; progress?: MaterialProgress }
export interface MaterialProgress { phase: 'leitura' | 'referencias'; completed: number; total: number }
export async function listPreparedMaterials(access: MaterialAccess): Promise<PreparedMaterial[]> {
  const result = await fetch(`${LOCAL_ACERVO}/${access.accountId}`, { headers: { Authorization: `Bearer ${access.accessToken}` } })
  if (!result.ok) throw new Error('material.unavailable')
  const body = await result.json() as { materials: PreparedMaterial[] }
  return body.materials
}
export async function prepareLocalMaterial(access: MaterialAccess, id: string, metadata: MaterialMetadata, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const body = new FormData()
  body.append('file', new Blob([bytes]), metadata.filename)
  body.append('titulo', metadata.title)
  body.append('autores', metadata.authors)
  body.append('tipo', metadata.type)
  body.append('sha256', metadata.sha256)
  const result = await fetch(`${LOCAL_ACERVO}/${access.accountId}/${id}/preparar`, { method: 'POST', headers: { Authorization: `Bearer ${access.accessToken}` }, body })
  if (!result.ok) throw new Error('material.prepare')
  const prepared = await result.json() as PreparedMaterial
  if (prepared.materialId !== id || prepared.ready !== false || prepared.sha256 !== metadata.sha256 || !('stage' in prepared)) throw new Error('material.prepare')
}

export async function removeLocalMaterial(access: MaterialAccess, id: string): Promise<void> {
  const result = await fetch(`${LOCAL_ACERVO}/${access.accountId}/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${access.accessToken}` } })
  if (!result.ok && result.status !== 404) throw new Error('material.remove')
}
