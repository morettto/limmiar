export type EstadoChamada = 'conectando' | 'aguardando' | 'conectada' | 'interrompida' | 'encerrada'
export type PapelChamada = 'professional' | 'patient'

interface Sinal {
  type: string
  role?: PapelChamada
  sdp?: string
  candidate?: RTCIceCandidateInit
  iceServers?: RTCIceServer[]
}

export interface ChamadaOnline {
  sair(): void
  encerrar(): void
  silenciar(mudo: boolean): void
  reconectar(): Promise<void>
}

interface EntradaChamada {
  baseUrl: string
  roomId: string
  token: string
  papel: PapelChamada
  stream: MediaStream
  signal: AbortSignal
  estado(estado: EstadoChamada): void
  receber(stream: MediaStream): void
  falhar(): void
}

// Qualquer quebra de protocolo derruba a chamada por `falhar`, que não usa o motivo.
class SinalizacaoInvalida extends Error {}

export async function conectarChamada(input: EntradaChamada): Promise<ChamadaOnline> {
  const url = new URL(`${input.baseUrl}/online-sessions/${input.roomId}/signal`, location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(url)
  let peer: RTCPeerConnection | undefined
  let remoto: MediaStream | undefined
  let encerrada = false
  let iceServers!: RTCIceServer[]
  let candidates!: RTCIceCandidateInit[]
  let fila = Promise.resolve()
  let pendentes = 0
  let resolver!: () => void
  let rejeitar!: (error: Error) => void
  const pronto = new Promise<void>((resolve, reject) => { resolver = resolve; rejeitar = reject })
  const timeout = setTimeout(falhar, 15000)

  function limpar(error: Error = new DOMException('Cancelled', 'AbortError')) {
    if (encerrada) return
    encerrada = true
    clearTimeout(timeout)
    input.signal.removeEventListener('abort', cancelar)
    peer?.close()
    input.stream.getTracks().forEach(track => track.stop())
    remoto?.getTracks().forEach(track => track.stop())
    socket.close()
    rejeitar(error)
  }
  function falhar() {
    if (encerrada) return
    limpar(new Error('Online call unavailable'))
    input.estado('interrompida')
    input.falhar()
  }
  function cancelar() { limpar() }
  function enviar(message: Sinal) {
    if (socket.readyState !== WebSocket.OPEN || encerrada) throw new Error('Signaling unavailable')
    socket.send(JSON.stringify(message))
  }
  function criarPeer() {
    peer?.close()
    candidates = []
    const connection = new RTCPeerConnection({ iceServers })
    peer = connection
    input.stream.getAudioTracks().forEach(track => connection.addTrack(track, input.stream))
    connection.onicecandidate = event => {
      if (event.candidate && !encerrada && peer === connection) {
        try { enviar({ type: 'ice', candidate: event.candidate.toJSON() }) } catch { falhar() }
      }
    }
    connection.ontrack = event => {
      if (encerrada || peer !== connection) return
      remoto = event.streams[0] ?? new MediaStream([event.track])
      input.receber(remoto)
    }
    connection.onconnectionstatechange = () => {
      if (encerrada || peer !== connection) return
      if (connection.connectionState === 'connected') input.estado('conectada')
      else if (connection.connectionState === 'disconnected' || connection.connectionState === 'failed') input.estado('interrompida')
    }
  }
  async function oferecer(restart = false) {
    await peer!.setLocalDescription(await peer!.createOffer({ iceRestart: restart }))
    enviar({ type: 'offer', sdp: peer!.localDescription!.sdp })
  }
  async function drenar() {
    for (const candidate of candidates) await peer!.addIceCandidate(candidate)
    candidates = []
  }
  async function processar(sinal: Sinal) {
    if (encerrada) return
    if (sinal.type === 'joined') {
      if (sinal.role !== input.papel || !Array.isArray(sinal.iceServers)) throw new SinalizacaoInvalida()
      iceServers = sinal.iceServers
      criarPeer()
      clearTimeout(timeout)
      input.estado('aguardando')
      resolver()
    } else if (sinal.type === 'peer-ready') {
      if (input.papel === 'professional') await oferecer()
    } else if (sinal.type === 'restart') {
      if (input.papel === 'professional') await oferecer(true)
    } else if (sinal.type === 'offer' || sinal.type === 'answer') {
      if (!peer || !sinal.sdp || (sinal.type === 'offer') !== (input.papel === 'patient')) throw new SinalizacaoInvalida()
      await peer.setRemoteDescription({ type: sinal.type, sdp: sinal.sdp })
      await drenar()
      if (sinal.type === 'offer') {
        await peer.setLocalDescription(await peer.createAnswer())
        enviar({ type: 'answer', sdp: peer.localDescription!.sdp })
      }
    } else if (sinal.type === 'ice') {
      if (!peer || !sinal.candidate || candidates.length >= 128) throw new SinalizacaoInvalida()
      if (peer.remoteDescription) await peer.addIceCandidate(sinal.candidate)
      else candidates.push(sinal.candidate)
    } else if (sinal.type === 'peer-left') {
      remoto?.getTracks().forEach(track => track.stop())
      criarPeer()
      input.estado('interrompida')
    } else if (sinal.type === 'ended') { limpar(); input.estado('encerrada') }
    else if (sinal.type !== 'pong') throw new SinalizacaoInvalida()
  }

  input.signal.addEventListener('abort', cancelar)
  socket.onopen = () => {
    if (!encerrada) socket.send(JSON.stringify({ token: input.token }))
  }
  socket.onerror = falhar
  socket.onclose = falhar
  socket.onmessage = ({ data }) => {
    if (typeof data !== 'string' || data.length > 65536 || ++pendentes > 256) { falhar(); return }
    fila = fila.then(() => processar(JSON.parse(data) as Sinal)).catch(falhar).finally(() => { pendentes-- })
  }
  if (input.signal.aborted) cancelar()
  await pronto
  return {
    sair: limpar,
    encerrar() {
      if (encerrada) return
      try { enviar({ type: 'end' }) } finally { limpar(); input.estado('encerrada') }
    },
    silenciar(mudo) { input.stream.getAudioTracks().forEach(track => { track.enabled = !mudo }) },
    async reconectar() {
      if (encerrada || !peer) throw new Error('Call already closed')
      input.estado('conectando')
      if (input.papel === 'professional') await oferecer(true)
      else enviar({ type: 'restart' })
    },
  }
}
