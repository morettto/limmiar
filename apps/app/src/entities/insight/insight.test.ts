import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@lingui/core'
import { falhaDe } from './falha-insight'
import { consultarInsight, enviarVoto } from './insight'

const consultar = vi.fn()
const consulta = { id: 'ancora-local', frase: 'Não durmo.', contexto: ['Tenho medo.'] }
const fonte = { trecho_id: 't1', titulo: 'Livro', autor: 'Autor', pagina: 1, paragrafo: 2, citacao_literal: 'Citação literal.', fenomeno_na_fala: 'Sono', fenomeno_no_trecho: 'Sono', probabilidade: 0.995, nivel: 'forte' }
const resultado = { cartoes: [fonte, { ...fonte, trecho_id: 't2', titulo: 'Artigo', probabilidade: 0.93, nivel: 'possivel' }], clarificar: false, alerta_risco: true, completo: true, juiz: 'v7' }
function resposta(dados: unknown = { ...resultado, completo: true }) {
  return new Response(JSON.stringify(dados) + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } })
}
const falhaDaConsulta = (signal = new AbortController().signal) => consultarInsight(consulta, signal, vi.fn()).catch((erro: unknown) => falhaDe(erro))
beforeEach(() => {
  vi.stubGlobal('fetch', consultar); consultar.mockImplementation(async () => resposta())
  i18n.loadAndActivate({ locale: 'pt-BR', messages: {} })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })
