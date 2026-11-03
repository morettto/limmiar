import { afterEach, describe, expect, it, vi } from 'vitest'
import { getVault, saveVault } from './api'
import { createVault } from './crypto'

const account = { baseUrl: 'https://api.example.test', accountId: '11111111-1111-4111-8111-111111111111', accessToken: 'test-token' }
afterEach(() => vi.unstubAllGlobals())
describe('contrato HTTP do cofre', () => {
  it('confirma o envelope exato se a conexão cai depois do commit, sem gerar outro kit', async () => {
    const { document } = await createVault(account.accountId)
    const fetch = vi.fn().mockRejectedValueOnce(new Error('lost acknowledgement'))
      .mockResolvedValueOnce(new Response(JSON.stringify(document)))
    vi.stubGlobal('fetch', fetch)
    await expect(saveVault(account, document)).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(2)
    const other = await createVault(account.accountId)
    fetch.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(new Response(JSON.stringify(other.document)))
    await expect(saveVault(account, document)).rejects.toThrow()
  })
  it('só trata ausência explícita como primeiro acesso; erros nunca geram chave nova', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'clinical_vault.not_found', params: {} }), { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    await expect(getVault(account)).resolves.toBeNull()
    expect(fetch).toHaveBeenCalledWith(`${account.baseUrl}/accounts/${account.accountId}/clinical-vault`, { headers: { Authorization: 'Bearer test-token' } })
    fetch.mockResolvedValue(new Response(JSON.stringify({ code: 'auth.forbidden', params: {} }), { status: 403 }))
    await expect(getVault(account)).rejects.toThrow()
    fetch.mockRejectedValue(new Error('network'))
    await expect(getVault(account)).rejects.toThrow()
  })

  it('valida envelopes, revisão e slots recebidos', async () => {
    const { document } = await createVault(account.accountId)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    for (const invalid of [null, {}, { ...document, revision: '' }, { ...document, keyEnvelope: 'A' },
      { ...document, recoverySlots: [] }, { ...document, recoverySlots: [null, null, null] },
      { ...document, recoverySlots: [document.recoverySlots[0], document.recoverySlots[0], document.recoverySlots[0]] }]) {
      fetch.mockResolvedValue(new Response(JSON.stringify(invalid)))
      await expect(getVault(account)).rejects.toThrow()
    }
    fetch.mockResolvedValue(new Response(JSON.stringify(document)))
    await expect(getVault(account)).resolves.toEqual(document)
  })

  it('envia só envelopes e prova derivada, sem os segredos, na criação e recuperação', async () => {
    const prepared = await createVault(account.accountId)
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })))
    vi.stubGlobal('fetch', fetch)
    await saveVault(account, prepared.document)
    const proof = { expectedRevision: crypto.randomUUID(), recoveryId: crypto.randomUUID(), recoveryVerifier: 'opaque-verifier' }
    await saveVault(account, prepared.document, proof)
    expect(fetch.mock.calls[1]![0]).toBe(`${account.baseUrl}/accounts/${account.accountId}/clinical-vault/recover`)
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({ ...proof, document: prepared.document })
    for (const secret of [prepared.key, ...prepared.recoveryCodes]) expect(JSON.stringify(fetch.mock.calls)).not.toContain(secret)
    fetch.mockResolvedValue(new Response(JSON.stringify({ code: 'clinical_vault.conflict', params: {} }), { status: 409 }))
    await expect(saveVault(account, prepared.document)).rejects.toThrow()
    fetch.mockResolvedValue(new Response(null, { status: 200 }))
    await expect(saveVault(account, prepared.document)).rejects.toThrow()
  })
})
