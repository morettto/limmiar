import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { listPreparedMaterials, prepareLocalMaterial, removeLocalMaterial } from './local-material'
const access = { baseUrl: '', accountId: 'owner', accessToken: 'secret' }
const metadata = { title: 'Obra', authors: 'Autora', reference: '', filename: 'obra.txt', type: 'txt' as const, size: 3, sha256: 'sha' }
const ready = { materialId: 'id', ready: true, sha256: 'sha', paragraphs: 2, preparedAt: 'date' }
const fetcher = vi.fn()
beforeEach(() => { vi.stubGlobal('fetch', fetcher) })
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
it('prepara somente pelo proxy local em RAM com SHA256 e bearer em header', async () => {
  fetcher.mockResolvedValueOnce(Response.json({ materialId: 'id', ready: false, sha256: 'sha', stage: 'aguardando' }, { status: 202 }))
  await prepareLocalMaterial(access, 'id', metadata, new Uint8Array([1, 2, 3]))
  expect(fetcher.mock.lastCall![0]).toBe('/copiloto/api/acervo/owner/id/preparar')
  const init = fetcher.mock.lastCall![1]
  expect(init.method).toBe('POST')
  expect(init.headers).toEqual({ Authorization: 'Bearer secret' })
  expect(init.body.get('sha256')).toBe('sha')
  expect(init.body.get('titulo')).toBe('Obra')
  expect(init.body.get('autores')).toBe('Autora')
  expect(init.body.get('tipo')).toBe('txt')
  expect(init.body.get('file').size).toBe(3)
  fetcher.mockResolvedValueOnce(Response.json({ materials: [ready] }))
  expect(await listPreparedMaterials(access)).toEqual([ready])
  expect(fetcher.mock.lastCall![0]).toBe('/copiloto/api/acervo/owner')
  expect(fetcher.mock.lastCall![1]).toEqual({ headers: { Authorization: 'Bearer secret' } })
  fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }))
  await removeLocalMaterial(access, 'id')
  expect(fetcher.mock.lastCall![0]).toBe('/copiloto/api/acervo/owner/id')
  expect(fetcher.mock.lastCall![1]).toEqual({ method: 'DELETE', headers: { Authorization: 'Bearer secret' } })
  fetcher.mockResolvedValueOnce(new Response(null, { status: 404 }))
  await removeLocalMaterial(access, 'id')
})
it('recusa preparo falho, retorno adulterado, estado indisponível e remoção falha', async () => {
  for (const response of [Response.json({}, { status: 503 }), Response.json(ready, { status: 503 }), Response.json({ ...ready, materialId: 'other' }), Response.json({ ...ready, ready: false }), Response.json({ ...ready, sha256: 'other' })]) {
    fetcher.mockResolvedValueOnce(response)
    await expect(prepareLocalMaterial(access, 'id', metadata, new Uint8Array([1]))).rejects.toThrow('prepare')
  }
  fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }))
  await expect(listPreparedMaterials(access)).rejects.toThrow('unavailable')
  fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }))
  await expect(removeLocalMaterial(access, 'id')).rejects.toThrow('remove')
})
