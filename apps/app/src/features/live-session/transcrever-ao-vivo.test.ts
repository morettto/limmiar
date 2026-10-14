import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { abrirMicrofone, type MicrofoneAutorizado } from '../../entities/consentimento/microfone'
import { capturarPcm } from '../../shared/audio/capturar-pcm'
import { abrirTranscricao, type ResultadoTranscricao } from '../../shared/audio/transcricao-servidor'
import { papelDoFalante, transcreverAoVivo } from './transcrever-ao-vivo'
import { dynamicActivate } from '../../shared/i18n'

beforeAll(async () => dynamicActivate('pt-BR'))

vi.mock('../../shared/audio/capturar-pcm', () => ({ capturarPcm: vi.fn() }))
vi.mock('../../shared/audio/transcricao-servidor', () => ({ abrirTranscricao: vi.fn() }))

const capturar = vi.mocked(capturarPcm)
const abrir = vi.mocked(abrirTranscricao)
const encerrarCaptura = vi.fn(async () => {})
const pausar = vi.fn()
const cancelar = vi.fn()
const atualizar = vi.fn()
const falhar = vi.fn()
const parar = vi.fn()
const servidor = { enviar: vi.fn(), esvaziada: vi.fn(), concluir: vi.fn(), descartar: vi.fn() }
let microfone: MicrofoneAutorizado
let perfil: number[]

const ola = { texto: 'Olá', inicioMs: 100, fimMs: 300, locutor: 'profissional' }
const mundo = { texto: 'mundo', inicioMs: 5000, fimMs: 5400, locutor: 'paciente' }
const resultado = (palavras: typeof ola[], finais: number, estavelAteMs = 0): ResultadoTranscricao => ({ palavras, finais, estavelAteMs })

async function iniciar(abort = new AbortController()) {
  return transcreverAoVivo(microfone.stream, abort.signal, atualizar, falhar, { trilhas: 'proprias', perfil })
}
async function iniciarEmprestada(receberPcm?: (pcm: Float32Array) => void) {
  return transcreverAoVivo(microfone.stream, new AbortController().signal, atualizar, falhar, { trilhas: 'emprestadas', falante: 'paciente', receberPcm })
}
const opcoes = () => abrir.mock.calls.at(-1)![0]
const pcmCapturado = (pcm: Float32Array) => capturar.mock.calls.at(-1)![2](pcm)
const aoFalharCaptura = () => capturar.mock.calls.at(-1)![3]()

beforeEach(async () => {
  perfil = [0.5, 0.25, -0.75]
  abrir.mockResolvedValue(servidor)
  servidor.concluir.mockResolvedValue(resultado([ola, mundo], 2, 5401))
  capturar.mockResolvedValue({ encerrar: encerrarCaptura, pausar, cancelar })
  const autorizado = await abrirMicrofone('concedido', { getUserMedia: async () => ({ getTracks: () => [{ stop: parar }] }) } as unknown as MediaDevices)
  if (!autorizado.ok) throw new Error('Microfone fictício falhou')
  microfone = autorizado.microfone
})
afterEach(() => { vi.clearAllMocks() })

describe('papelDoFalante', () => {
  it('só os papéis confirmados recebem profissional ou paciente', () => {
    expect(papelDoFalante('profissional')).toBe('voce')
    expect(papelDoFalante('paciente')).toBe('paciente')
    expect(papelDoFalante('pessoa_2')).toBeNull()
  })
})

