import { CapacidadeEsgotada } from './pool.ts'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket } from 'ws'
import { ehConcluir, ErroDeProtocolo, lerInicio } from './protocolo.ts'
import { Sessao, type Canal, type Dependencias } from './sessao.ts'

export const ROTA = '/v1/fala'
// Um quadro do navegador tem 80 ms (2,5 KB); a mensagem inicial leva a impressão de voz (192 números).
const MAXIMO_DA_MENSAGEM = 64 * 1024
const FOLGA_MAXIMA_BYTES = 256 * 1024
const PROTOCOLO = 1008
const DADO_INVALIDO = 1003

export interface ConfigServidor extends Dependencias {
  chave?: string
  pingMs: number
}

function autorizado(chave: string, cabecalho: string | undefined): boolean {
  const esperado = Buffer.from(`Bearer ${chave}`)
  const recebido = Buffer.from(cabecalho ?? '')
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado)
}

function recusar(socket: Duplex, status: string): void {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

export function criarServidor(config: ConfigServidor): { http: Server; fechar(): Promise<void> } {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAXIMO_DA_MENSAGEM })
  const http = createServer((requisicao, resposta) => {
    if (requisicao.url === '/saude') { resposta.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}'); return }
    resposta.writeHead(404).end()
  })
  // Atrás de um balanceador, uma sessão calada por minutos (o navegador não manda silêncio) cairia por inatividade.
  const vivos = new WeakSet<WebSocket>()
  http.on('upgrade', (requisicao: IncomingMessage, socket: Duplex, cabeca: Buffer) => {
    if (requisicao.url !== ROTA) { recusar(socket, '404 Not Found'); return }
    if (config.chave !== undefined && !autorizado(config.chave, requisicao.headers.authorization)) { recusar(socket, '401 Unauthorized'); return }
    wss.handleUpgrade(requisicao, socket, cabeca, (ws) => {
      vivos.add(ws)
      ws.on('pong', () => vivos.add(ws))
      conectar(ws, config)
    })
  })
  const batida = setInterval(() => {
    for (const ws of wss.clients) {
      if (!vivos.has(ws)) { ws.terminate(); continue }
      vivos.delete(ws)
      ws.ping()
    }
  }, config.pingMs)
  return {
    http,
    fechar: async () => {
      clearInterval(batida)
      wss.clients.forEach((ws) => ws.close(1001))
      wss.close()
      await new Promise<void>((resolver) => http.close(() => resolver()))
    },
  }
}

function conectar(ws: WebSocket, config: ConfigServidor): void {
  const canal: Canal = {
    enviar: (saida) => ws.send(JSON.stringify(saida)),
    ocupado: () => ws.bufferedAmount > FOLGA_MAXIMA_BYTES,
    fechar: (codigo) => ws.close(codigo),
  }
  let sessao: Sessao | undefined
  let aberta = false
  let iniciada = false

  function violar(erro: ErroDeProtocolo, codigo: number) {
    canal.enviar({ type: 'erro', mensagem: erro.message })
    ws.close(codigo)
  }

  async function iniciar(texto: string) {
    iniciada = true
    try {
      const nova = new Sessao(lerInicio(texto, config.extrator.dimensao), canal, config)
      sessao = nova
      await nova.abrir()
      aberta = true
    } catch (erro) {
      if (erro instanceof ErroDeProtocolo) { violar(erro, PROTOCOLO); return }
      const esgotada = erro instanceof CapacidadeEsgotada
      config.registrar?.(esgotada ? 'sessao.capacidade_esgotada' : 'sessao.abertura_falhou')
      canal.enviar({ type: 'erro', mensagem: esgotada ? 'Capacidade de transcrição esgotada. Tente de novo em instantes.' : 'O serviço de transcrição está indisponível.' })
      ws.close(1011)
    }
  }

  ws.on('message', (dados: Buffer, binario) => {
    if (!binario) {
      const texto = dados.toString('utf8')
      if (!iniciada) void iniciar(texto)
      else if (aberta && ehConcluir(texto)) void sessao!.concluir()
      else violar(new ErroDeProtocolo('Mensagem inesperada.'), PROTOCOLO)
      return
    }
    if (!aberta) { violar(new ErroDeProtocolo('O áudio só pode ser enviado depois de "pronta".'), PROTOCOLO); return }
    if (dados.length % 2 !== 0) { violar(new ErroDeProtocolo('PCM16 tem número par de bytes.'), DADO_INVALIDO); return }
    sessao!.pcm(new Int16Array(dados.buffer.slice(dados.byteOffset, dados.byteOffset + dados.byteLength)))
  })
  ws.on('close', () => sessao?.encerrar())
  ws.on('error', () => ws.terminate())
}
