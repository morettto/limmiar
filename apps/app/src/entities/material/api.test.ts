import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { authorizeMaterial, deleteMaterial, getMaterialContent, listMaterials, uploadMaterial } from './api'
const access = { baseUrl: 'https://api.example', accountId: 'owner', accessToken: 'secret' }
const bytes = new Uint8Array([1, 2, 3])
const fetcher = vi.fn()
beforeEach(() => { vi.stubGlobal('fetch', fetcher) })
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
it('usa bearer e apenas IDs/cifras na criação, lista, arquivo, autorização e exclusão', async () => {
  fetcher.mockResolvedValueOnce(new Response(null, { status: 201 }))
  expect(await uploadMaterial(access, { materialId: 'id', wrappedDek: bytes, metadataCiphertext: bytes, contentCiphertext: bytes })).toEqual({ ok: true })
  const body = JSON.parse(fetcher.mock.lastCall![1].body)
  expect(body).toEqual({ materialId: 'id', wrappedDek: 'AQID', metadataCiphertext: 'AQID', contentCiphertext: 'AQID' })
  expect(fetcher.mock.lastCall![1].headers.Authorization).toBe('Bearer secret')
  const alvo = () => [fetcher.mock.lastCall![1].method ?? 'GET', fetcher.mock.lastCall![0]]
  expect(alvo()).toEqual(['POST', 'https://api.example/accounts/owner/materials'])
  fetcher.mockResolvedValueOnce(Response.json({ materials: [{ materialId: 'id', wrappedDek: 'AQID', metadataCiphertext: 'AQID', authorized: false, createdAt: 'date' }] }))
  expect(await listMaterials(access)).toEqual({ ok: true, materials: [{ materialId: 'id', wrappedDek: bytes, metadataCiphertext: bytes, authorized: false, createdAt: 'date' }] })
  expect(alvo()).toEqual(['GET', 'https://api.example/accounts/owner/materials'])
  fetcher.mockResolvedValueOnce(Response.json({ contentCiphertext: 'AQID' }))
  expect(await getMaterialContent(access, 'id')).toEqual({ ok: true, ciphertext: bytes })
  expect(alvo()).toEqual(['GET', 'https://api.example/accounts/owner/materials/id/content'])
  fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }))
  expect(await authorizeMaterial(access, 'id', true)).toEqual({ ok: true })
  expect(JSON.parse(fetcher.mock.lastCall![1].body)).toEqual({ authorized: true })
  expect(alvo()).toEqual(['PUT', 'https://api.example/accounts/owner/materials/id/authorization'])
  fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }))
  expect(await deleteMaterial(access, 'id')).toEqual({ ok: true })
  expect(alvo()).toEqual(['DELETE', 'https://api.example/accounts/owner/materials/id'])
})
it('preserva recusas da API em todas as operações', async () => {
  fetcher.mockImplementation(async () => Response.json({ code: 'materials.not_found', params: {} }, { status: 404 }))
  const failed = { ok: false, code: 'materials.not_found', params: {} }
  expect(await listMaterials(access)).toEqual(failed)
  expect(await getMaterialContent(access, 'id')).toEqual(failed)
  expect(await authorizeMaterial(access, 'id', false)).toEqual(failed)
  expect(await deleteMaterial(access, 'id')).toEqual(failed)
  expect(await uploadMaterial(access, { materialId: 'id', wrappedDek: bytes, metadataCiphertext: bytes, contentCiphertext: bytes })).toEqual(failed)
})
