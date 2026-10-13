import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from '@limmiar/crypto'
import { enviarVoto } from './insight'
import { gravarConsentimento } from './consentimento-voto'
import { enviarPendentes } from './voto-envio'
import { guardarVoto, lerVotos } from './voto-store'

vi.mock('./insight', () => ({ enviarVoto: vi.fn() }))
const enviar = vi.mocked(enviarVoto)
const CONTA = 'conta-1'
const bibliografia = { accountId: CONTA, accessToken: 't', materialIds: [] }
const entrada = (trecho: string) => ({ fala: 'f', contexto: [], trecho, obra: 'o', voto: 'util' as const, juiz: 'v1' })
const makeKek = () => webcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
const enviados = async (kek: Awaited<ReturnType<typeof makeKek>>) => (await lerVotos(kek, CONTA)).map((voto) => voto.enviado)

describe('envio e reenvio de votos', () => {
  beforeEach(() => { enviar.mockResolvedValue(true) })
  afterEach(() => { localStorage.clear(); vi.clearAllMocks() })

  it.each([['ausente', undefined], ['não', 'nao' as const]])('consentimento %s: nada sai', async (_nome, valor) => {
    const kek = await makeKek()
    if (valor) gravarConsentimento(CONTA, valor)
    await guardarVoto(kek, CONTA, entrada('a'), true)
    await enviarPendentes(kek, CONTA, bibliografia)
    expect(enviar).not.toHaveBeenCalled()
  })

  it('sem credencial do acervo nada sai; votos locais (consentiu=false) nunca saem', async () => {
    const kek = await makeKek()
    gravarConsentimento(CONTA, 'sim')
    await guardarVoto(kek, CONTA, entrada('a'), true)
    await guardarVoto(kek, CONTA, entrada('b'), false)
    await enviarPendentes(kek, CONTA, undefined)
    expect(enviar).not.toHaveBeenCalled()
    await enviarPendentes(kek, CONTA, bibliografia)
    expect(enviar).toHaveBeenCalledTimes(1)
    expect(enviar.mock.calls[0]![0]).toMatchObject({ trecho: 'a', consentiu: true })
    expect(await enviados(kek)).toEqual([true, false])
  })

  it('falha de rede ou recusa mantém pendente e para; a próxima tentativa reenvia', async () => {
    const kek = await makeKek()
    gravarConsentimento(CONTA, 'sim')
    await guardarVoto(kek, CONTA, entrada('a'), true)
    await guardarVoto(kek, CONTA, entrada('b'), true)
    enviar.mockRejectedValueOnce(new Error('offline'))
    await enviarPendentes(kek, CONTA, bibliografia)
    enviar.mockResolvedValueOnce(false)
    await enviarPendentes(kek, CONTA, bibliografia)
    expect(enviar).toHaveBeenCalledTimes(2)
    expect(await enviados(kek)).toEqual([false, false])
    await enviarPendentes(kek, CONTA, bibliografia)
    expect(await enviados(kek)).toEqual([true, true])
  })

  it('limita os reenvios por vez', async () => {
    const kek = await makeKek()
    gravarConsentimento(CONTA, 'sim')
    for (let i = 0; i < 22; i++) await guardarVoto(kek, CONTA, entrada(`t${i}`), true)
    await enviarPendentes(kek, CONTA, bibliografia)
    expect(enviar).toHaveBeenCalledTimes(20)
    await enviarPendentes(kek, CONTA, bibliografia)
    expect(enviar).toHaveBeenCalledTimes(22)
  })
})
