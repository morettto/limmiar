import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { abrirTranscricao } from '../../shared/audio/transcricao-servidor'
import { transcreverLocal } from './transcrever-local'

vi.mock('../../shared/audio/transcricao-servidor', () => ({ abrirTranscricao: vi.fn() }))

let pcm = new Float32Array(40000).fill(0.5)
const contextos: unknown[][] = []
const audio = { arrayBuffer: async () => new ArrayBuffer(8) } as Blob
const sessao = { enviar: vi.fn(), esvaziada: vi.fn(), concluir: vi.fn(), descartar: vi.fn() }
const palavras = [{ texto: 'Olá', inicioMs: 100, fimMs: 300, locutor: 'profissional' }, { texto: 'fim', inicioMs: 5000, fimMs: 5200, locutor: 'paciente' }]
let perfil: number[]

beforeEach(() => {
  perfil = [0.5, -0.25]
  pcm = new Float32Array(40000).fill(0.5)
  contextos.length = 0
  vi.stubGlobal('OfflineAudioContext', class {
    constructor(...argumentos: unknown[]) { contextos.push(argumentos) }
    destination = {}
    decodeAudioData = vi.fn().mockResolvedValue({ duration: 2.5 })
    createBufferSource = () => ({ connect: vi.fn(), start: vi.fn(), buffer: null })
    startRendering = vi.fn().mockResolvedValue({ getChannelData: () => pcm })
  })
  vi.mocked(abrirTranscricao).mockResolvedValue(sessao)
  sessao.esvaziada.mockResolvedValue(undefined)
  sessao.concluir.mockResolvedValue({ palavras, finais: 2, estavelAteMs: 5201 })
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('transcreverLocal', () => {
  it('manda a gravação inteira ao serviço, em quadros de 80 ms, esperando o socket escoar, e devolve as palavras com falante', async () => {
    const resultado = await transcreverLocal(audio, new AbortController().signal, perfil)
    expect(resultado).toEqual(palavras)
    expect(abrirTranscricao).toHaveBeenCalledWith(expect.objectContaining({ identidade: { modo: 'presencial', perfil } }))
    expect(perfil).toEqual([0, 0])
    expect(sessao.enviar.mock.calls.map(([trecho]) => (trecho as Float32Array).length)).toEqual([...Array<number>(31).fill(1280), 320])
    expect(sessao.esvaziada).toHaveBeenCalledTimes(32)
    expect(sessao.concluir).toHaveBeenCalledOnce()
    expect(sessao.descartar).toHaveBeenCalledOnce()
    const { aoResultado, falhar } = vi.mocked(abrirTranscricao).mock.calls[0]![0]
    expect(() => { aoResultado({ palavras: [], finais: 0, estavelAteMs: 0 }); falhar(new Error('a falha de verdade rejeita concluir')) }).not.toThrow()
  })

  it('não abre o serviço se o consentimento for revogado durante a decodificação', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(transcreverLocal(audio, controller.signal, perfil)).rejects.toMatchObject({ name: 'AbortError' })
    expect(abrirTranscricao).not.toHaveBeenCalled()
  })

  it('descarta a sessão e para de enviar se o cancelamento chega no meio', async () => {
    const controller = new AbortController()
    sessao.esvaziada.mockImplementationOnce(async () => { controller.abort() })
    await expect(transcreverLocal(audio, controller.signal, perfil)).rejects.toMatchObject({ name: 'AbortError' })
    expect(sessao.enviar).toHaveBeenCalledOnce()
    expect(sessao.concluir).not.toHaveBeenCalled()
    expect(sessao.descartar).toHaveBeenCalled()
  })

  it('o cancelamento descarta a sessão na hora, mesmo com o envio parado', async () => {
    const controller = new AbortController()
    let descartesAoAbortar = -1
    sessao.esvaziada.mockImplementationOnce(() => new Promise<void>((resolver) => {
      controller.signal.addEventListener('abort', () => { descartesAoAbortar = sessao.descartar.mock.calls.length; resolver() })
    }))
    const pendente = transcreverLocal(audio, controller.signal, perfil)
    await vi.waitFor(() => expect(sessao.esvaziada).toHaveBeenCalled())
    controller.abort()
    await expect(pendente).rejects.toMatchObject({ name: 'AbortError' })
    expect(descartesAoAbortar).toBe(1)
  })

  it('cancelado depois de tudo pronto, não devolve texto', async () => {
    const controller = new AbortController()
    sessao.concluir.mockImplementationOnce(async () => { controller.abort(); return { palavras: [], finais: 0, estavelAteMs: 0 } })
    await expect(transcreverLocal(audio, controller.signal, perfil)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it.each([
    ['o servidor falha ao concluir', () => sessao.concluir.mockRejectedValueOnce(new Error('servidor'))],
    ['o servidor não abre', () => vi.mocked(abrirTranscricao).mockRejectedValueOnce(new Error('servidor'))],
  ])('propaga o erro quando %s', async (_caso, preparar) => {
    preparar()
    await expect(transcreverLocal(audio, new AbortController().signal, perfil)).rejects.toThrow('servidor')
    expect(perfil).toEqual([0, 0])
  })

  it('renderiza a gravação a 16 kHz com uma amostra por 1/16000 s de duração', async () => {
    await transcreverLocal(audio, new AbortController().signal, perfil)
    expect(contextos).toEqual([[1, 1, 16000], [1, 40000, 16000]])
  })

  it('uma gravação que é múltipla exata do quadro não manda um quadro vazio no fim', async () => {
    pcm = new Float32Array(2560).fill(0.5)
    await transcreverLocal(audio, new AbortController().signal, perfil)
    expect(sessao.enviar.mock.calls.map(([trecho]) => (trecho as Float32Array).length)).toEqual([1280, 1280])
  })

  it('solta o ouvinte de cancelamento ao terminar', async () => {
    const controller = new AbortController()
    const remover = vi.spyOn(controller.signal, 'removeEventListener')
    await transcreverLocal(audio, controller.signal, perfil)
    expect(remover).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})
