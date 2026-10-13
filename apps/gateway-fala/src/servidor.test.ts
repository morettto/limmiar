import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { CapacidadeEsgotada } from './pool.ts'
import { criarServidor, ROTA, type ConfigServidor } from './servidor.ts'
import { adiado, AbridorFalso, ExtratorFalso, PARAMETROS, VOZ_A } from './test-support/falsos.ts'

const encerrar: (() => Promise<void>)[] = []
afterEach(async () => { await Promise.all(encerrar.splice(0).map((fn) => fn())) })

async function subir(extra: Partial<ConfigServidor> = {}) {
  const abridor = new AbridorFalso()
  const registrar = vi.fn()
  const servidor = criarServidor({ abrirUpstream: abridor.abrir, extrator: new ExtratorFalso(), parametros: PARAMETROS, registrar, pingMs: 60_000, ...extra })
  await new Promise<void>((resolver) => servidor.http.listen(0, '127.0.0.1', resolver))
  const porta = (servidor.http.address() as AddressInfo).port
  encerrar.push(() => servidor.fechar())
  return { abridor, registrar, servidor, porta, url: `ws://127.0.0.1:${porta}${ROTA}` }
}

function cliente(url: string, opcoes: WebSocket.ClientOptions = {}) {
  const ws = new WebSocket(url, opcoes)
  const recebidas: Record<string, unknown>[] = []
  const fechou = new Promise<number>((resolver) => ws.on('close', resolver))
  ws.on('message', (dados) => recebidas.push(JSON.parse(String(dados)) as Record<string, unknown>))
  ws.on('error', () => {})
  encerrar.push(async () => { ws.terminate() })
  const aberto = new Promise<void>((resolver) => ws.once('open', resolver))
  return { ws, recebidas, fechou, aberto }
}

const iniciar = (extra: Record<string, unknown> = {}) => JSON.stringify({ type: 'iniciar', sample_rate: 16000, idioma: 'pt', modo: 'presencial', perfil: VOZ_A, ...extra })
const tipos = (recebidas: Record<string, unknown>[]) => recebidas.map((mensagem) => mensagem.type)

describe('HTTP', () => {
  it('responde à checagem de saúde e recusa o resto', async () => {
    const { porta } = await subir()
    const saude = await fetch(`http://127.0.0.1:${porta}/saude`)
    expect(saude.status).toBe(200)
    expect(await saude.json()).toEqual({ ok: true })
    expect((await fetch(`http://127.0.0.1:${porta}/outra`)).status).toBe(404)
  })

  it('recusa o upgrade fora da rota', async () => {
    const { porta } = await subir()
    const { fechou } = cliente(`ws://127.0.0.1:${porta}/v1/outra`)
    expect(await fechou).toBe(1006)
  })
})

describe('chave de API', () => {
  it('exige o cabeçalho Authorization quando há chave configurada', async () => {
    const { url } = await subir({ chave: 'segredo' })
    expect(await cliente(url).fechou).toBe(1006)
    expect(await cliente(url, { headers: { Authorization: 'Bearer errado' } }).fechou).toBe(1006)
    expect(await cliente(url, { headers: { Authorization: 'Bearer segredX' } }).fechou).toBe(1006)
    const certo = cliente(url, { headers: { Authorization: 'Bearer segredo' } })
    await certo.aberto
    certo.ws.send(iniciar())
    await vi.waitFor(() => expect(tipos(certo.recebidas)).toEqual(['pronta']))
  })

  it('sem chave configurada, aceita qualquer cliente', async () => {
    const { url } = await subir()
    const aberto = cliente(url)
    await aberto.aberto
    aberto.ws.close()
  })
})

describe('uma sessão de ponta a ponta', () => {
  it('recebe o início, repassa o áudio, devolve a frase com o falante e conclui', async () => {
    const { url, abridor } = await subir()
    const { ws, recebidas, fechou, aberto } = cliente(url)
    await aberto
    ws.send(iniciar())
    await vi.waitFor(() => expect(tipos(recebidas)).toEqual(['pronta']))
    ws.send(Buffer.from(new Int16Array(32_000).fill(1000).buffer))
    const up = abridor.abertos[0]!
    await vi.waitFor(() => expect(up.amostras).toBe(32_000))
    up.palavras([['Bom', 0.1, 0.5]], 0, 0.7)
    await vi.waitFor(() => expect(tipos(recebidas)).toContain('parcial'))
    up.palavras([['Bom', 0.1, 0.5], ['dia', 0.6, 1.5]], 2, 1.6)
    await vi.waitFor(() => expect(tipos(recebidas)).toContain('final'))
    expect(recebidas.find((mensagem) => mensagem.type === 'final')).toMatchObject({ falante: 'profissional', frase: 0 })
    ws.send(JSON.stringify({ type: 'concluir' }))
    await vi.waitFor(() => expect(tipos(recebidas).at(-1)).toBe('concluida'))
    expect(await fechou).toBe(1000)
    expect(up.fechado).toBe(true)
  })

  it('entrega ao upstream exatamente as amostras de cada quadro, qualquer que seja o alinhamento', async () => {
    const { url, abridor } = await subir()
    const { ws, recebidas, aberto } = cliente(url)
    await aberto
    ws.send(iniciar())
    await vi.waitFor(() => expect(tipos(recebidas)).toEqual(['pronta']))
    const quadros = [[1, 2, 3], [-4, 5, 6, 7, 8], [9]].map((amostras) => Int16Array.from(amostras))
    quadros.forEach((quadro) => ws.send(Buffer.from(quadro.buffer)))
    await vi.waitFor(() => expect(abridor.abertos[0]!.enviados).toHaveLength(3))
    expect(abridor.abertos[0]!.enviados.map((quadro) => [...quadro])).toEqual([[1, 2, 3], [-4, 5, 6, 7, 8], [9]])
  })

  it('encerra a sessão upstream quando o navegador vai embora', async () => {
    const { url, abridor } = await subir()
    const { ws, recebidas, aberto } = cliente(url)
    await aberto
    ws.send(iniciar())
    await vi.waitFor(() => expect(tipos(recebidas)).toEqual(['pronta']))
    ws.close()
    await vi.waitFor(() => expect(abridor.abertos[0]!.fechado).toBe(true))
  })
})