describe('transcrição e identificação de quem fala no gateway', () => {
  it('ouve durante a abertura do gateway e envia a primeira fala inteira em ordem quando ele fica pronto', async () => {
    let conectar!: (aberta: typeof servidor) => void
    abrir.mockImplementationOnce(() => new Promise((resolve) => { conectar = resolve }))
    const iniciando = iniciar()
    expect(capturar).toHaveBeenCalledOnce()
    const primeiro = new Float32Array([0.1, 0.2])
    const segundo = new Float32Array([0.3])
    pcmCapturado(primeiro); pcmCapturado(segundo)
    expect(servidor.enviar).not.toHaveBeenCalled()
    conectar(servidor)
    const sessao = await iniciando
    const terceiro = new Float32Array([0.4])
    pcmCapturado(terceiro)
    expect(servidor.enviar.mock.calls).toEqual([[primeiro], [segundo], [terceiro]])
    await sessao.encerrar()
  })

  it('não acumula áudio sem limite se a abertura exceder dez segundos de captura', async () => {
    let conectar!: (aberta: typeof servidor) => void
    abrir.mockImplementationOnce(() => new Promise((resolve) => { conectar = resolve }))
    const iniciando = iniciar()
    const rejeitada = expect(iniciando).rejects.toMatchObject({ name: 'AbortError' })
    pcmCapturado(new Float32Array(160000))
    pcmCapturado(new Float32Array(1))
    pcmCapturado(new Float32Array(1))
    conectar(servidor)
    await rejeitada
    expect(falhar).toHaveBeenCalledOnce()
    expect(cancelar).toHaveBeenCalledOnce()
    expect(servidor.descartar).toHaveBeenCalledOnce()
    expect(servidor.enviar).not.toHaveBeenCalled()
    expect(perfil).toEqual([0, 0, 0])
  })

  it('apresenta o perfil de voz ao gateway e liga a captura ao envio', async () => {
    await iniciar()
    expect(opcoes()).toMatchObject({ identidade: { modo: 'presencial', perfil } })
    expect(capturar.mock.calls[0]![4]).toMatchObject({ trilhas: 'proprias', aoEncerrarTrilha: undefined })
    const pcm = new Float32Array([0.1, 0.2])
    pcmCapturado(pcm)
    expect(servidor.enviar).toHaveBeenCalledWith(pcm)
  })

  it('publica cada resultado do gateway', async () => {
    await iniciar()
    const recebido = { ...resultado([ola, mundo], 1, 1500), aviso: 'atrasada' as const }
    opcoes().aoResultado(recebido)
    expect(atualizar).toHaveBeenLastCalledWith(recebido)
  })

  it('pausa a captura', async () => {
    const sessao = await iniciar()
    sessao.pausar(true)
    expect(pausar).toHaveBeenCalledWith(true)
  })

  it('encerrar drena o microfone, fecha o gateway, publica o texto final, apaga o perfil e libera tudo uma vez', async () => {
    const sessao = await iniciar()
    opcoes().aoResultado(resultado([ola], 0))
    await sessao.encerrar()
    await sessao.encerrar()
    expect(encerrarCaptura).toHaveBeenCalledOnce()
    expect(servidor.concluir).toHaveBeenCalledOnce()
    expect(atualizar).toHaveBeenLastCalledWith(resultado([ola, mundo], 2, 5401))
    expect(parar).toHaveBeenCalled()
    expect(cancelar).toHaveBeenCalledOnce()
    expect(servidor.descartar).toHaveBeenCalledOnce()
    expect(perfil).toEqual([0, 0, 0])
    expect(falhar).not.toHaveBeenCalled()
    const chamadas = atualizar.mock.calls.length
    pcmCapturado(new Float32Array(1)); opcoes().aoResultado(resultado([], 0))
    expect(atualizar).toHaveBeenCalledTimes(chamadas)
    expect(servidor.enviar).not.toHaveBeenCalled()
  })

  it('trilha emprestada: o gateway só carimba o falante da trilha, sem perfil, e a chamada não é parada', async () => {
    const dosOutros = vi.fn()
    const sessao = await iniciarEmprestada(dosOutros)
    expect(opcoes()).toMatchObject({ identidade: { modo: 'online', falante: 'paciente' } })
    opcoes().aoResultado(resultado([ola, mundo], 1, 301))
    expect(atualizar).toHaveBeenLastCalledWith(resultado([ola, mundo], 1, 301))
    const pcm = new Float32Array(1)
    pcmCapturado(pcm)
    expect(dosOutros).toHaveBeenCalledWith(pcm)
    await sessao.encerrar()
    expect(parar).not.toHaveBeenCalled()
    expect(servidor.descartar).toHaveBeenCalledOnce()
  })

  it('trilha emprestada sem ouvinte de PCM também funciona', async () => {
    await iniciarEmprestada()
    pcmCapturado(new Float32Array(1))
    expect(servidor.enviar).toHaveBeenCalledOnce()
  })

  it('quando a chamada derruba a trilha emprestada, encerra a transcrição sozinha', async () => {
    await iniciarEmprestada()
    capturar.mock.calls[0]![4].aoEncerrarTrilha!()
    await vi.waitFor(() => expect(servidor.descartar).toHaveBeenCalledOnce())
    expect(atualizar).toHaveBeenLastCalledWith(expect.objectContaining({ finais: 2 }))
    expect(falhar).not.toHaveBeenCalled()
  })

  it('interrompe uma trilha emprestada se o fechamento falhar, sem parar a chamada', async () => {
    await iniciarEmprestada()
    encerrarCaptura.mockRejectedValueOnce(new Error('cauda'))
    capturar.mock.calls[0]![4].aoEncerrarTrilha!()
    await vi.waitFor(() => expect(falhar).toHaveBeenCalledOnce())
    expect(parar).not.toHaveBeenCalled()
  })
})

