import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { generateKeyPair, webcrypto } from '@limmiar/crypto'
import { i18n, dynamicActivate } from '../../shared/i18n'
import { encodeBase64 } from '../../shared/lib/base64'
import * as api from '../../entities/device/api'
import { preparePairingChannel } from '../../entities/device/pairing-channel'
import { PairPrimaryDevice } from './PairPrimaryDevice'

vi.mock('../../entities/device/api', () => ({ createPairingSession: vi.fn(), getPairingClaimStatus: vi.fn(), submitPairingPayload: vi.fn() }))
vi.mock('../../entities/device/pairing-channel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../entities/device/pairing-channel')>()
  return { ...actual, preparePairingChannel: vi.fn(actual.preparePairingChannel) }
})
const canalAtual = async () => (await vi.mocked(preparePairingChannel).mock.results.at(-1)!.value) as { channelKey: Uint8Array }

async function flush(ready: () => boolean) {
  for (let n = 0; n < 500 && !ready(); n++) await vi.advanceTimersByTimeAsync(0)
  expect(ready()).toBe(true)
}
async function start(getKekForTransfer: () => Promise<Uint8Array>, key = encodeBase64(generateKeyPair().publicKey)) {
  vi.mocked(api.createPairingSession).mockResolvedValue({ ok: true, sessionId: 'session', expiresAt: new Date(Date.now() + 120000).toISOString() })
  vi.mocked(api.getPairingClaimStatus).mockResolvedValue({ ok: true, claimed: true, newDevicePublicKey: key })
  vi.mocked(api.submitPairingPayload).mockResolvedValue({ ok: true })
  const delivered = vi.fn()
  const view = render(<I18nProvider i18n={i18n}><PairPrimaryDevice baseUrl="http://api.test" accountId="account" accessToken="token" getKekForTransfer={getKekForTransfer} onDelivered={delivered} /></I18nProvider>)
  await flush(() => screen.queryByRole('img') !== null)
  await vi.advanceTimersByTimeAsync(1000)
  return { ...view, delivered }
}
function confirm() { fireEvent.click(screen.getByRole('button', { name: 'Os códigos são iguais. Liberar acesso.' })) }

