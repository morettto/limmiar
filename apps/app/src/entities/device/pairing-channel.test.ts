import { describe, expect, it, vi } from 'vitest'
import { deriveChannelKey, generateKeyPair, getSharedSecret, webcrypto } from '@limmiar/crypto'
import { encodeBase64 } from '../../shared/lib/base64'
import { preparePairingChannel } from './pairing-channel'

vi.mock('@limmiar/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@limmiar/crypto')>()
  return { ...actual, deriveChannelKey: vi.fn(actual.deriveChannelKey) }
})

describe('confirmação do canal entre dispositivos', () => {
  it('zera o material de confirmação se o digest falhar', async () => {
    const primary = generateKeyPair(), secondary = generateKeyPair()
    let input: Uint8Array | undefined
    const spy = vi.spyOn(webcrypto, 'sha256').mockImplementationOnce(async bytes => { input = bytes; throw new Error('digest unavailable') })
    try {
      await expect(preparePairingChannel(primary.privateKey, encodeBase64(secondary.publicKey), 'sessao')).rejects.toThrow('digest unavailable')
      expect(input!.every(byte => byte === 0)).toBe(true)
    } finally { spy.mockRestore() }
  })
  it('os dois lados exibem o mesmo código e substituição ou outra sessão muda o código', async () => {
    const primary = generateKeyPair(), secondary = generateKeyPair(), attacker = generateKeyPair()
    const a = await preparePairingChannel(primary.privateKey, encodeBase64(secondary.publicKey), 'sessao')
    const b = await preparePairingChannel(secondary.privateKey, encodeBase64(primary.publicKey), 'sessao')
    const c = await preparePairingChannel(primary.privateKey, encodeBase64(attacker.publicKey), 'sessao')
    const d = await preparePairingChannel(primary.privateKey, encodeBase64(secondary.publicKey), 'outra-sessao')
    expect(a.code).toMatch(/^[0-9A-F]{4}( [0-9A-F]{4}){3}$/)
    expect(a.code).toBe(b.code)
    expect(a.channelKey).toEqual(b.channelKey)
    expect(a.code).not.toBe(c.code)
    expect(a.code).not.toBe(d.code)
  })
  it('recusa chaves truncadas e pontos sem segredo compartilhado válido', async () => {
    const primary = generateKeyPair()
    await expect(preparePairingChannel(primary.privateKey, encodeBase64(new Uint8Array(31)), 'sessao')).rejects.toThrow('Invalid pairing public key')
    await expect(preparePairingChannel(primary.privateKey, encodeBase64(new Uint8Array(33)), 'sessao')).rejects.toThrow('Invalid pairing public key')
    await expect(preparePairingChannel(primary.privateKey, encodeBase64(new Uint8Array(32)), 'sessao')).rejects.toThrow()
  })
  it('o código é o resumo SHA-256 do domínio, da sessão e da chave do canal, em quatro grupos hexadecimais', async () => {
    const primary = generateKeyPair(), secondary = generateKeyPair()
    for (let indice = 0; indice < 24; indice++) {
      const sessao = `sessao-${indice}`
      const { channelKey, code } = await preparePairingChannel(primary.privateKey, encodeBase64(secondary.publicKey), sessao)
      const entrada = new Uint8Array([...new TextEncoder().encode(`limmiar/pairing-confirmation/v1|${sessao}|`), ...channelKey])
      const resumo = new Uint8Array(await crypto.subtle.digest('SHA-256', entrada)).slice(0, 8)
      const hex = Array.from(resumo, (byte) => (byte < 16 ? '0' : '') + byte.toString(16)).join('').toUpperCase()
      expect(code).toBe(`${hex.slice(0, 4)} ${hex.slice(4, 8)} ${hex.slice(8, 12)} ${hex.slice(12)}`)
    }
  })
  it('zera o segredo compartilhado depois de derivar a chave do canal', async () => {
    const primary = generateKeyPair(), secondary = generateKeyPair()
    await preparePairingChannel(primary.privateKey, encodeBase64(secondary.publicKey), 'sessao')
    const segredo = vi.mocked(deriveChannelKey).mock.lastCall![0]
    expect(segredo).toHaveLength(getSharedSecret(primary.privateKey, secondary.publicKey).length)
    expect(segredo.every((byte) => byte === 0)).toBe(true)
  })
})
