import { afterEach, describe, expect, it } from 'vitest'
import { webcrypto as limmiarWebcrypto } from '@limmiar/crypto'
import { decodeBase64 } from '../../shared/lib/base64'
import { guardarVoto, lerVotos, marcarEnviado, pseudonimoDaConta } from './voto-store'

const CONTA = '11111111-1111-1111-1111-111111111111'
const entrada = { fala: 'Tenho medo.', contexto: ['antes'], trecho: 'Citação.', obra: 'Livro', voto: 'util' as const, juiz: 'v1' }
const makeKek = () => limmiarWebcrypto.importKek(crypto.getRandomValues(new Uint8Array(32)))
const agora = new Date('2026-10-08T10:00:00Z')

describe('votos de insight', () => {
  afterEach(() => localStorage.clear())

  it('grava o evento no contrato com consentiu=false e pseudônimo, sem texto em claro', async () => {
    const kek = await makeKek()
    await guardarVoto(kek, CONTA, entrada, false, agora)
    const [evento] = await lerVotos(kek, CONTA)
    expect(evento).toEqual({ v: 1, consentiu: false, usuario: await pseudonimoDaConta(CONTA), ...entrada, em: '2026-10-08T10:00:00.000Z', enviado: false })
    expect(evento!.usuario).toMatch(/^[0-9a-f]{64}$/)
    expect(evento!.usuario).not.toContain(CONTA)
    expect(localStorage.getItem(`limmiar:voto-insight:${CONTA}`)).not.toContain('medo')
  })

  it('mudar o voto da mesma fala e trecho substitui; outro trecho acumula', async () => {
    const kek = await makeKek()
    await guardarVoto(kek, CONTA, entrada, false, agora)
    await guardarVoto(kek, CONTA, { ...entrada, voto: 'nao_util' }, false, agora)
    await guardarVoto(kek, CONTA, { ...entrada, trecho: 'Outra.' }, false, agora)
    expect((await lerVotos(kek, CONTA)).map((voto) => [voto.trecho, voto.voto])).toEqual([['Citação.', 'nao_util'], ['Outra.', 'util']])
  })

  it('lê [] sem votos, falha com outra chave e rejeita conta vazia', async () => {
    const kek = await makeKek()
    expect(await lerVotos(kek, CONTA)).toEqual([])
    await guardarVoto(kek, CONTA, entrada, false, agora)
    await expect(lerVotos(await makeKek(), CONTA)).rejects.toThrow()
    await expect(guardarVoto(kek, '', entrada, false)).rejects.toThrow(/accountId/)
    await expect(lerVotos(kek, '')).rejects.toThrow(/accountId/)
  })

  it('grava consentiu=true e marca só o evento exato como enviado, sem perder votos simultâneos', async () => {
    const kek = await makeKek()
    await guardarVoto(kek, CONTA, entrada, true, agora)
    const [primeiro] = await lerVotos(kek, CONTA)
    await Promise.all([marcarEnviado(kek, CONTA, primeiro!), guardarVoto(kek, CONTA, { ...entrada, trecho: 'Outra.' }, true, agora)])
    expect((await lerVotos(kek, CONTA)).map((voto) => [voto.trecho, voto.consentiu, voto.enviado])).toEqual([['Citação.', true, true], ['Outra.', true, false]])
    await guardarVoto(kek, CONTA, { ...entrada, voto: 'nao_util' }, true, new Date('2026-10-08T11:00:00Z'))
    await marcarEnviado(kek, CONTA, primeiro!)
    expect((await lerVotos(kek, CONTA)).find((voto) => voto.trecho === 'Citação.')!.enviado).toBe(false)
  })

  it('uma falha na fila não trava as gravações seguintes', async () => {
    const kek = await makeKek()
    await guardarVoto(kek, CONTA, entrada, true, agora)
    await expect(guardarVoto(await makeKek(), CONTA, entrada, true)).rejects.toThrow()
    await guardarVoto(kek, CONTA, { ...entrada, trecho: 'Outra.' }, true, agora)
    expect(await lerVotos(kek, CONTA)).toHaveLength(2)
  })

  it('pseudônimo é estável por conta e difere entre contas', async () => {
    expect(await pseudonimoDaConta(CONTA)).toBe(await pseudonimoDaConta(CONTA))
    expect(await pseudonimoDaConta(CONTA)).not.toBe(await pseudonimoDaConta('outra'))
  })

  it('o envelope só abre com o contexto da própria conta, também quando copiado para outra', async () => {
    const kek = await makeKek()
    await guardarVoto(kek, CONTA, entrada, false, agora)
    const guardado = localStorage.getItem(`limmiar:voto-insight:${CONTA}`)!
    const { wrappedDek, ciphertext } = JSON.parse(guardado) as { wrappedDek: string; ciphertext: string }
    const aad = new TextEncoder().encode(`limmiar/voto-insight/v1|${CONTA}`)
    const dek = await limmiarWebcrypto.unwrapDek(kek, decodeBase64(wrappedDek), aad)
    await expect(limmiarWebcrypto.decrypt(dek, decodeBase64(ciphertext), aad)).resolves.toBeDefined()

    localStorage.setItem('limmiar:voto-insight:outra-conta', guardado)
    await expect(lerVotos(kek, 'outra-conta')).rejects.toThrow()
  })

  it('só a mesma fala no mesmo trecho substitui o voto; fala diferente no mesmo trecho acumula', async () => {
    const kek = await makeKek()
    await guardarVoto(kek, CONTA, entrada, false, agora)
    await guardarVoto(kek, CONTA, { ...entrada, fala: 'Outra fala.' }, false, agora)
    expect((await lerVotos(kek, CONTA)).map((voto) => [voto.fala, voto.trecho])).toEqual([['Tenho medo.', 'Citação.'], ['Outra fala.', 'Citação.']])
  })

  it('marcar como enviado atinge só o voto exato, mesmo com o mesmo instante nos outros', async () => {
    const kek = await makeKek()
    await guardarVoto(kek, CONTA, entrada, true, agora)
    await guardarVoto(kek, CONTA, { ...entrada, trecho: 'Outra.' }, true, agora)
    await guardarVoto(kek, CONTA, { ...entrada, fala: 'Outra fala.' }, true, agora)
    const [alvo] = await lerVotos(kek, CONTA)
    await marcarEnviado(kek, CONTA, alvo!)
    expect((await lerVotos(kek, CONTA)).map((voto) => [voto.fala, voto.trecho, voto.enviado])).toEqual([
      ['Tenho medo.', 'Citação.', true], ['Tenho medo.', 'Outra.', false], ['Outra fala.', 'Citação.', false],
    ])
  })
})
