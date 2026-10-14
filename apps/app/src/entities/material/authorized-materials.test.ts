import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { webcrypto } from '@limmiar/crypto'
import * as api from './api'
import * as local from './local-material'
import { materialHash, sealMaterial } from './material-crypto'
import { prepareAuthorizedMaterials } from './authorized-materials'
const access = { baseUrl: '', accountId: 'owner', accessToken: 'secret' }
let kek: CryptoKey
let sealed: Awaited<ReturnType<typeof sealMaterial>>
const bytes = new TextEncoder().encode('Fonte bibliográfica privada')
beforeEach(async () => {
  kek = await webcrypto.importKek(new Uint8Array(32).fill(4))
  sealed = await sealMaterial(kek, access.accountId, 'id', { title: 'Obra', authors: 'Autora', reference: '', filename: 'obra.txt', type: 'txt', size: bytes.length, sha256: await materialHash(bytes) }, bytes)
  vi.spyOn(api, 'listMaterials').mockResolvedValue({ ok: true, materials: [{ ...sealed, authorized: true, createdAt: 'date' }] })
  vi.spyOn(api, 'getMaterialContent').mockResolvedValue({ ok: true, ciphertext: sealed.contentCiphertext })
  vi.spyOn(local, 'listPreparedMaterials').mockResolvedValue([])
  vi.spyOn(local, 'prepareLocalMaterial').mockResolvedValue()
})
afterEach(() => vi.restoreAllMocks())
it('lista somente obras autorizadas e prontas sem baixar nem preparar arquivos na sessão', async () => {
  vi.mocked(local.listPreparedMaterials).mockResolvedValue([{ materialId: 'id', ready: true, sha256: await materialHash(bytes), paragraphs: 1, preparedAt: '' }])
  expect(await prepareAuthorizedMaterials(access, kek)).toEqual({ materialIds: ['id'], pending: 0, materials: [{ materialId: 'id', title: 'Obra', ready: true }] })
  expect(api.getMaterialContent).not.toHaveBeenCalled()
  expect(local.prepareLocalMaterial).not.toHaveBeenCalled()
})
it('não libera obra não autorizada mesmo se preparada', async () => {
  vi.mocked(api.listMaterials).mockResolvedValue({ ok: true, materials: [{ ...sealed, authorized: false, createdAt: '' }] })
  expect(await prepareAuthorizedMaterials(access, kek)).toEqual({ materialIds: [], pending: 0, materials: [] })
})
it('obra ausente, em preparação, de outro id ou hash não pode ser selecionada', async () => {
  const hash = await materialHash(bytes)
  for (const prepared of [[], [{ materialId: 'id', ready: false as const, sha256: hash, stage: 'organizando' as const }],
    [{ materialId: 'other', ready: true as const, sha256: hash, paragraphs: 1, preparedAt: '' }],
    [{ materialId: 'id', ready: true as const, sha256: 'wrong', paragraphs: 1, preparedAt: '' }]]) {
    vi.mocked(local.listPreparedMaterials).mockResolvedValue(prepared)
    expect(await prepareAuthorizedMaterials(access, kek)).toEqual({ materialIds: [], pending: 1, materials: [{ materialId: 'id', title: 'Obra', ready: false }] })
  }
})
it('falhas de carteira, estado ou decifração não viram acervo vazio', async () => {
  vi.mocked(api.listMaterials).mockResolvedValueOnce({ ok: false, code: 'materials.not_found', params: {} })
  await expect(prepareAuthorizedMaterials(access, kek)).rejects.toThrow('unavailable')
  vi.mocked(local.listPreparedMaterials).mockRejectedValueOnce(new Error('offline'))
  await expect(prepareAuthorizedMaterials(access, kek)).rejects.toThrow('offline')
  vi.mocked(api.listMaterials).mockResolvedValueOnce({ ok: true, materials: [{ ...sealed, wrappedDek: new Uint8Array(3), authorized: true, createdAt: '' }] })
  await expect(prepareAuthorizedMaterials(access, kek)).rejects.toThrow()
})
