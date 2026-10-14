import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { abrirTranscricao, type Identidade, type ResultadoTranscricao, type SessaoServidor } from './transcricao-servidor'
import { dynamicActivate } from '../i18n'

beforeAll(async () => dynamicActivate('pt-BR'))

class SocketFalso {
  static todos: SocketFalso[] = []
  onopen: (() => void) | null = null
  onmessage: ((evento: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  bufferedAmount = 0
  enviados: unknown[] = []
  fechado = false
  url: string
  constructor(url: string) { this.url = url; SocketFalso.todos.push(this) }
  send(dados: unknown) { this.enviados.push(dados) }
  close() { this.fechado = true; this.onclose?.() }
  abrir() { this.onopen?.() }
  receber(evento: object) { this.onmessage?.({ data: JSON.stringify(evento) }) }
  cair() { this.onclose?.() }
  comandos() { return this.enviados.filter((item): item is string => typeof item === 'string').map((item) => JSON.parse(item) as Record<string, unknown>) }
  quadros() { return this.enviados.filter((item): item is Int16Array => item instanceof Int16Array) }
}

const PERFIL = [0.25, -0.5, 0.75]
const PRESENCIAL: Identidade = { modo: 'presencial', perfil: PERFIL }
const palavra = (texto: string, inicio_ms: number, fim_ms: number) => ({ texto, inicio_ms, fim_ms })
const final = (frase: number, falante: string | null, palavras: object[], processado_ms = 0) => ({ type: 'final', frase, falante, palavras, processado_ms })
const parcial = (texto: string, processado_ms = 0) => ({ type: 'parcial', texto, processado_ms })

let resultados: ResultadoTranscricao[]
let falhas: Error[]
const ultimo = () => resultados.at(-1)!
// A porta de voz só deixa passar o que tem energia: fala constante a 0,1 passa; zeros são silêncio.
const voz = (amostras: number) => new Float32Array(amostras).fill(0.1)
const socket = (indice = 0) => SocketFalso.todos[indice]!

async function abrir(identidade: Identidade = PRESENCIAL): Promise<SessaoServidor> {
  const aberta = abrirTranscricao({ identidade, aoResultado: (r) => resultados.push(r), falhar: (erro) => falhas.push(erro) })
  const aberto = socket(SocketFalso.todos.length - 1)
  aberto.abrir()
  aberto.receber({ type: 'pronta' })
  return aberta
}

beforeEach(() => {
  SocketFalso.todos = []
  resultados = []
  falhas = []
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', SocketFalso)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('abertura', () => {
  it('abre /speech na mesma origem, apresenta o profissional ao gateway e só entrega a sessão depois do "pronta"', async () => {
    let entregue = false
    const aberta = abrirTranscricao({ identidade: PRESENCIAL, aoResultado: () => {}, falhar: () => {} }).then((sessao) => { entregue = true; return sessao })
    expect(socket().url).toBe(`ws://${location.host}/speech/v1/fala`)
    socket().abrir()
    await vi.advanceTimersByTimeAsync(1)
    expect(entregue).toBe(false)
    expect(socket().comandos()).toEqual([{ type: 'iniciar', sample_rate: 16000, idioma: 'pt', modo: 'presencial', perfil: PERFIL }])
    socket().receber({ type: 'pronta' })
    await aberta
    expect(entregue).toBe(true)
  })

  it('na teleconsulta informa o falante da trilha, sem perfil de voz, e usa a origem do build trocando http por ws', async () => {
    vi.stubEnv('VITE_SPEECH_BASE_URL', 'https://fala.example.com/')
    await abrir({ modo: 'online', falante: 'paciente' })
    expect(socket().url).toBe('wss://fala.example.com/v1/fala')
    expect(socket().comandos()).toEqual([{ type: 'iniciar', sample_rate: 16000, idioma: 'pt', modo: 'online', falante: 'paciente' }])
  })

  it('ignora um segundo "pronta" e eventos que não são JSON, nulos ou desconhecidos', async () => {
    await abrir()
    socket().receber({ type: 'pronta' })
    socket().onmessage!({ data: 'não é json' })
    socket().onmessage!({ data: 'null' })
    socket().receber({ type: 'session.updated' })
    expect(resultados).toEqual([])
  })

  it('recusa quando o socket fecha antes do "pronta"', async () => {
    const aberta = abrirTranscricao({ identidade: PRESENCIAL, aoResultado: () => {}, falhar: (erro) => falhas.push(erro) })
    const rejeitada = expect(aberta).rejects.toThrow('Não foi possível conectar ao serviço de transcrição.')
    socket().cair()
    await rejeitada
    expect(falhas).toEqual([])
    expect(SocketFalso.todos).toHaveLength(1)
  })

  it('desiste da abertura depois de 10 s sem "pronta"', async () => {
    const aberta = abrirTranscricao({ identidade: PRESENCIAL, aoResultado: () => {}, falhar: () => {} })
    const rejeitada = expect(aberta).rejects.toThrow('Não foi possível conectar')
    await vi.advanceTimersByTimeAsync(10_000)
    await rejeitada
    expect(socket().fechado).toBe(true)
  })
})

describe('transcrição', () => {
  it('converte o PCM float em PCM16 e limita o que passa do fundo de escala', async () => {
    const sessao = await abrir()
    sessao.enviar(Float32Array.of(0, 0.5, -0.5, 1, -1, 2, -2))
    expect(Array.from(socket().quadros()[0]!)).toEqual([0, 16384, -16383, 32767, -32767, 32767, -32767])
  })

  it('mostra a hipótese enquanto a pessoa fala, sem falante, e a substitui a cada parcial', async () => {
    await abrir()
    socket().receber(parcial(''))
    expect(ultimo()).toEqual({ palavras: [], finais: 0, estavelAteMs: 0 })
    socket().receber(parcial('Bom dia,', 1040))
    expect(ultimo()).toEqual({ palavras: [{ texto: 'Bom dia,', inicioMs: 1040, fimMs: 1040, locutor: null }], finais: 0, estavelAteMs: 0 })
    socket().receber(parcial('Bom', 1100))
    expect(ultimo().palavras.map((item) => item.texto)).toEqual(['Bom'])
  })

  it('frase final sem instante processado não mexe no aviso de atraso', async () => {
    await abrir()
    socket().receber({ type: 'final', frase: 0, falante: 'profissional', palavras: [palavra('Oi', 100, 300)] })
    expect(ultimo()).toMatchObject({ finais: 1 })
    expect(ultimo().aviso).toBeUndefined()
  })

  it('ignora parcial sem texto ou sem instante processado', async () => {
    await abrir()
    socket().receber(parcial('Bom', 900))
    for (const ruim of [{ texto: 3, processado_ms: 900 }, { texto: 'y' }]) socket().receber({ type: 'parcial', ...ruim })
    expect(ultimo().palavras.map((item) => item.texto)).toEqual(['Bom'])
  })

  it('cada frase final só acrescenta, já com o falante resolvido, e tudo o que é final é estável', async () => {
    await abrir()
    socket().receber(parcial('Bom', 720))
    socket().receber(final(0, 'profissional', [palavra('Bom', 640, 720), palavra('dia', 880, 1040)]))
    expect(ultimo()).toEqual({
      palavras: [{ texto: 'Bom', inicioMs: 640, fimMs: 720, locutor: 'profissional' }, { texto: 'dia', inicioMs: 880, fimMs: 1040, locutor: 'profissional' }],
      finais: 2,
      estavelAteMs: 1041,
    })
    socket().receber(parcial('Oi', 1700))
    socket().receber(final(1, 'paciente', [palavra('Oi', 1500, 1700)]))
    expect(ultimo().palavras.map((item) => [item.texto, item.locutor])).toEqual([['Bom', 'profissional'], ['dia', 'profissional'], ['Oi', 'paciente']])
    expect(ultimo().finais).toBe(3)
    expect(ultimo().estavelAteMs).toBe(1701)
  })

  it('frase sem nenhuma vizinha fica sem falante até o gateway corrigi-la', async () => {
    await abrir()
    socket().receber(final(0, null, [palavra('Oi', 100, 300)]))
    socket().receber(final(1, 'paciente', [palavra('Bom', 500, 900), palavra('dia', 1000, 1400)]))
    expect(ultimo().palavras.map((item) => item.locutor)).toEqual([null, 'paciente', 'paciente'])
    socket().receber({ type: 'falante', frase: 0, falante: 'paciente' })
    expect(ultimo().palavras.map((item) => item.locutor)).toEqual(['paciente', 'paciente', 'paciente'])
    socket().receber({ type: 'falante', frase: 1, falante: 'profissional' })
    expect(ultimo().palavras.map((item) => item.locutor)).toEqual(['paciente', 'profissional', 'profissional'])
  })

  it('ignora a correção de uma frase que não conhece ou com falante inválido', async () => {
    await abrir()
    socket().receber(final(0, 'paciente', [palavra('Oi', 100, 300)]))
    const antes = resultados.length
    socket().receber({ type: 'falante', frase: 7, falante: 'profissional' })
    socket().receber({ type: 'falante', frase: 0, falante: 3 })
    socket().receber({ type: 'falante', frase: 0 })
    expect(resultados).toHaveLength(antes)
  })

  it('descarta parciais e finais malformados', async () => {
    await abrir()
    const invalidos: object[] = [
      { type: 'parcial' },
      { type: 'parcial', palavras: 'a' },
      { type: 'parcial', palavras: [null] },
      { type: 'parcial', palavras: [{ inicio_ms: 0, fim_ms: 1 }] },
      { type: 'parcial', palavras: [{ texto: 1, inicio_ms: 0, fim_ms: 1 }] },
      { type: 'parcial', palavras: [{ texto: 'a', fim_ms: 1 }] },
      { type: 'parcial', palavras: [{ texto: 'a', inicio_ms: 'x', fim_ms: 1 }] },
      { type: 'parcial', palavras: [{ texto: 'a', inicio_ms: 0 }] },
      { type: 'parcial', palavras: [{ texto: 'a', inicio_ms: 0, fim_ms: Infinity }] },
      { type: 'final', frase: 0, falante: 'paciente' },
      { type: 'final', palavras: [palavra('a', 0, 1)], falante: 'paciente' },
      { type: 'final', frase: 0.5, palavras: [palavra('a', 0, 1)], falante: 'paciente' },
      { type: 'final', frase: 0, palavras: [palavra('a', 0, 1)] },
      { type: 'final', frase: 0, palavras: [palavra('a', 0, 1)], falante: 3 },
    ]
    invalidos.forEach((evento) => socket().receber(evento))
    expect(resultados).toEqual([])
  })

  it('um erro do gateway derruba a sessão com a mensagem dele, uma vez só', async () => {
    const sessao = await abrir()
    socket().receber({ type: 'erro', mensagem: 'indisponível' })
    expect(falhas.map((erro) => erro.message)).toEqual(['O serviço de transcrição falhou: indisponível'])
    expect(socket().fechado).toBe(true)
    socket().receber({ type: 'erro' })
    sessao.enviar(voz(10))
    expect(socket().quadros()).toEqual([])
    await expect(sessao.concluir()).rejects.toThrow('indisponível')
    await expect(sessao.esvaziada()).resolves.toBeUndefined()
  })

  it('um erro sem detalhe também é falha', async () => {
    await abrir()
    socket().receber({ type: 'erro' })
    expect(falhas[0]!.message).toBe('O serviço de transcrição falhou: sem detalhe')
  })
})

describe('atraso', () => {
  it('avisa quando mais de 2 s de áudio esperam no socket e some quando o buffer esvazia', async () => {
    const sessao = await abrir()
    sessao.enviar(voz(10))
    expect(resultados).toEqual([])
    socket().bufferedAmount = 64_001
    sessao.enviar(voz(10))
    sessao.enviar(voz(10))
    expect(resultados.map((r) => r.aviso)).toEqual(['atrasada'])
    socket().bufferedAmount = 64_000
    sessao.enviar(voz(10))
    expect(resultados.map((r) => r.aviso)).toEqual(['atrasada', undefined])
    expect('aviso' in ultimo()).toBe(false)
  })

  it('avisa também quando o gateway processou mais de 2 s a menos que o enviado, mesmo com o socket vazio', async () => {
    const sessao = await abrir()
    sessao.enviar(voz(48_000))
    socket().receber(parcial('', 900))
    expect(ultimo().aviso).toBe('atrasada')
    socket().receber(parcial('', 990))
    expect(ultimo().aviso).toBe('atrasada')
    socket().receber(parcial('', 2100))
    expect('aviso' in ultimo()).toBe(false)
    socket().receber({ type: 'parcial', palavras: [] })
    expect('aviso' in ultimo()).toBe(false)
    socket().receber(final(0, 'paciente', [palavra('a', 0, 1)], 500))
    expect(ultimo().aviso).toBe('atrasada')
  })

  it('o atraso do gateway não sobrevive à queda nem à conclusão', async () => {
    const sessao = await abrir()
    sessao.enviar(voz(48_000))
    socket().receber(parcial('', 0))
    socket().cair()
    await vi.advanceTimersByTimeAsync(0)
    socket(1).abrir()
    socket(1).receber({ type: 'pronta' })
    expect('aviso' in ultimo()).toBe(false)
    sessao.enviar(voz(48_000))
    socket(1).receber(parcial('', 100))
    expect(ultimo().aviso).toBe('atrasada')
    const concluida = sessao.concluir()
    socket(1).receber({ type: 'concluida' })
    expect('aviso' in await concluida).toBe(false)
  })

  it('esvaziada espera o buffer descer ao limite', async () => {
    const sessao = await abrir()
    socket().bufferedAmount = 100_000
    let livre = false
    void sessao.esvaziada().then(() => { livre = true })
    await vi.advanceTimersByTimeAsync(100)
    expect(livre).toBe(false)
    socket().bufferedAmount = 0
    await vi.advanceTimersByTimeAsync(25)
    expect(livre).toBe(true)
  })
})

describe('silêncio fora do socket', () => {
  const bloco = 1280
  const enviarBlocos = (sessao: SessaoServidor, quantidade: number, quadro: () => Float32Array) => { for (let i = 0; i < quantidade; i++) sessao.enviar(quadro()) }

  it('manda a fala com a pré-rolagem e a cauda, não manda o silêncio e devolve os tempos ao relógio da sessão', async () => {
    const sessao = await abrir()
    enviarBlocos(sessao, 10, () => voz(bloco))
    enviarBlocos(sessao, 40, () => new Float32Array(bloco))
    enviarBlocos(sessao, 10, () => voz(bloco))
    expect(socket().quadros()).toHaveLength(10 + 10 + 4 + 10)
    socket().receber(final(0, 'profissional', [palavra('Bom', 200, 500), palavra('dia', 1200, 1600), palavra('doutora', 1920, 2400)]))
    expect(ultimo().palavras.map((item) => [item.texto, item.inicioMs, item.fimMs])).toEqual([['Bom', 200, 500], ['dia', 1200, 1600], ['doutora', 4000, 4480]])
    expect(ultimo().estavelAteMs).toBe(4481)
  })

  it('a fala que volta depois de uma pausa longa não encolhe a linha do tempo da fala anterior', async () => {
    const sessao = await abrir()
    enviarBlocos(sessao, 5, () => voz(bloco))
    enviarBlocos(sessao, 400, () => new Float32Array(bloco))
    enviarBlocos(sessao, 5, () => voz(bloco))
    socket().receber(final(0, 'profissional', [palavra('Oi', 100, 300), palavra('de', 1500, 1900)]))
    expect(ultimo().palavras.map((item) => [item.inicioMs, item.fimMs])).toEqual([[100, 300], [32_380, 32_780]])
  })
})

describe('encerramento', () => {
  it('envia o comando concluir, espera o "concluida" e devolve só o que é final antes de fechar o socket', async () => {
    const sessao = await abrir()
    socket().receber(parcial('Oi', 400))
    socket().bufferedAmount = 100_000
    sessao.enviar(voz(10))
    const concluida = sessao.concluir()
    expect(sessao.concluir()).toBe(concluida)
    expect(socket().comandos().at(-1)).toEqual({ type: 'concluir' })
    socket().receber(parcial('Oi tudo', 700))
    socket().receber(final(0, 'profissional', [palavra('Oi', 100, 400)]))
    socket().receber({ type: 'concluida' })
    await expect(concluida).resolves.toEqual({ palavras: [{ texto: 'Oi', inicioMs: 100, fimMs: 400, locutor: 'profissional' }], finais: 1, estavelAteMs: 401 })
    expect(socket().fechado).toBe(true)
    await expect(sessao.concluir()).resolves.toMatchObject({ finais: 1 })
  })

  it('"concluida" sem pedido de conclusão não faz nada', async () => {
    await abrir()
    socket().receber({ type: 'concluida' })
    expect(socket().fechado).toBe(false)
  })

  it('falha se o gateway fica 30 s em silêncio depois do pedido, e cada evento renova o prazo', async () => {
    const sessao = await abrir()
    const concluida = sessao.concluir()
    const rejeitada = expect(concluida).rejects.toThrow('O serviço de transcrição parou de responder.')
    await vi.advanceTimersByTimeAsync(29_000)
    socket().receber(parcial(''))
    await vi.advanceTimersByTimeAsync(29_000)
    expect(falhas).toEqual([])
    await vi.advanceTimersByTimeAsync(1_000)
    await rejeitada
    expect(falhas.map((erro) => erro.message)).toEqual(['O serviço de transcrição parou de responder.'])
    expect(socket().fechado).toBe(true)
  })

  it('descartar fecha o socket, cancela a conclusão pendente e é idempotente', async () => {
    const sessao = await abrir()
    const concluida = sessao.concluir()
    const rejeitada = expect(concluida).rejects.toMatchObject({ name: 'AbortError' })
    sessao.descartar()
    sessao.descartar()
    await rejeitada
    expect(socket().fechado).toBe(true)
    expect(falhas).toEqual([])
  })

  it('descartar sem conclusão pendente só fecha, e concluir depois dele é cancelamento', async () => {
    const sessao = await abrir()
    sessao.descartar()
    await expect(sessao.concluir()).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('queda e reconexão', () => {
  const pcm = voz

  it('avisa, guarda as palavras finais, reabre outra sessão com o mesmo perfil e continua o relógio dela', async () => {
    const sessao = await abrir()
    sessao.enviar(pcm(16_000))
    socket().receber(final(0, 'profissional', [palavra('Bom', 100, 300), palavra('dia', 400, 600)]))
    socket().receber(parcial('doutora', 900))
    sessao.enviar(pcm(16_000))
    socket().cair()
    expect(ultimo()).toEqual({
      palavras: [{ texto: 'Bom', inicioMs: 100, fimMs: 300, locutor: 'profissional' }, { texto: 'dia', inicioMs: 400, fimMs: 600, locutor: 'profissional' }],
      finais: 2,
      estavelAteMs: 601,
      aviso: 'reconectando',
    })
    sessao.enviar(pcm(8_000))
    sessao.enviar(pcm(8_000))
    expect(SocketFalso.todos).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(SocketFalso.todos).toHaveLength(2)
    socket(1).abrir()
    expect(socket(1).comandos()).toEqual([{ type: 'iniciar', sample_rate: 16000, idioma: 'pt', modo: 'presencial', perfil: PERFIL }])
    socket(1).receber({ type: 'pronta' })
    expect(socket(1).quadros().map((quadro) => quadro.length)).toEqual([8_000, 8_000])
    expect('aviso' in ultimo()).toBe(false)
    socket(1).receber(final(0, 'paciente', [palavra('Entendi', 200, 800)]))
    expect(ultimo().palavras.map((item) => [item.texto, item.inicioMs, item.fimMs, item.locutor])).toEqual([
      ['Bom', 100, 300, 'profissional'], ['dia', 400, 600, 'profissional'], ['Entendi', 2200, 2800, 'paciente'],
    ])
    expect(ultimo().finais).toBe(3)
    expect(ultimo().estavelAteMs).toBe(2801)
  })

  it('as frases do gateway antigo não são corrigidas pelo novo', async () => {
    await abrir()
    socket().receber(final(0, null, [palavra('Oi', 100, 300)]))
    socket().cair()
    await vi.advanceTimersByTimeAsync(0)
    socket(1).abrir()
    socket(1).receber({ type: 'pronta' })
    const antes = resultados.length
    socket(1).receber({ type: 'falante', frase: 0, falante: 'paciente' })
    expect(resultados).toHaveLength(antes)
    expect(ultimo().palavras[0]!.locutor).toBeNull()
  })

  it('tenta de novo com espera crescente e desiste depois de cinco tentativas', async () => {
    const sessao = await abrir()
    socket().cair()
    for (const [indice, espera] of [0, 1000, 2000, 4000, 8000].entries()) {
      if (espera > 0) {
        await vi.advanceTimersByTimeAsync(espera - 1)
        expect(SocketFalso.todos).toHaveLength(indice + 1)
      }
      await vi.advanceTimersByTimeAsync(espera > 0 ? 1 : 0)
      expect(SocketFalso.todos).toHaveLength(indice + 2)
      socket(indice + 1).cair()
    }
    expect(falhas.map((erro) => erro.message)).toEqual(['A conexão com a transcrição foi perdida.'])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(SocketFalso.todos).toHaveLength(6)
    sessao.enviar(pcm(10))
    await expect(sessao.concluir()).rejects.toThrow('foi perdida')
  })

  it('uma tentativa que não fica pronta em 10 s conta como falha', async () => {
    await abrir()
    socket().cair()
    await vi.advanceTimersByTimeAsync(0)
    expect(SocketFalso.todos).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(socket(1).fechado).toBe(true)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(SocketFalso.todos).toHaveLength(3)
  })

  it('ignora eventos de um socket que já foi trocado', async () => {
    await abrir()
    const antigo = socket()
    antigo.cair()
    await vi.advanceTimersByTimeAsync(0)
    socket(1).abrir()
    socket(1).receber({ type: 'pronta' })
    antigo.receber(final(0, 'paciente', [palavra('velho', 0, 1000)]))
    antigo.cair()
    expect(resultados.at(-1)!.palavras).toEqual([])
    expect(SocketFalso.todos).toHaveLength(2)
    expect(falhas).toEqual([])
  })

  it('esvaziada espera a reconexão, e concluir durante a queda manda o comando só depois do áudio guardado', async () => {
    const sessao = await abrir()
    socket().cair()
    sessao.enviar(pcm(16))
    let livre = false
    void sessao.esvaziada().then(() => { livre = true })
    await vi.advanceTimersByTimeAsync(100)
    expect(livre).toBe(false)
    const concluida = sessao.concluir()
    await vi.advanceTimersByTimeAsync(0)
    socket(1).abrir()
    socket(1).receber({ type: 'pronta' })
    await vi.advanceTimersByTimeAsync(25)
    expect(livre).toBe(true)
    expect(socket(1).enviados.map((item) => typeof item === 'string' ? JSON.parse(item).type : 'pcm')).toEqual(['iniciar', 'pcm', 'concluir'])
    socket(1).receber({ type: 'concluida' })
    await expect(concluida).resolves.toMatchObject({ palavras: [] })
  })

  it('pede a conclusão de novo na sessão seguinte quando a queda pega a conclusão no meio', async () => {
    const sessao = await abrir()
    const concluida = sessao.concluir()
    socket().cair()
    expect(ultimo().aviso).toBe('reconectando')
    await vi.advanceTimersByTimeAsync(0)
    socket(1).abrir()
    socket(1).receber({ type: 'pronta' })
    expect(socket(1).comandos().map((comando) => comando.type)).toEqual(['iniciar', 'concluir'])
    socket(1).receber({ type: 'concluida' })
    await expect(concluida).resolves.toMatchObject({ finais: 0 })
  })

  it('descartar durante a queda cancela a nova tentativa', async () => {
    const sessao = await abrir()
    socket().cair()
    sessao.descartar()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(SocketFalso.todos).toHaveLength(1)
  })
})
