import { describe, expect, it } from 'vitest'
import { webcrypto } from '@limmiar/crypto'
import { createVault, recoverVault, unlockVault } from './crypto'

const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const aad = new TextEncoder().encode('prontuario|paciente-sintetico')

describe('cofre clínico independente do login', () => {
  it('gera segredos únicos e abre o prontuário sem guardar segredos no documento', async () => {
    const created = await createVault(ACCOUNT)
    const other = await createVault(ACCOUNT)
    expect(new Set([created.key, ...created.recoveryCodes, other.key, ...other.recoveryCodes]).size).toBe(8)
    const serialized = JSON.stringify(created.document)
    for (const secret of [created.key, ...created.recoveryCodes]) {
      expect(serialized).not.toContain(secret)
      expect(serialized).not.toContain(secret.split('.').at(-1))
    }
    const { dek, wrapped } = await webcrypto.generateWrappedDek(created.kek, aad)
    const ciphertext = await webcrypto.encrypt(dek, new TextEncoder().encode('Prontuário sintético'), aad)
    const unlocked = await unlockVault(ACCOUNT, created.key, created.document)
    expect(unlocked.extractable).toBe(false)
    expect(unlocked.usages.sort()).toEqual(['unwrapKey', 'wrapKey'])
    await expect(crypto.subtle.exportKey('raw', unlocked)).rejects.toThrow()
    const openedDek = await webcrypto.unwrapDek(unlocked, wrapped, aad)
    expect(new TextDecoder().decode(await webcrypto.decrypt(openedDek, ciphertext, aad))).toBe('Prontuário sintético')
  })

  it('recusa outra conta, senha de login, chave de outro cofre e envelope adulterado', async () => {
    const created = await createVault(ACCOUNT)
    const other = await createVault(ACCOUNT)
    await expect(unlockVault('outra-conta', created.key, created.document)).rejects.toThrow()
    await expect(unlockVault(ACCOUNT, 'senha-de-login', created.document)).rejects.toThrow()
    await expect(unlockVault(ACCOUNT, other.key, created.document)).rejects.toThrow()
    await expect(unlockVault(ACCOUNT, created.key, { ...created.document, revision: crypto.randomUUID() })).rejects.toThrow()
    const bytes = atob(created.document.keyEnvelope)
    const corrupted = btoa(String.fromCharCode(bytes.charCodeAt(0) ^ 1) + bytes.slice(1))
    await expect(unlockVault(ACCOUNT, created.key, { ...created.document, keyEnvelope: corrupted })).rejects.toThrow()
  })

  it.each([0, 1, 2])('recupera com o código %s, preserva dados e substitui todos os segredos', async index => {
    const created = await createVault(ACCOUNT)
    const { wrapped } = await webcrypto.generateWrappedDek(created.kek, aad)
    const { prepared, recoveryId, recoveryVerifier } = await recoverVault(ACCOUNT, created.recoveryCodes[index]!, created.document)
    expect(recoveryId).toBe(created.document.recoverySlots[index]!.id)
    expect(recoveryVerifier).toBe(created.document.recoverySlots[index]!.verifier)
    const unlocked = await unlockVault(ACCOUNT, prepared.key, prepared.document)
    await expect(webcrypto.unwrapDek(unlocked, wrapped, aad)).resolves.toBeDefined()
    await expect(unlockVault(ACCOUNT, created.key, prepared.document)).rejects.toThrow()
    for (const code of created.recoveryCodes) await expect(recoverVault(ACCOUNT, code, prepared.document)).rejects.toThrow()
    await expect(recoverVault(ACCOUNT, prepared.recoveryCodes[0]!, prepared.document)).resolves.toBeDefined()
  })

  it('não troca slots, contas ou tipos de segredo para recuperar', async () => {
    const created = await createVault(ACCOUNT)
    await expect(recoverVault(ACCOUNT, created.key, created.document)).rejects.toThrow()
    await expect(recoverVault('outra', created.recoveryCodes[0]!, created.document)).rejects.toThrow()
    const changed = created.recoveryCodes[0]!.replace(created.document.recoverySlots[0]!.id, created.document.recoverySlots[1]!.id)
    await expect(recoverVault(ACCOUNT, changed, created.document)).rejects.toThrow()
  })
})
