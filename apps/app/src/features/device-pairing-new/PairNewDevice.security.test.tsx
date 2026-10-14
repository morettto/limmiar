import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { deriveChannelKey, encrypt, generateKeyPair, getSharedSecret, webcrypto } from '@limmiar/crypto'
import { i18n, dynamicActivate } from '../../shared/i18n'
import { decodeBase64, encodeBase64 } from '../../shared/lib/base64'
import * as api from '../../entities/device/api'
import { preparePairingChannel } from '../../entities/device/pairing-channel'
import { PairNewDevice } from './PairNewDevice'

vi.mock('../../entities/device/api', async () => ({ ...await vi.importActual('../../entities/device/api'), claimPairingSession: vi.fn(), fetchPairingPayload: vi.fn() }))
vi.mock('../../entities/device/pairing-channel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../entities/device/pairing-channel')>()
  return { ...actual, preparePairingChannel: vi.fn(actual.preparePairingChannel) }
})
const BASE = 'http://api.test', SESSION = 'session'

function start(adopt = vi.fn<(key: Uint8Array) => void | Promise<void>>(), peer = generateKeyPair()) {
  const key = encodeBase64(peer.publicKey)
  vi.mocked(api.claimPairingSession).mockResolvedValue({ ok: true, primaryPublicKey: key })
  const view = render(<I18nProvider i18n={i18n}><PairNewDevice baseUrl={BASE} decode={async () => JSON.stringify({ s: SESSION, k: key, u: BASE })} onKekAdopted={adopt} /></I18nProvider>)
  return { ...view, adopt, peer }
}
function payload(peer: ReturnType<typeof generateKeyPair>, raw: Uint8Array) {
  const device = decodeBase64(vi.mocked(api.claimPairingSession).mock.calls[0]![2])
  const salt = new TextEncoder().encode(SESSION)
  const channel = deriveChannelKey(getSharedSecret(peer.privateKey, device), salt)
  return { ok: true as const, encryptedKek: encodeBase64(encrypt(channel, raw, salt)) }
}

describe('proteção do dispositivo que recebe a chave', () => {
  beforeAll(async () => { await dynamicActivate('pt-BR') })
  afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks() })
  it('uma falha de rede termina a espera sem adotar qualquer chave', async () => {
    vi.mocked(api.fetchPairingPayload).mockRejectedValue(new Error('network unavailable'))
    const view = start()
    expect((await screen.findByRole('alert')).textContent).toContain('com segurança')
    expect(view.adopt).not.toHaveBeenCalled()
  })
  it('ignora a falha de rede que chega depois de sair', async () => {
    let reject!: (error: Error) => void
    vi.mocked(api.fetchPairingPayload).mockImplementation(() => new Promise((_yes, no) => { reject = no }))
    const view = start()
    await vi.waitFor(() => expect(api.fetchPairingPayload).toHaveBeenCalledOnce())
    view.unmount()
    reject(new Error('network unavailable'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(view.adopt).not.toHaveBeenCalled()
  })
  it('recusa um ponto público sem segredo compartilhado válido', async () => {
    const peer = { publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) }
    const view = start(undefined, peer)
    await screen.findByRole('alert')
    expect(api.fetchPairingPayload).not.toHaveBeenCalled()
    expect(view.adopt).not.toHaveBeenCalled()
  })
  it('recusa uma cifra autêntica cujo conteúdo não tem tamanho de KEK', async () => {
    const peer = generateKeyPair()
    vi.mocked(api.fetchPairingPayload).mockImplementation(async () => payload(peer, new Uint8Array(31)))
    const view = start(undefined, peer)
    expect((await screen.findByRole('alert')).textContent).toContain('decifrar')
    expect(view.adopt).not.toHaveBeenCalled()
  })
  it.each([true, false])('sempre zera a chave recebida se a adoção terminar após sair (erro: %s)', async fails => {
    const peer = generateKeyPair()
    vi.mocked(api.fetchPairingPayload).mockImplementation(async () => payload(peer, new Uint8Array(32).fill(9)))
    let resolve!: () => void, reject!: (error: Error) => void, raw: Uint8Array | undefined
    const adopt = vi.fn((key: Uint8Array) => { raw = key; return new Promise<void>((yes, no) => { resolve = yes; reject = no }) })
    const view = start(adopt, peer)
    await vi.waitFor(() => expect(adopt).toHaveBeenCalledOnce())
    view.unmount()
    if (fails) reject(new Error('adoption failed')); else resolve()
    await vi.waitFor(() => expect(raw).toEqual(new Uint8Array(32)))
  })
  it('mostra a falha de importação e zera a chave sem confirmar sucesso', async () => {
    const peer = generateKeyPair()
    vi.mocked(api.fetchPairingPayload).mockImplementation(async () => payload(peer, new Uint8Array(32).fill(9)))
    let raw: Uint8Array | undefined
    const adopt = vi.fn(async (key: Uint8Array) => { raw = key; throw new Error('key import failed') })
    start(adopt, peer)
    await screen.findByRole('alert')
    expect(raw).toEqual(new Uint8Array(32))
    expect(screen.queryByText('Dispositivo pareado com sucesso.')).toBeNull()
  })
  it.each([true, false])('ignora o cálculo do código de uma página encerrada (erro: %s)', async fails => {
    let resolve!: (bytes: Uint8Array<ArrayBuffer>) => void, reject!: (error: Error) => void
    const sha = vi.spyOn(webcrypto, 'sha256').mockImplementationOnce(() => new Promise((yes, no) => { resolve = yes; reject = no }))
    const view = start()
    await vi.waitFor(() => expect(sha).toHaveBeenCalledOnce())
    view.unmount()
    if (fails) reject(new Error('digest failed')); else resolve(new Uint8Array(32))
    await new Promise(yes => setTimeout(yes, 0))
    expect(api.fetchPairingPayload).not.toHaveBeenCalled()
    expect(view.adopt).not.toHaveBeenCalled()
    if (!fails) {
      const { channelKey } = await vi.mocked(preparePairingChannel).mock.results.at(-1)!.value as { channelKey: Uint8Array }
      expect(channelKey.every(byte => byte === 0)).toBe(true)
    }
  })
  it('a falha ao preparar o canal mostra a mensagem de segurança', async () => {
    const peer = { publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) }
    start(undefined, peer)
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível concluir o pareamento com segurança. Tente novamente.')
  })
})
