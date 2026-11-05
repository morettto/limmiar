import { request } from '../../shared/api/client'
import type { VaultDocument, VaultWrite } from './crypto'

export interface VaultAccount { baseUrl: string; accountId: string; accessToken: string }
const path = (accountId: string) => `/accounts/${accountId}/clinical-vault`
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const envelope = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9+/]{80}$/.test(value)

export async function getVault(account: VaultAccount): Promise<VaultDocument | null> {
  const result = await request(account.baseUrl, 'GET', path(account.accountId), undefined, account.accessToken)
  if (!result.ok) {
    if (result.code === 'clinical_vault.not_found') return null
    throw new Error('Vault unavailable')
  }
  const document = await result.response.json() as VaultDocument
  if (!document || typeof document.revision !== 'string' || !uuid.test(document.revision) || !envelope(document.keyEnvelope) ||
    !Array.isArray(document.recoverySlots) || document.recoverySlots.length !== 3 ||
    document.recoverySlots.some(slot => !slot || typeof slot.id !== 'string' || !uuid.test(slot.id) || !envelope(slot.envelope)) ||
    new Set(document.recoverySlots.map(slot => slot.id)).size !== 3) throw new Error('Invalid vault document')
  return document
}

export async function saveVault(account: VaultAccount, document: VaultWrite, recovery?: {
  expectedRevision: string; recoveryId: string; recoveryVerifier: string
}): Promise<void> {
  try {
    const result = await request(account.baseUrl, 'POST', path(account.accountId) + (recovery ? '/recover' : ''),
      recovery ? { ...recovery, document } : document, account.accessToken)
    if (result.ok && result.response.status === 204) return
  } catch { /* O commit pode ter terminado antes de a conexão cair. */ }
  const current = await getVault(account)
  if (current?.revision === document.revision && current.keyEnvelope === document.keyEnvelope &&
    current.recoverySlots.every((slot, index) => slot.id === document.recoverySlots[index]!.id && slot.envelope === document.recoverySlots[index]!.envelope)) return
  throw new Error('Vault could not be saved')
}
