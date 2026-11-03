import type { Page } from '@playwright/test'
import { unlockVault, type VaultDocument } from '../../src/entities/clinical-vault/crypto'
import { webcrypto } from '@limmiar/crypto'
import { DIMENSOES_VOZ, MODELO_VOZ } from '../../src/entities/voz/modelo'

export async function perfilDeVozSintetico(accountId: string, key: string, document: VaultDocument) {
  const kek = await unlockVault(accountId, key, document)
  const encoder = new TextEncoder()
  const { dek, wrapped } = await webcrypto.generateWrappedDek(kek, encoder.encode(`limmiar/voice-dek/titanet-large/v1|${MODELO_VOZ}|${accountId}`))
  const plain = new Uint8Array(DIMENSOES_VOZ * 4)
  const view = new DataView(plain.buffer)
  for (let i = 0; i < DIMENSOES_VOZ; i++) view.setFloat32(i * 4, .1, true)
  const sealed = await webcrypto.encrypt(dek, plain, encoder.encode(`limmiar/voice-embedding/titanet-large/v1|${MODELO_VOZ}|${accountId}`))
  plain.fill(0)
  return { wrappedDek: Buffer.from(wrapped).toString('base64'), sealedEmbedding: Buffer.from(sealed).toString('base64') }
}

export async function prepararVozSintetica(page: Page, key: string) {
  await page.route('**/accounts/*/voice-enrollment', async route => {
    const request = route.request()
    const url = request.url()
    const accountId = url.split('/accounts/')[1]!.split('/')[0]!
    const headers = request.headers()
    const vault = await page.request.get(url.replace('/voice-enrollment', '/clinical-vault'), { headers })
    const data = await perfilDeVozSintetico(accountId, key, await vault.json())
    const saved = await page.request.put(url, { headers, data })
    if (saved.status() !== 204) throw new Error(`Synthetic voice fixture failed: ${saved.status()}`)
    await route.continue()
  }, { times: 1 })
}
