import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { conectarChamada } from './chamada'

class Socket {
  static OPEN = 1
  static instancias: Socket[] = []
  readyState = 1
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  send = vi.fn()
  close = vi.fn(() => { this.readyState = 3; this.onclose?.() })
  readonly url: URL
  constructor(url: URL) { this.url = url; Socket.instancias.push(this) }
  receber(data: unknown) { this.onmessage?.({ data: typeof data === 'object' && data !== null ? JSON.stringify(data) : data }) }
}
class Peer {
  static instancias: Peer[] = []
  onicecandidate: ((event: { candidate: { toJSON(): RTCIceCandidateInit } | null }) => void) | null = null
  ontrack: ((event: { streams: MediaStream[]; track: MediaStreamTrack }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  connectionState = 'new'
  localDescription: RTCSessionDescriptionInit | null = null
  remoteDescription: RTCSessionDescriptionInit | null = null
  close = vi.fn()
  addTrack = vi.fn()
  addIceCandidate = vi.fn().mockResolvedValue(undefined)
  createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'oferta' })
  createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'resposta' })
  setLocalDescription = vi.fn(async (sdp: RTCSessionDescriptionInit) => { this.localDescription = sdp })
  setRemoteDescription = vi.fn(async (sdp: RTCSessionDescriptionInit) => { this.remoteDescription = sdp })
  readonly config: RTCConfiguration
  constructor(config: RTCConfiguration) { this.config = config; Peer.instancias.push(this) }
}
const stop = vi.fn()
const track = { enabled: true, stop }
const stream = { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream
let controller: AbortController
const estado = vi.fn(), receber = vi.fn(), falhar = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  Socket.instancias = []; Peer.instancias = []
  controller = new AbortController(); track.enabled = true
  vi.stubGlobal('WebSocket', Socket); vi.stubGlobal('RTCPeerConnection', Peer)
  vi.stubGlobal('MediaStream', class {
    readonly tracks: MediaStreamTrack[]
    constructor(tracks: MediaStreamTrack[]) { this.tracks = tracks }
    getTracks() { return this.tracks }
  })
})
afterEach(() => { controller.abort(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks() })
function iniciar(papel: 'professional' | 'patient' = 'professional', baseUrl = '/api') {
  return conectarChamada({ baseUrl, roomId: 'sala', token: 'credencial', papel, stream,
    signal: controller.signal, estado, receber, falhar })
}
async function drenar() { await vi.advanceTimersByTimeAsync(0) }
async function conectar(papel: 'professional' | 'patient' = 'professional') {
  const pronto = iniciar(papel)
  const socket = Socket.instancias[0]!
  socket.onopen?.()
  socket.receber({ type: 'joined', role: papel, iceServers: [{ urls: 'stun:exemplo.test' }] })
  await drenar()
  return { chamada: await pronto, socket, peer: Peer.instancias[0]! }
}
describe('sinalização e trilhas da sessão online', () => {
  it('usa transporte WSS quando o servidor do convite está em HTTPS', async () => {
    const pronto = iniciar('professional', 'https://limmiar.test/api')
    const socket = Socket.instancias[0]!
    expect(socket.url.protocol).toBe('wss:')
    socket.receber({ type: 'joined', role: 'professional', iceServers: [] })
    await drenar(); (await pronto).sair()
  })
  it('não publica estado conectado durante negociação e encerra se o transporte de ICE fechar', async () => {
    const { socket, peer } = await conectar()
    peer.onconnectionstatechange?.()
    expect(estado).toHaveBeenLastCalledWith('aguardando')
    socket.readyState = 3
    peer.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: 'ice' }) } })
    expect(falhar).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledOnce()
  })
  it.each([{ type: 'answer', sdp: '' }, { type: 'offer', sdp: 'papel invertido' }])('recusa SDP inválido depois da entrada: %j', async frame => {
    const { socket } = await conectar()
    socket.receber(frame); await drenar()
    expect(falhar).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledOnce()
  })
  it('autentica no primeiro frame e mantém o segredo fora da URL', async () => {
    const { chamada, socket, peer } = await conectar()
    expect(socket.url.protocol).toBe('ws:')
    expect(socket.url.pathname).toBe('/api/online-sessions/sala/signal')
    expect(socket.url.search).toBe(''); expect(socket.url.hash).toBe('')
    expect(socket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ token: 'credencial' }))
    expect(peer.config).toEqual({ iceServers: [{ urls: 'stun:exemplo.test' }] })
    expect(peer.addTrack).toHaveBeenCalledWith(track, stream)
    expect(estado).toHaveBeenCalledWith('aguardando')
    chamada.sair()
    expect(stop).toHaveBeenCalledOnce(); expect(peer.close).toHaveBeenCalledOnce()
    expect(socket.send.mock.calls.some(([message]) => JSON.parse(message).type === 'end')).toBe(false)
  })
  it('profissional oferece e recebe resposta; paciente apenas responde', async () => {
    const { chamada, socket, peer } = await conectar()
    socket.receber({ type: 'peer-ready' }); await drenar()
    expect(peer.createOffer).toHaveBeenCalledWith({ iceRestart: false })
    expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'offer', sdp: 'oferta' }))
    socket.receber({ type: 'answer', sdp: 'resposta remota' }); await drenar()
    expect(peer.remoteDescription).toEqual({ type: 'answer', sdp: 'resposta remota' })
    chamada.sair(); Socket.instancias = []; Peer.instancias = []
    const paciente = await conectar('patient')
    paciente.socket.receber({ type: 'peer-ready' }); await drenar()
    expect(paciente.peer.createOffer).not.toHaveBeenCalled()
    paciente.socket.receber({ type: 'offer', sdp: 'oferta remota' }); await drenar()
    expect(paciente.peer.createAnswer).toHaveBeenCalledOnce()
    expect(paciente.socket.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'answer', sdp: 'resposta' }))
    paciente.chamada.sair()
  })
  it('preserva ICE recebido antes do SDP e envia o candidato da conexão atual', async () => {
    const { chamada, socket, peer } = await conectar()
    const candidate = { candidate: 'candidate:1', sdpMLineIndex: 0 }
    socket.receber({ type: 'ice', candidate }); await drenar()
    expect(peer.addIceCandidate).not.toHaveBeenCalled()
    socket.receber({ type: 'answer', sdp: 'resposta' }); await drenar()
    expect(peer.addIceCandidate).toHaveBeenCalledWith(candidate)
    socket.receber({ type: 'ice', candidate }); await drenar()
    expect(peer.addIceCandidate).toHaveBeenCalledTimes(2)
    peer.onicecandidate?.({ candidate: { toJSON: () => candidate } })
    expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'ice', candidate }))
    peer.onicecandidate?.({ candidate: null })
    chamada.sair()
    peer.onicecandidate?.({ candidate: { toJSON: () => candidate } })
    expect(falhar).not.toHaveBeenCalled()
  })
  it('recebe trilha remota, controla estado e silencia a trilha original', async () => {
    const { chamada, peer } = await conectar()
    const remoto = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream
    peer.ontrack?.({ streams: [remoto], track: track as unknown as MediaStreamTrack })
    expect(receber).toHaveBeenCalledWith(remoto)
    peer.connectionState = 'connected'; peer.onconnectionstatechange?.()
    expect(estado).toHaveBeenLastCalledWith('conectada')
    peer.connectionState = 'disconnected'; peer.onconnectionstatechange?.()
    expect(estado).toHaveBeenLastCalledWith('interrompida')
    peer.connectionState = 'failed'; peer.onconnectionstatechange?.()
    expect(estado).toHaveBeenLastCalledWith('interrompida')
    chamada.silenciar(true); expect(track.enabled).toBe(false)
    chamada.silenciar(false); expect(track.enabled).toBe(true)
    chamada.encerrar(); chamada.encerrar()
    expect(stop).toHaveBeenCalledOnce()
    peer.ontrack?.({ streams: [], track: track as unknown as MediaStreamTrack })
  })
  it('recria peer na saída temporária e permite retorno sem reaproveitar trilhas antigas', async () => {
    const { chamada, socket, peer } = await conectar()
    const remoteStop = vi.fn()
    peer.ontrack?.({ streams: [], track: { stop: remoteStop } as unknown as MediaStreamTrack })
    socket.receber({ type: 'peer-left' }); await drenar()
    expect(remoteStop).toHaveBeenCalledOnce()
    expect(Peer.instancias).toHaveLength(2)
    const novo = Peer.instancias[1]!
    peer.ontrack?.({ streams: [], track: track as unknown as MediaStreamTrack })
    peer.connectionState = 'connected'; peer.onconnectionstatechange?.()
    expect(estado).toHaveBeenLastCalledWith('interrompida')
    socket.receber({ type: 'peer-ready' }); await drenar()
    expect(novo.createOffer).toHaveBeenCalledOnce()
    chamada.sair()
  })
  it('reconecta por ICE com um único ofertante e aceita pong', async () => {
    const { chamada, socket, peer } = await conectar()
    await chamada.reconectar()
    expect(peer.createOffer).toHaveBeenCalledWith({ iceRestart: true })
    socket.receber({ type: 'restart' }); socket.receber({ type: 'pong' }); await drenar()
    expect(peer.createOffer).toHaveBeenCalledTimes(2)
    chamada.sair()
    await expect(chamada.reconectar()).rejects.toThrow('closed')
    Socket.instancias = []; Peer.instancias = []
    const paciente = await conectar('patient')
    await paciente.chamada.reconectar()
    expect(paciente.socket.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'restart' }))
    paciente.socket.receber({ type: 'restart' }); await drenar()
    expect(paciente.peer.createOffer).not.toHaveBeenCalled()
    paciente.chamada.sair()
  })
  it('encerra convite que expirou antes da confirmação sem deixar a entrada pendurada', async () => {
    const pronto = iniciar()
    const rejeitado = expect(pronto).rejects.toMatchObject({ name: 'AbortError' })
    Socket.instancias[0]!.receber({ type: 'ended' })
    await drenar(); await rejeitado
    expect(stop).toHaveBeenCalledOnce()
    expect(estado).toHaveBeenLastCalledWith('encerrada')
  })
  it('encerra mensagem de término e ignora frames posteriores', async () => {
    const { chamada, socket } = await conectar()
    socket.receber({ type: 'ended' }); socket.receber({ type: 'pong' }); await drenar()
    socket.receber({ type: 'qualquer-coisa' }); socket.onopen?.()
    expect(falhar).not.toHaveBeenCalled()
    expect(estado).toHaveBeenLastCalledWith('encerrada')
    chamada.sair()
  })
  it.each(['joined-wrong', 'joined-invalid', 'offer', 'answer-empty', 'unknown', 'invalid-json', 'binary', 'large', 'ice-empty'])('recusa sinalização inválida: %s', async variante => {
    const pronto = iniciar()
    const rejeitado = expect(pronto).rejects.toThrow()
    const socket = Socket.instancias[0]!
    const frames: Record<string, unknown> = {
      'joined-wrong': { type: 'joined', role: 'patient', iceServers: [] },
      'joined-invalid': { type: 'joined', role: 'professional', iceServers: null },
      offer: { type: 'offer', sdp: 'inverte papel' }, 'answer-empty': { type: 'answer', sdp: '' },
      unknown: { type: 'arquivo' }, 'invalid-json': '{', binary: new Uint8Array([1]), large: 'a'.repeat(65537),
      'ice-empty': { type: 'ice' },
    }
    if (variante === 'binary') socket.onmessage?.({ data: new Uint8Array([1]) })
    else socket.receber(frames[variante])
    await drenar(); await rejeitado
    expect(falhar).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledOnce()
  })
  it.each(['timeout', 'error', 'close', 'cancelled'])('libera recursos durante handshake: %s', async evento => {
    const pronto = iniciar()
    const rejeitado = expect(pronto).rejects.toThrow()
    const socket = Socket.instancias[0]!
    if (evento === 'timeout') await vi.advanceTimersByTimeAsync(15000)
    else if (evento === 'error') socket.onerror?.()
    else if (evento === 'close') socket.onclose?.()
    else controller.abort()
    await rejeitado
    expect(stop).toHaveBeenCalledOnce()
    socket.onopen?.(); expect(socket.send).not.toHaveBeenCalled()
  })
  it('não entra quando o cancelamento já foi solicitado', async () => {
    controller.abort()
    await expect(iniciar()).rejects.toMatchObject({ name: 'AbortError' })
    expect(stop).toHaveBeenCalledOnce()
  })
  const remotoCom = (parar: () => void) => ({ getTracks: () => [{ stop: parar }] }) as unknown as MediaStream
  const ice = (indice: number) => ({ type: 'ice', candidate: { candidate: `candidate:${indice}`, sdpMLineIndex: 0 } })

  it.each([
    ['timeout', 'Online call unavailable', 'interrompida'],
    ['error', 'Online call unavailable', 'interrompida'],
  ])('falha de handshake por %s rejeita com o motivo e avisa a tela', async (evento, mensagem, novoEstado) => {
    const pronto = iniciar()
    const rejeitado = expect(pronto).rejects.toThrow(mensagem)
    if (evento === 'timeout') await vi.advanceTimersByTimeAsync(15000)
    else Socket.instancias[0]!.onerror?.()
    await rejeitado
    expect(estado).toHaveBeenCalledExactlyOnceWith(novoEstado)
    expect(falhar).toHaveBeenCalledOnce()
  })

  it('cancelar rejeita como cancelamento e nada além disso', async () => {
    const pronto = iniciar()
    const rejeitado = expect(pronto).rejects.toMatchObject({ name: 'AbortError', message: 'Cancelled' })
    controller.abort()
    await rejeitado
    expect(estado).not.toHaveBeenCalled()
    expect(falhar).not.toHaveBeenCalled()
  })

  it('sair é idempotente, solta o ouvinte de cancelamento e para também as trilhas remotas', async () => {
    const { chamada, peer, socket } = await conectar()
    const parar = vi.fn()
    peer.ontrack?.({ streams: [remotoCom(parar)], track: track as unknown as MediaStreamTrack })
    const remover = vi.spyOn(controller.signal, 'removeEventListener')
    chamada.sair(); chamada.sair()
    expect(stop).toHaveBeenCalledOnce()
    expect(parar).toHaveBeenCalledOnce()
    expect(peer.close).toHaveBeenCalledOnce()
    expect(socket.close).toHaveBeenCalledOnce()
    expect(remover).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('encerrar avisa o servidor antes de fechar e depois avisa a tela; sem transporte, falha mas limpa', async () => {
    const { chamada, socket } = await conectar()
    chamada.encerrar()
    expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'end' }))
    expect(estado).toHaveBeenLastCalledWith('encerrada')
    expect(stop).toHaveBeenCalledOnce()

    Socket.instancias = []; Peer.instancias = []; stop.mockClear(); estado.mockClear()
    const segunda = await conectar()
    segunda.socket.readyState = 3
    expect(() => segunda.chamada.encerrar()).toThrow('Signaling unavailable')
    expect(stop).toHaveBeenCalledOnce()
    expect(estado).toHaveBeenLastCalledWith('encerrada')
  })

  it('reconectar avisa que está conectando e, sem transporte, recusa', async () => {
    const { chamada, socket } = await conectar('patient')
    estado.mockClear()
    await chamada.reconectar()
    expect(estado).toHaveBeenCalledExactlyOnceWith('conectando')
    socket.readyState = 3
    await expect(chamada.reconectar()).rejects.toThrow('Signaling unavailable')
  })

  it('cada falha ou queda de conexão avisa a tela uma vez como interrompida', async () => {
    const { chamada, peer } = await conectar()
    for (const situacao of ['disconnected', 'failed']) {
      estado.mockClear()
      peer.connectionState = situacao; peer.onconnectionstatechange?.()
      expect(estado).toHaveBeenCalledExactlyOnceWith('interrompida')
    }
    peer.connectionState = 'connecting'; estado.mockClear(); peer.onconnectionstatechange?.()
    expect(estado).not.toHaveBeenCalled()
    chamada.sair()
  })

  it('eventos de uma conexão antiga ou de uma chamada já fechada não chegam à tela nem ao servidor', async () => {
    const { chamada, socket, peer } = await conectar()
    socket.receber({ type: 'peer-left' }); await drenar()
    const enviados = socket.send.mock.calls.length
    receber.mockClear(); estado.mockClear()
    peer.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: 'velho' }) } })
    peer.ontrack?.({ streams: [remotoCom(vi.fn())], track: track as unknown as MediaStreamTrack })
    peer.connectionState = 'connected'; peer.onconnectionstatechange?.()
    expect(socket.send).toHaveBeenCalledTimes(enviados)
    expect(receber).not.toHaveBeenCalled()
    expect(estado).not.toHaveBeenCalled()

    const atual = Peer.instancias[1]!
    chamada.sair()
    atual.ontrack?.({ streams: [remotoCom(vi.fn())], track: track as unknown as MediaStreamTrack })
    atual.connectionState = 'connected'; atual.onconnectionstatechange?.()
    expect(receber).not.toHaveBeenCalled()
    expect(estado).not.toHaveBeenCalled()
  })

  it('a saída do outro lado antes de qualquer trilha remota não derruba a chamada', async () => {
    const { chamada, socket } = await conectar()
    socket.receber({ type: 'peer-left' }); await drenar()
    expect(falhar).not.toHaveBeenCalled()
    expect(estado).toHaveBeenLastCalledWith('interrompida')
    chamada.sair()
  })

  it('uma mensagem já na fila quando a chamada fecha não faz mais nada', async () => {
    const { chamada, socket, peer } = await conectar()
    socket.receber({ type: 'peer-ready' })
    chamada.sair()
    await drenar()
    expect(peer.createOffer).not.toHaveBeenCalled()
  })

  it('o reinício de ICE do outro lado reoferece com reinício e o pong não é erro', async () => {
    const { chamada, socket, peer } = await conectar()
    socket.receber({ type: 'restart' }); socket.receber({ type: 'pong' }); await drenar()
    expect(peer.createOffer).toHaveBeenCalledExactlyOnceWith({ iceRestart: true })
    expect(falhar).not.toHaveBeenCalled()
    chamada.sair()
  })

  it('o profissional não responde a resposta e os candidatos guardados são entregues uma única vez', async () => {
    const { chamada, socket, peer } = await conectar()
    socket.receber(ice(1)); await drenar()
    socket.receber({ type: 'answer', sdp: 'primeira' }); await drenar()
    socket.receber({ type: 'answer', sdp: 'segunda' }); await drenar()
    expect(peer.createAnswer).not.toHaveBeenCalled()
    expect(peer.addIceCandidate).toHaveBeenCalledExactlyOnceWith(ice(1).candidate)
    chamada.sair()
  })

  it('ICE antes da entrada na sala é recusado', async () => {
    const pronto = iniciar()
    const rejeitado = expect(pronto).rejects.toThrow()
    Socket.instancias[0]!.receber(ice(1))
    await drenar(); await rejeitado
    expect(falhar).toHaveBeenCalledOnce()
  })

  it('guarda até 128 candidatos antes do SDP e recusa o 129º', async () => {
    const { socket } = await conectar()
    for (let indice = 0; indice < 128; indice++) socket.receber(ice(indice))
    await drenar()
    expect(falhar).not.toHaveBeenCalled()
    socket.receber(ice(128)); await drenar()
    expect(falhar).toHaveBeenCalledOnce()
  })

  it('aceita 256 mensagens pendentes e recusa a 257ª, e a fila esvaziada libera espaço', async () => {
    const { chamada, socket } = await conectar()
    for (let indice = 0; indice < 256; indice++) socket.receber({ type: 'pong' })
    expect(falhar).not.toHaveBeenCalled()
    await drenar()
    for (let indice = 0; indice < 100; indice++) socket.receber({ type: 'pong' })
    await drenar()
    expect(falhar).not.toHaveBeenCalled()
    for (let indice = 0; indice < 257; indice++) socket.receber({ type: 'pong' })
    expect(falhar).toHaveBeenCalledOnce()
    chamada.sair()
  })

  it('aceita mensagem JSON de até 64 KiB e recusa a que passa disso', async () => {
    const { socket } = await conectar()
    const enchimento = (tamanho: number) => JSON.stringify({ type: 'pong', p: 'a'.repeat(tamanho - JSON.stringify({ type: 'pong', p: '' }).length) })
    socket.receber(enchimento(65536)); await drenar()
    expect(falhar).not.toHaveBeenCalled()
    socket.receber(enchimento(65537)); await drenar()
    expect(falhar).toHaveBeenCalledOnce()
  })

  it('só aceita mensagens de texto, mesmo que o conteúdo convertido fosse JSON válido', async () => {
    const { socket } = await conectar()
    socket.onmessage?.({ data: ['{"type":"pong"}'] })
    expect(falhar).toHaveBeenCalledOnce()
  })
})