describe('consulta bibliográfica textual', () => {
  it('isola o acervo autorizado por conta e mantém o bearer fora da URL e do corpo', async () => {
    await consultarInsight(consulta, new AbortController().signal, vi.fn(), undefined, { accountId: 'owner', accessToken: 'secret', materialIds: ['material'] })
    const [url, init] = consultar.mock.lastCall!
    expect(url).not.toContain('secret')
    expect(init.headers.Authorization).toBe('Bearer secret')
    expect(JSON.parse(init.body)).toEqual({ frase: consulta.frase, contexto: consulta.contexto, falante: 'paciente', idioma: 'pt-BR', accountId: 'owner', materialIds: ['material'] })
  })
  it('envia somente fala e contexto do paciente ao endpoint qualificado e mantém todas as fontes', async () => {
    const controller = new AbortController()
    expect(await consultarInsight(consulta, controller.signal, vi.fn())).toEqual(resultado)
    expect(consultar.mock.calls[0]![0]).toBe('/copiloto/api/consultar-qualificado')
    expect(JSON.parse(consultar.mock.calls[0]![1].body)).toEqual({ frase: consulta.frase, contexto: consulta.contexto, falante: 'paciente', idioma: 'pt-BR' })
    const enviado: AbortSignal = consultar.mock.calls[0]![1].signal
    expect(enviado.aborted).toBe(false)
    controller.abort()
    expect(enviado.aborted).toBe(true)
  })
  it.each(['pt-BR', 'en-US', 'es-419', 'it-IT'])('manda o idioma da consulta igual ao locale ativo do app (%s)', async (locale) => {
    i18n.loadAndActivate({ locale, messages: {} })
    await consultarInsight(consulta, new AbortController().signal, vi.fn())
    expect(JSON.parse(consultar.mock.calls[0]![1].body).idioma).toBe(locale)
  })
  it('repassa a versão do juiz e o nível de cada cartão', async () => {
    const final = await consultarInsight(consulta, new AbortController().signal, vi.fn())
    expect(final.juiz).toBe('v7')
    expect(final.cartoes.map((cartao) => [cartao.nivel, cartao.probabilidade])).toEqual([['forte', 0.995], ['possivel', 0.93]])
  })
  it('503 é copiloto não liberado', async () => {
    consultar.mockResolvedValueOnce(new Response(null, { status: 503 }))
    expect(await falhaDaConsulta()).toBe('nao_liberado')
  })
  it.each([500, 502, 504])('HTTP %i é serviço fora', async (status) => {
    consultar.mockResolvedValueOnce(new Response(null, { status }))
    expect(await falhaDaConsulta()).toBe('fora')
  })
  it.each([401, 404, 422, undefined])('resposta recusada (%s) vale só para esta fala', async (status) => {
    consultar.mockResolvedValueOnce(status === undefined ? { ok: false } : new Response(null, { status }))
    expect(await falhaDaConsulta()).toBe('sem_analise')
  })
  it('falha de rede na requisição é serviço fora', async () => {
    consultar.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await falhaDaConsulta()).toBe('fora')
  })
  it('prazo vencido na requisição ou no meio do stream é serviço fora', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new DOMException('', 'TimeoutError')))
    consultar.mockImplementationOnce(async (_url: string, init: RequestInit) => { throw init.signal!.reason })
    expect(await falhaDaConsulta()).toBe('fora')
    consultar.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('network error')) } }), { headers: { 'Content-Type': 'application/x-ndjson' } }))
    expect(await falhaDaConsulta()).toBe('fora')
  })
  it('cancelamento do chamador na requisição segue como aborto e não como serviço fora', async () => {
    const controller = new AbortController()
    consultar.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason))
    }))
    const promessa = consultarInsight(consulta, controller.signal, vi.fn())
    controller.abort()
    await expect(promessa).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('erro no stream vale só para esta fala', async () => {
    consultar.mockResolvedValueOnce(resposta({ erro: 'insight.indisponivel' }))
    expect(await falhaDaConsulta()).toBe('sem_analise')
  })
  it('recusa resposta vazia sem conclusão ou posição para retomar', async () => {
    consultar.mockResolvedValueOnce(new Response('', { headers: { 'Content-Type': 'application/x-ndjson' } }))
    await expect(consultarInsight(consulta, new AbortController().signal, vi.fn())).rejects.toThrow('inválida')
  })
  it.each([{ cartoes: null }, { ...resultado, clarificar: null }, { ...resultado, alerta_risco: null },
    { ...resultado, juiz: undefined }, { ...resultado, juiz: '' }, { ...resultado, juiz: 7 }])('recusa saída incompleta %#', async (saida) => {
    consultar.mockResolvedValueOnce(resposta(saida))
    await expect(consultarInsight(consulta, new AbortController().signal, vi.fn())).rejects.toThrow('inválida')
  })
  it.each([
    { trecho_id: null }, { trecho_id: '' }, { titulo: null }, { titulo: ' ' }, { autor: null }, { autor: ' ' },
    { pagina: 1.5 }, { pagina: 0 }, { paragrafo: 1.5 }, { paragrafo: 0 },
    { citacao_literal: null }, { citacao_literal: ' ' }, { fenomeno_na_fala: null }, { fenomeno_no_trecho: null },
    { probabilidade: undefined }, { probabilidade: '0.95' }, { probabilidade: -0.1 }, { probabilidade: 1.1 },
    { nivel: undefined }, { nivel: 'medio' },
  ])('recusa referência sem proveniência utilizável %#', async (mudanca) => {
    consultar.mockResolvedValueOnce(resposta({ ...resultado, completo: true, cartoes: [{ ...fonte, ...mudanca }] }))
    await expect(consultarInsight(consulta, new AbortController().signal, vi.fn())).rejects.toThrow('inválida')
  })
  it('publica lote antes do fim da sessão, preserva Unicode e retoma por cursor', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
    consultar.mockResolvedValueOnce(new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } }))
    const atualizar = vi.fn()
    const promessa = consultarInsight(consulta, new AbortController().signal, atualizar)
    const cursor = 'A'.repeat(48)
    const parcial = { ...resultado, cartoes: [fonte], completo: false, cursor }
    const bytes = new TextEncoder().encode(JSON.stringify(parcial) + '\n')
    const posicao = bytes.findIndex((byte) => byte > 127)
    controller.enqueue(bytes.slice(0, posicao + 1))
    controller.enqueue(bytes.slice(posicao + 1))
    await vi.waitFor(() => expect(atualizar).toHaveBeenCalledOnce())
    expect(atualizar.mock.lastCall![0].cartoes).toHaveLength(1)
    controller.close()
    expect(await promessa).toEqual(parcial)
    expect(await consultarInsight(consulta, new AbortController().signal, atualizar, cursor)).toEqual(resultado)
    expect(JSON.parse(consultar.mock.lastCall![1].body).cursor).toBe(cursor)
    expect(atualizar).toHaveBeenCalledTimes(2)
  })
  it.each([null, { ...resultado, completo: undefined }, { ...resultado, completo: false }, { ...resultado, completo: 'true' }, { ...resultado, cartoes: [null], completo: true },
    { ...resultado, cursor: 'A'.repeat(48) }, { ...resultado, completo: false, cursor: null }, { ...resultado, completo: false, cursor: '' }])('recusa stream sem conclusão ou continuação íntegra %#', async (dados) => {
    consultar.mockResolvedValueOnce(resposta(dados))
    await expect(consultarInsight(consulta, new AbortController().signal, vi.fn())).rejects.toThrow('inválida')
  })
  it.each([
    new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
    new Response(null, { headers: { 'Content-Type': 'application/x-ndjson' } }),
    new Response(JSON.stringify({ ...resultado, completo: true })),
    resposta({ ...resultado, completo: true }),
  ])('recusa transporte ou continuação inválida %#', async (response) => {
    if (response.headers.get('Content-Type') === 'application/x-ndjson' && response.body) {
      response = new Response((await response.text()) + '{}\n', { headers: { 'Content-Type': 'application/x-ndjson' } })
    }
    consultar.mockResolvedValueOnce(response)
    await expect(consultarInsight(consulta, new AbortController().signal, vi.fn())).rejects.toThrow('inválida')
  })
  it('cancela o leitor ao interromper uma consulta em andamento', async () => {
    const cancelar = vi.fn()
    consultar.mockResolvedValueOnce(new Response(new ReadableStream({ cancel: cancelar }), { headers: { 'Content-Type': 'application/x-ndjson' } }))
    const controller = new AbortController()
    const promessa = consultarInsight(consulta, controller.signal, vi.fn())
    await new Promise((resolve) => setTimeout(resolve))
    controller.abort()
    await expect(promessa).rejects.toThrow()
    expect(cancelar).toHaveBeenCalledOnce()
  })
  it('preserva o cancelamento mesmo se o leitor falhar ao encerrar', async () => {
    const cancelar = vi.fn(async () => { throw new Error('falha ao fechar') })
    consultar.mockResolvedValueOnce(new Response(new ReadableStream({ cancel: cancelar }), { headers: { 'Content-Type': 'application/x-ndjson' } }))
    const controller = new AbortController()
    const promessa = consultarInsight(consulta, controller.signal, vi.fn())
    await new Promise((resolve) => setTimeout(resolve))
    controller.abort()
    await expect(promessa).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('preserva a falha de formato quando a limpeza do leitor também falha', async () => {
    consultar.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('null\n')) },
      async cancel() { throw new Error('falha ao fechar') },
    }), { headers: { 'Content-Type': 'application/x-ndjson' } }))
    await expect(consultarInsight(consulta, new AbortController().signal, vi.fn())).rejects.toThrow('inválida')
  })
  it('limita memória de um frame sem terminador', async () => {
    consultar.mockResolvedValueOnce(new Response('x'.repeat(16 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/x-ndjson' } }))
    await expect(consultarInsight(consulta, new AbortController().signal, vi.fn())).rejects.toThrow('inválida')
  })
})

describe('envio de voto', () => {
  const evento = { v: 1 as const, consentiu: true, usuario: 'a'.repeat(64), fala: 'f', contexto: ['c'], trecho: 't', obra: 'o', voto: 'util' as const, juiz: 'v7', em: '2026-10-08T10:00:00.000Z' }
  const bibliografia = { accountId: 'conta', accessToken: 'secret', materialIds: [] }
  it.each([[204, true], [400, true], [401, false], [500, false]])('status %i resolve=%s', async (status, esperado) => {
    consultar.mockResolvedValueOnce(new Response(null, { status }))
    expect(await enviarVoto(evento, bibliografia)).toBe(esperado)
  })
  it('envia só os campos do contrato, com o mesmo bearer das consultas', async () => {
    consultar.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await enviarVoto({ ...evento, enviado: true, accountId: 'conta', email: 'x@y.z' } as typeof evento, bibliografia)
    const [url, init] = consultar.mock.lastCall!
    expect(url).toBe('/copiloto/api/votos?accountId=conta')
    expect(init.headers.Authorization).toBe('Bearer secret')
    expect(JSON.parse(init.body)).toEqual(evento)
  })
})
