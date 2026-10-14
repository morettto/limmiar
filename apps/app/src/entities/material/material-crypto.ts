import { type CryptoKey, webcrypto } from '@limmiar/crypto'

export const MAX_MATERIAL_BYTES = 20 * 1024 * 1024
export type MaterialType = 'pdf' | 'txt'
export interface MaterialMetadata {
  title: string
  authors: string
  reference: string
  filename: string
  type: MaterialType
  size: number
  sha256: string
}
export interface SealedMaterial {
  materialId: string
  wrappedDek: Uint8Array<ArrayBuffer>
  metadataCiphertext: Uint8Array<ArrayBuffer>
  contentCiphertext: Uint8Array<ArrayBuffer>
}

function aad(accountId: string, materialId: string, purpose: string) {
  return new TextEncoder().encode(`limmiar/material/v1|${accountId}|${materialId}|${purpose}`)
}

export async function materialHash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(await webcrypto.sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function materialType(filename: string, bytes: Uint8Array<ArrayBuffer>): MaterialType {
  if (bytes.length === 0 || bytes.length > MAX_MATERIAL_BYTES) throw new Error('material.size')
  if (filename.toLowerCase().endsWith('.pdf') && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-') return 'pdf'
  if (filename.toLowerCase().endsWith('.txt')) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (text.trim() && !text.includes('\0')) return 'txt'
  }
  throw new Error('material.type')
}

export async function sealMaterial(kek: CryptoKey, accountId: string, materialId: string, metadata: MaterialMetadata, bytes: Uint8Array<ArrayBuffer>): Promise<SealedMaterial> {
  const { dek, wrapped } = await webcrypto.generateWrappedDek(kek, aad(accountId, materialId, 'dek'))
  const [metadataCiphertext, contentCiphertext] = await Promise.all([
    webcrypto.encrypt(dek, new TextEncoder().encode(JSON.stringify(metadata)), aad(accountId, materialId, 'metadata')),
    webcrypto.encrypt(dek, bytes, aad(accountId, materialId, 'content')),
  ])
  return { materialId, wrappedDek: wrapped, metadataCiphertext, contentCiphertext }
}

export async function openMaterialMetadata(kek: CryptoKey, accountId: string, material: Pick<SealedMaterial, 'materialId' | 'wrappedDek' | 'metadataCiphertext'>): Promise<{ metadata: MaterialMetadata; dek: CryptoKey }> {
  const dek = await webcrypto.unwrapDek(kek, material.wrappedDek, aad(accountId, material.materialId, 'dek'))
  const plaintext = await webcrypto.decrypt(dek, material.metadataCiphertext, aad(accountId, material.materialId, 'metadata'))
  const metadata = JSON.parse(new TextDecoder().decode(plaintext)) as MaterialMetadata
  return { metadata, dek }
}

export function openMaterialContent(dek: CryptoKey, accountId: string, materialId: string, ciphertext: Uint8Array<ArrayBuffer>) {
  return webcrypto.decrypt(dek, ciphertext, aad(accountId, materialId, 'content'))
}