describe('falhas', () => {
  it('descarta o gateway que termina de abrir depois de a captura falhar', async () => {
    let conectar!: (aberta: typeof servidor) => void
    abrir.mockImplementationOnce(() => new Promise((resolve) => { conectar = resolve }))
    capturar.mockRejectedValueOnce(new Error('captura'))
    await expect(iniciar()).rejects.toThrow('captura')
    conectar(servidor)
    await vi.waitFor(() => expect(servidor.descartar).toHaveBeenCalledOnce())
    expect(servidor.enviar).not.toHaveBeenCalled()
  })

  it('libera a captura que termina de abrir depois de o gateway falhar', async () => {
    let capturada!: (aberta: { encerrar: typeof encerrarCaptura; pausar: typeof pausar; cancelar: typeof cancelar }) => void
    capturar.mockImplementationOnce(() => new Promise((resolve) => { capturada = resolve }))
    abrir.mockRejectedValueOnce(new Error('servidor'))
    await expect(iniciar()).rejects.toThrow('servidor')
    capturada({ encerrar: encerrarCaptura, pausar, cancelar })
    await vi.waitFor(() => expect(cancelar).toHaveBeenCalledOnce())
  })

  it('o gateway falha: para o microfone, apaga o perfil, libera tudo, avisa uma vez e rejeita o encerramento', async () => {
    const sessao = await iniciar()
    const causa = new Error('falhou')
    opcoes().falhar(causa)
    opcoes().falhar(new Error('de novo'))
    await expect(sessao.encerrar()).rejects.toBe(causa)
    expect(falhar).toHaveBeenCalledOnce()
    expect(falhar).toHaveBeenCalledWith(causa)
    expect(parar).toHaveBeenCalled()
    expect(servidor.descartar).toHaveBeenCalledOnce()
    expect(cancelar).toHaveBeenCalledOnce()
    expect(perfil).toEqual([0, 0, 0])
  })

  it('o microfone interrompido encerra com mensagem própria', async () => {
    const sessao = await iniciar()
    aoFalharCaptura()
    await expect(sessao.encerrar()).rejects.toThrow('microfone')
    expect(falhar).toHaveBeenCalledOnce()
  })

  it.each([
    ['a drenagem do microfone', () => encerrarCaptura.mockRejectedValueOnce(new Error('cauda'))],
    ['o pedido de conclusão ao gateway', () => servidor.concluir.mockRejectedValueOnce(new Error('servidor'))],
  ])('falha em %s ao encerrar não se perde em silêncio', async (_etapa, preparar) => {
    const sessao = await iniciar()
    preparar()
    await expect(sessao.encerrar()).rejects.toThrow('concluir')
    expect(falhar).toHaveBeenCalledOnce()
    expect(parar).toHaveBeenCalled()
  })

  it('uma falha durante a drenagem do microfone impede a publicação final', async () => {
    let liberarCaptura!: () => void
    encerrarCaptura.mockImplementationOnce(() => new Promise<void>((resolve) => { liberarCaptura = resolve }))
    const sessao = await iniciar()
    const fim = sessao.encerrar()
    const verifica = expect(fim).rejects.toThrow('interrompido')
    aoFalharCaptura()
    liberarCaptura()
    await verifica
    expect(servidor.concluir).not.toHaveBeenCalled()
  })

  it('falha do gateway durante o fechamento impede a publicação final', async () => {
    let falharServidor!: (erro: Error) => void
    servidor.concluir.mockImplementationOnce(() => new Promise((resolve) => {
      falharServidor = (erro) => { opcoes().falhar(erro); resolve(resultado([], 0)) }
    }))
    const sessao = await iniciar()
    const fim = sessao.encerrar()
    const verifica = expect(fim).rejects.toThrow('servidor')
    await vi.waitFor(() => expect(servidor.concluir).toHaveBeenCalled())
    falharServidor(new Error('servidor'))
    await verifica
    expect(atualizar).not.toHaveBeenCalled()
  })

  it.each(['servidor', 'captura'])('falha ao preparar %s libera o que já estava aberto, apaga o perfil e propaga o erro', async (etapa) => {
    if (etapa === 'servidor') abrir.mockRejectedValueOnce(new Error('servidor'))
    if (etapa === 'captura') capturar.mockRejectedValueOnce(new Error('captura'))
    await expect(iniciar()).rejects.toThrow(etapa)
    expect(parar).toHaveBeenCalled()
    expect(perfil).toEqual([0, 0, 0])
    if (etapa === 'captura') expect(servidor.descartar).toHaveBeenCalledOnce()
  })
})