describe('proteção da transferência de chave', () => {
  beforeAll(async () => { await dynamicActivate('pt-BR') })
  afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.useRealTimers() })
  it('cancelar a comparação não pede senha nem transmite chave', async () => {
    vi.useFakeTimers()
    const provider = vi.fn()
    await start(provider)
    await flush(() => screen.queryByTestId('pairing-confirmation') !== null)
    const canal = await canalAtual()
    expect(canal.channelKey.some(byte => byte !== 0)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar pareamento' }))
    expect(canal.channelKey.every(byte => byte === 0)).toBe(true)
    expect(screen.getByRole('alert').textContent).toBe('Pareamento cancelado. Nenhuma chave foi enviada.')
    expect(provider).not.toHaveBeenCalled()
    expect(api.submitPairingPayload).not.toHaveBeenCalled()
  })
  it('recusa a chave pública inválida antes de acessar a KEK', async () => {
    vi.useFakeTimers()
    const provider = vi.fn()
    await start(provider, encodeBase64(new Uint8Array(31)))
    await flush(() => screen.queryByRole('alert') !== null)
    expect(screen.getByRole('alert').textContent).toBe('Não foi possível concluir o pareamento com segurança. Tente novamente.')
    expect(provider).not.toHaveBeenCalled()
    expect(api.submitPairingPayload).not.toHaveBeenCalled()
  })
  it('zera uma KEK de tamanho inválido sem enviá-la', async () => {
    vi.useFakeTimers()
    const key = new Uint8Array(31).fill(7)
    await start(vi.fn().mockResolvedValue(key))
    await flush(() => screen.queryByTestId('pairing-confirmation') !== null)
    confirm()
    await flush(() => screen.queryByRole('alert') !== null)
    expect(key).toEqual(new Uint8Array(31))
    expect(api.submitPairingPayload).not.toHaveBeenCalled()
  })
  it('duas confirmações juntas liberam a chave uma única vez', async () => {
    vi.useFakeTimers()
    const provider = vi.fn().mockResolvedValue(new Uint8Array(32).fill(7))
    await start(provider)
    await flush(() => screen.queryByTestId('pairing-confirmation') !== null)
    const button = screen.getByRole('button', { name: 'Os códigos são iguais. Liberar acesso.' })
    act(() => { button.click(); button.click() })
    await flush(() => vi.mocked(api.submitPairingPayload).mock.calls.length > 0)
    expect(provider).toHaveBeenCalledOnce()
    expect(api.submitPairingPayload).toHaveBeenCalledOnce()
  })
  it('cancelamento seguido de confirmação atrasada não libera acesso', async () => {
    vi.useFakeTimers()
    const provider = vi.fn()
    await start(provider)
    await flush(() => screen.queryByTestId('pairing-confirmation') !== null)
    const confirmButton = screen.getByRole('button', { name: 'Os códigos são iguais. Liberar acesso.' })
    const cancelButton = screen.getByRole('button', { name: 'Cancelar pareamento' })
    act(() => { cancelButton.click(); confirmButton.click() })
    expect(provider).not.toHaveBeenCalled()
    expect(api.submitPairingPayload).not.toHaveBeenCalled()
  })
  it('saída antes de reconstituir a chave zera a resposta tardia', async () => {
    vi.useFakeTimers()
    let resolve!: (key: Uint8Array) => void
    const provider = vi.fn(() => new Promise<Uint8Array>(yes => { resolve = yes }))
    const view = await start(provider)
    await flush(() => screen.queryByTestId('pairing-confirmation') !== null)
    confirm()
    view.unmount()
    const key = new Uint8Array(32).fill(8)
    resolve(key)
    await flush(() => key.every(byte => byte === 0))
    expect(api.submitPairingPayload).not.toHaveBeenCalled()
  })
  it('falha de reconstituição depois de sair não continua a transferência', async () => {
    vi.useFakeTimers()
    let reject!: (error: Error) => void
    const view = await start(() => new Promise<Uint8Array>((_yes, no) => { reject = no }))
    await flush(() => screen.queryByTestId('pairing-confirmation') !== null)
    confirm()
    view.unmount()
    reject(new Error('cancelled'))
    await vi.advanceTimersByTimeAsync(0)
    expect(api.submitPairingPayload).not.toHaveBeenCalled()
  })
  it('resposta de entrega depois de sair não reabre a sessão', async () => {
    vi.useFakeTimers()
    const view = await start(async () => new Uint8Array(32).fill(8))
    let resolve!: (value: Awaited<ReturnType<typeof api.submitPairingPayload>>) => void
    vi.mocked(api.submitPairingPayload).mockImplementation(() => new Promise(yes => { resolve = yes }))
    await flush(() => screen.queryByTestId('pairing-confirmation') !== null)
    confirm()
    await flush(() => vi.mocked(api.submitPairingPayload).mock.calls.length > 0)
    view.unmount()
    resolve({ ok: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(view.delivered).not.toHaveBeenCalled()
  })
  it.each([true, false])('não continua uma derivação encerrada antes de terminar (erro: %s)', async fails => {
    vi.useFakeTimers()
    let resolve!: (bytes: Uint8Array<ArrayBuffer>) => void, reject!: (error: Error) => void
    const sha = vi.spyOn(webcrypto, 'sha256').mockImplementationOnce(() => new Promise((yes, no) => { resolve = yes; reject = no }))
    const provider = vi.fn()
    const view = await start(provider)
    await flush(() => sha.mock.calls.length > 0)
    view.unmount()
    if (fails) reject(new Error('digest failed')); else resolve(new Uint8Array(32))
    await vi.advanceTimersByTimeAsync(0)
    expect(provider).not.toHaveBeenCalled()
    expect(api.submitPairingPayload).not.toHaveBeenCalled()
  })
  it('depois de entregar a chave, zera a chave do canal e mostra a confirmação', async () => {
    vi.useFakeTimers()
    await start(async () => new Uint8Array(32).fill(8))
    await flush(() => screen.queryByTestId('pairing-confirmation') !== null)
    const canal = await canalAtual()
    confirm()
    await flush(() => screen.queryByText('Dispositivo pareado com sucesso.') !== null)
    expect(canal.channelKey.every(byte => byte === 0)).toBe(true)
  })
  it('mostra o envio em andamento enquanto reconstitui a chave', async () => {
    vi.useFakeTimers()
    let resolve!: (key: Uint8Array) => void
    await start(() => new Promise<Uint8Array>(yes => { resolve = yes }))
    await flush(() => screen.queryByTestId('pairing-confirmation') !== null)
    confirm()
    expect(screen.getByRole('status').textContent).toBe('Enviando a chave para o novo dispositivo...')
    resolve(new Uint8Array(32).fill(8))
    await flush(() => screen.queryByText('Dispositivo pareado com sucesso.') !== null)
  })
  it('falha ao enviar a chave mostra a mensagem de segurança e zera a chave do canal', async () => {
    vi.useFakeTimers()
    await start(async () => new Uint8Array(32).fill(8))
    vi.mocked(api.submitPairingPayload).mockRejectedValue(new Error('rede'))
    await flush(() => screen.queryByTestId('pairing-confirmation') !== null)
    const canal = await canalAtual()
    confirm()
    await flush(() => screen.queryByRole('alert') !== null)
    expect(screen.getByRole('alert').textContent).toBe('Não foi possível concluir o pareamento com segurança. Tente novamente.')
    expect(canal.channelKey.every(byte => byte === 0)).toBe(true)
  })
  it('sair antes de a chave do canal ficar pronta a zera ao chegar', async () => {
    vi.useFakeTimers()
    let resolve!: (bytes: Uint8Array<ArrayBuffer>) => void
    vi.spyOn(webcrypto, 'sha256').mockImplementationOnce(() => new Promise((yes) => { resolve = yes }))
    const view = await start(vi.fn())
    await flush(() => vi.mocked(webcrypto.sha256).mock.calls.length > 0)
    view.unmount()
    resolve(new Uint8Array(32))
    await vi.advanceTimersByTimeAsync(0)
    expect((await canalAtual()).channelKey.every(byte => byte === 0)).toBe(true)
  })
})