describe('violações do protocolo', () => {
  async function violar(enviar: (ws: WebSocket) => void, pronta = true) {
    const { url } = await subir()
    const { ws, recebidas, fechou, aberto } = cliente(url)
    await aberto
    enviar(ws)
    if (pronta) await vi.waitFor(() => expect(recebidas.length).toBeGreaterThan(0))
    return { recebidas, codigo: await fechou }
  }

  it('áudio antes de iniciar', async () => {
    const { recebidas, codigo } = await violar((ws) => ws.send(Buffer.alloc(8)))
    expect(codigo).toBe(1008)
    expect(recebidas[0]).toMatchObject({ type: 'erro' })
  })

  it('mensagem inicial inválida, sem citar a impressão de voz', async () => {
    const { recebidas, codigo } = await violar((ws) => ws.send(iniciar({ perfil: [0.123456, 0.2] })))
    expect(codigo).toBe(1008)
    expect(JSON.stringify(recebidas)).not.toContain('0.123456')
  })

  it('comando desconhecido depois de pronta, ou texto enquanto a sessão ainda abre', async () => {
    const pronta = await violar((ws) => {
      ws.send(iniciar())
      ws.once('message', () => ws.send('{"type":"outro"}'))
    })
    expect(pronta.codigo).toBe(1008)

    const { url, abridor } = await subir()
    const liberar = adiado<void>()
    abridor.seguraProxima = liberar.promessa
    const abrindo = cliente(url)
    await abrindo.aberto
    abrindo.ws.send(iniciar())
    abrindo.ws.send('{"type":"concluir"}')
    expect(await abrindo.fechou).toBe(1008)
    liberar.resolver()
  })

  it('áudio enquanto a sessão ainda abre', async () => {
    const { url, abridor } = await subir()
    const liberar = adiado<void>()
    abridor.seguraProxima = liberar.promessa
    const { ws, fechou, aberto } = cliente(url)
    await aberto
    ws.send(iniciar())
    ws.send(Buffer.alloc(8))
    expect(await fechou).toBe(1008)
    liberar.resolver()
  })

  it('PCM16 com número ímpar de bytes', async () => {
    const { url } = await subir()
    const { ws, recebidas, fechou, aberto } = cliente(url)
    await aberto
    ws.send(iniciar())
    await vi.waitFor(() => expect(tipos(recebidas)).toEqual(['pronta']))
    ws.send(Buffer.alloc(3))
    expect(await fechou).toBe(1003)
  })

  it('mensagem maior que o limite derruba a conexão', async () => {
    const { url } = await subir()
    const { ws, recebidas, fechou, aberto } = cliente(url)
    await aberto
    ws.send(iniciar())
    await vi.waitFor(() => expect(tipos(recebidas)).toEqual(['pronta']))
    ws.send(Buffer.alloc(70_000))
    expect(await fechou).toBe(1006)
  })
})

describe('falhas de serviço', () => {
  it('diz que a capacidade se esgotou quando nenhum processo tem vaga', async () => {
    const { url, abridor, registrar } = await subir()
    abridor.falhaNaProxima = new CapacidadeEsgotada('Capacidade de transcrição esgotada.')
    const { ws, recebidas, fechou, aberto } = cliente(url)
    await aberto
    ws.send(iniciar())
    expect(await fechou).toBe(1011)
    expect(recebidas).toEqual([{ type: 'erro', mensagem: 'Capacidade de transcrição esgotada. Tente de novo em instantes.' }])
    expect(registrar).toHaveBeenCalledWith('sessao.capacidade_esgotada')
  })

  it('avisa e fecha quando a upstream não abre, sem expor o motivo', async () => {
    const { url, abridor, registrar } = await subir()
    abridor.falhaNaProxima = new Error('conexão recusada em 10.0.0.5')
    const { ws, recebidas, fechou, aberto } = cliente(url)
    await aberto
    ws.send(iniciar())
    expect(await fechou).toBe(1011)
    expect(recebidas).toEqual([{ type: 'erro', mensagem: 'O serviço de transcrição está indisponível.' }])
    expect(registrar).toHaveBeenCalledWith('sessao.abertura_falhou')
  })

  it('funciona sem registrador', async () => {
    const { url, abridor } = await subir({ registrar: undefined })
    abridor.falhaNaProxima = new Error('x')
    const { ws, fechou, aberto } = cliente(url)
    await aberto
    ws.send(iniciar())
    expect(await fechou).toBe(1011)
  })
})

describe('conexão viva e desligamento', () => {
  it('mantém o cliente que responde ao ping e derruba o que não responde', async () => {
    const { url } = await subir({ pingMs: 40 })
    const vivo = cliente(url)
    const mudo = cliente(url, { autoPong: false })
    await Promise.all([vivo.aberto, mudo.aberto])
    expect(await mudo.fechou).toBe(1006)
    expect(vivo.ws.readyState).toBe(WebSocket.OPEN)
  })

  it('ao fechar, despede os clientes com 1001', async () => {
    const { url, servidor } = await subir()
    const { fechou, aberto } = cliente(url)
    await aberto
    await servidor.fechar()
    expect(await fechou).toBe(1001)
  })
})
