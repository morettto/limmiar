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
it('restaura arquivo cifrado após reinício, verifica hash e envia plaintext somente ao motor local', async () => {
  expect(await prepareAuthorizedMaterials(access, kek)).toEqual({ materialIds: ['id'], pending: 0 })
  expect(local.prepareLocalMaterial).toHaveBeenCalledWith(access, 'id', expect.objectContaining({ title: 'Obra' }), expect.anything())
  expect(Array.from(vi.mocked(local.prepareLocalMaterial).mock.lastCall![3])).toEqual(Array.from(bytes))
})
it('reusa somente materiais próprios autorizados com o mesmo hash; a consulta de estado não publica nada', async () => {
  vi.mocked(local.listPreparedMaterials).mockResolvedValue([{ materialId: 'other', ready: true, sha256: 'sha', paragraphs: 1, preparedAt: '' },
    { materialId: 'id', ready: true, sha256: await materialHash(bytes), paragraphs: 1, preparedAt: '' }])
  expect(await prepareAuthorizedMaterials(access, kek)).toEqual({ materialIds: ['id'], pending: 0 })
  expect(api.getMaterialContent).not.toHaveBeenCalled()
  expect(local.prepareLocalMaterial).not.toHaveBeenCalled()
  vi.mocked(api.listMaterials).mockResolvedValue({ ok: true, materials: [{ ...sealed, authorized: false, createdAt: '' }] })
  expect(await prepareAuthorizedMaterials(access, kek)).toEqual({ materialIds: [], pending: 0 })
})
it('prepara hash obsoleto e conta falhas sem autorizar ou considerar pronto', async () => {
  vi.mocked(local.listPreparedMaterials).mockRejectedValue(new Error('motor parado'))
  vi.mocked(local.prepareLocalMaterial).mockRejectedValue(new Error('falha'))
  expect(await prepareAuthorizedMaterials(access, kek)).toEqual({ materialIds: [], pending: 1 })
  vi.mocked(api.getMaterialContent).mockResolvedValue({ ok: false, code: 'materials.not_found', params: {} })
  expect(await prepareAuthorizedMaterials(access, kek)).toEqual({ materialIds: [], pending: 1 })
  const corrupted = await sealMaterial(kek, access.accountId, 'id', { title: '', authors: '', reference: '', filename: '', type: 'txt', size: bytes.length, sha256: 'wrong' }, bytes)
  vi.mocked(api.listMaterials).mockResolvedValue({ ok: true, materials: [{ ...corrupted, authorized: true, createdAt: '' }] })
  vi.mocked(api.getMaterialContent).mockResolvedValue({ ok: true, ciphertext: corrupted.contentCiphertext })
  expect(await prepareAuthorizedMaterials(access, kek)).toEqual({ materialIds: [], pending: 1 })
})
it('recusa carteira indisponível antes de acessar qualquer arquivo', async () => {
  vi.mocked(api.listMaterials).mockResolvedValue({ ok: false, code: 'auth.invalid_credentials', params: {} })
  await expect(prepareAuthorizedMaterials(access, kek)).rejects.toThrow('unavailable')
  expect(api.getMaterialContent).not.toHaveBeenCalled()
})
it('com o motor local parado ainda prepara o que está autorizado', async () => {
  vi.mocked(local.listPreparedMaterials).mockRejectedValue(new Error('motor parado'))
  expect(await prepareAuthorizedMaterials(access, kek)).toEqual({ materialIds: ['id'], pending: 0 })
  expect(local.prepareLocalMaterial).toHaveBeenCalledOnce()
})
it.each([
  ['outro material com o mesmo hash', { materialId: 'other', ready: true, sha256: 'HASH' }],
  ['o mesmo material com hash diferente', { materialId: 'id', ready: true, sha256: 'diferente' }],
  ['o mesmo material ainda não pronto', { materialId: 'id', ready: false, sha256: 'HASH' }],
])('prepara de novo quando o estado local só tem %s', async (_nome, estado) => {
  const sha256 = await materialHash(bytes)
  vi.mocked(local.listPreparedMaterials).mockResolvedValue([{ ...estado, sha256: estado.sha256 === 'HASH' ? sha256 : estado.sha256, paragraphs: 1, preparedAt: '' } as local.PreparedMaterial])
  expect(await prepareAuthorizedMaterials(access, kek)).toEqual({ materialIds: ['id'], pending: 0 })
  expect(api.getMaterialContent).toHaveBeenCalledOnce()
  expect(local.prepareLocalMaterial).toHaveBeenCalledOnce()
})
it('nunca entrega ao motor local um arquivo cujo hash não confere nem um conteúdo indisponível', async () => {
  vi.mocked(api.getMaterialContent).mockResolvedValue({ ok: false, code: 'materials.not_found', params: {} })
  expect(await prepareAuthorizedMaterials(access, kek)).toEqual({ materialIds: [], pending: 1 })
  expect(local.prepareLocalMaterial).not.toHaveBeenCalled()
  const corrompido = await sealMaterial(kek, access.accountId, 'id', { title: '', authors: '', reference: '', filename: '', type: 'txt', size: bytes.length, sha256: 'errado' }, bytes)
  vi.mocked(api.listMaterials).mockResolvedValue({ ok: true, materials: [{ ...corrompido, authorized: true, createdAt: '' }] })
  vi.mocked(api.getMaterialContent).mockResolvedValue({ ok: true, ciphertext: corrompido.contentCiphertext })
  expect(await prepareAuthorizedMaterials(access, kek)).toEqual({ materialIds: [], pending: 1 })
  expect(local.prepareLocalMaterial).not.toHaveBeenCalled()
})