describe('cancelamento', () => {
  it('já cancelado: não abre nada, apaga o perfil e rejeita com AbortError', async () => {
    const abort = new AbortController()
    abort.abort()
    await expect(iniciar(abort)).rejects.toMatchObject({ name: 'AbortError', message: 'Cancelado' })
    expect(abrir).not.toHaveBeenCalled()
    expect(capturar).not.toHaveBeenCalled()
    expect(parar).toHaveBeenCalled()
    expect(perfil).toEqual([0, 0, 0])
  })

  it('cancelar com o gateway conectando descarta a sessão e libera a captura iniciada em paralelo', async () => {
    const abort = new AbortController()
    abrir.mockImplementationOnce(async () => { abort.abort(); return servidor })
    await expect(iniciar(abort)).rejects.toMatchObject({ name: 'AbortError', message: 'Cancelado' })
    expect(capturar).toHaveBeenCalledOnce()
    expect(cancelar).toHaveBeenCalledOnce()
    expect(servidor.descartar).toHaveBeenCalled()
  })

  it('libera uma captura que terminou de abrir depois do cancelamento', async () => {
    const abort = new AbortController()
    capturar.mockImplementationOnce(async () => { abort.abort(); return { encerrar: encerrarCaptura, pausar, cancelar } })
    await expect(iniciar(abort)).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancelar).toHaveBeenCalledOnce()
    expect(parar).toHaveBeenCalledOnce()
    expect(servidor.descartar).toHaveBeenCalledOnce()
  })

  it('cancelar depois de iniciado fecha tudo e avisa com AbortError', async () => {
    const abort = new AbortController()
    const sessao = await iniciar(abort)
    abort.abort()
    await expect(sessao.encerrar()).rejects.toMatchObject({ name: 'AbortError', message: 'Cancelado' })
    expect(falhar).toHaveBeenCalledWith(expect.objectContaining({ name: 'AbortError', message: 'Cancelado' }))
    expect(parar).toHaveBeenCalled()
    expect(servidor.descartar).toHaveBeenCalled()
    expect(perfil).toEqual([0, 0, 0])
  })

  it('encerrar depois de a transcrição já ter falhado não toca mais na captura nem no servidor', async () => {
    const sessao = await iniciar()
    opcoes().falhar(new Error('gateway caiu'))
    encerrarCaptura.mockClear(); servidor.concluir.mockClear()
    await expect(sessao.encerrar()).rejects.toThrow('gateway caiu')
    expect(encerrarCaptura).not.toHaveBeenCalled()
    expect(servidor.concluir).not.toHaveBeenCalled()
  })

  it('solta o ouvinte de cancelamento ao fechar', async () => {
    const abort = new AbortController()
    const remover = vi.spyOn(abort.signal, 'removeEventListener')
    const sessao = await iniciar(abort)
    await sessao.encerrar()
    expect(remover).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})
