import { describe, expect, it } from 'vitest'
import { webcrypto } from '@limmiar/crypto'
import { materialHash, materialType, MAX_MATERIAL_BYTES, openMaterialContent, openMaterialMetadata, sealMaterial, type MaterialMetadata } from './material-crypto'

const bytes = new TextEncoder().encode('Material privado de referência.')
const metadata: MaterialMetadata = { title: 'Obra privada', authors: 'Autora', reference: 'Edição 2026', filename: 'obra.txt', type: 'txt', size: bytes.length, sha256: '' }
describe('materiais cifrados', () => {
  it('guarda metadados e arquivo sob DEK não extraível e os reabre sob a mesma KEK', async () => {
    const kek = await webcrypto.importKek(new Uint8Array(32).fill(3))
    const sealed = await sealMaterial(kek, 'owner', 'id', metadata, bytes)
    expect(sealed.wrappedDek).toHaveLength(60)
    expect(new TextDecoder().decode(sealed.metadataCiphertext)).not.toContain(metadata.title)
    expect(new TextDecoder().decode(sealed.contentCiphertext)).not.toContain('Material privado')
    const opened = await openMaterialMetadata(kek, 'owner', sealed)
    expect(opened.metadata).toEqual(metadata)
    expect(opened.dek.extractable).toBe(false)
    expect(Array.from(await openMaterialContent(opened.dek, 'owner', 'id', sealed.contentCiphertext))).toEqual(Array.from(bytes))
    await expect(openMaterialMetadata(kek, 'other', sealed)).rejects.toThrow()
    await expect(openMaterialMetadata(kek, 'owner', { ...sealed, materialId: 'other' })).rejects.toThrow()
    await expect(openMaterialContent(opened.dek, 'owner', 'other', sealed.contentCiphertext)).rejects.toThrow()
    await expect(openMaterialContent(opened.dek, 'owner', 'id', sealed.metadataCiphertext)).rejects.toThrow()
    const otherKek = await webcrypto.importKek(new Uint8Array(32).fill(9))
    await expect(openMaterialMetadata(otherKek, 'owner', sealed)).rejects.toThrow()
  })
  it('verifica tipo por bytes e extensão, recusa áudio disfarçado, texto vazio/binário e limites', () => {
    expect(materialType('OBRA.PDF', new TextEncoder().encode('%PDF-1.4\n'))).toBe('pdf')
    expect(materialType('nota.TXT', bytes)).toBe('txt')
    for (const [name, content] of [['x.pdf', bytes], ['x.mp3', bytes], ['x.txt', new Uint8Array()],
      ['x.txt', new TextEncoder().encode('  ')], ['x.txt', new TextEncoder().encode('a\0b')], ['x.txt', new Uint8Array([255])],
      ['x.pdf', new Uint8Array(MAX_MATERIAL_BYTES + 1)]] as const) {
      expect(() => materialType(name, content)).toThrow()
    }
  })
  it('calcula SHA256 do conteúdo canônico do arquivo', async () => {
    expect(await materialHash(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('aceita o tamanho máximo e recusa vazio e maior, cada um com seu motivo', () => {
    const cabecalho = new TextEncoder().encode('%PDF-1.4\n')
    const limite = new Uint8Array(MAX_MATERIAL_BYTES)
    limite.set(cabecalho)
    expect(materialType('x.pdf', limite)).toBe('pdf')
    expect(() => materialType('x.pdf', new Uint8Array(MAX_MATERIAL_BYTES + 1))).toThrow('material.size')
    expect(() => materialType('x.txt', new Uint8Array())).toThrow('material.size')
  })
  it('só confia na extensão certa: texto com cabeçalho de PDF e PDF sem cabeçalho', () => {
    expect(materialType('notas.txt', new TextEncoder().encode('%PDF-1.4 texto comum'))).toBe('txt')
    expect(() => materialType('x.pdf', new TextEncoder().encode('texto comum'))).toThrow('material.type')
    expect(() => materialType('x.mp3', bytes)).toThrow('material.type')
  })
})
