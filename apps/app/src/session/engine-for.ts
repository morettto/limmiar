import { fakeEngine } from '@limmiar/audio'
import type { TranscriptionEngine, TranscriptionSegment } from '@limmiar/audio'
import type { AsrReply, AsrRequest } from './asr.worker'

interface Pendente {
  resolve: (segments: TranscriptionSegment[]) => void
  reject: (error: Error) => void
}

/**
 * Proxy de `TranscriptionEngine` sobre `asr.worker.ts`. Protocolo com `id` +
 * `Map` de pendentes (decisão 6 do desenho): `warmup()`/`transcribe()` podem
 * estar em voo ao mesmo tempo, logo a ordem de resposta não é garantida.
 */
function workerEngine(): TranscriptionEngine {
  const worker = new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' })
  const pendentes = new Map<number, Pendente>()
  let proximoId = 0

  worker.onmessage = (event: MessageEvent<AsrReply>) => {
    const reply = event.data
    const pendente = pendentes.get(reply.id)
    if (!pendente) return
    pendentes.delete(reply.id)
    if (reply.ok) pendente.resolve(reply.segments)
    else pendente.reject(new Error(reply.error))
  }
  worker.onerror = (event) => {
    const error = new Error(event.message)
    for (const pendente of pendentes.values()) pendente.reject(error)
    pendentes.clear()
  }

  function enviar(request: AsrRequest): Promise<TranscriptionSegment[]> {
    return new Promise<TranscriptionSegment[]>((resolve, reject) => {
      pendentes.set(request.id, { resolve, reject })
      // `pcm` vai por structured clone, nunca `transfer` (decisão 5 do
      // desenho): `runAsrLoop` reutiliza o mesmo buffer entre janelas, e
      // transferi-lo destacaria-o para a janela seguinte.
      worker.postMessage(request)
    })
  }

  return {
    async warmup() {
      await enviar({ id: proximoId++, kind: 'warmup' })
    },
    async transcribe(pcm) {
      return enviar({ id: proximoId++, kind: 'transcribe', pcm })
    },
    async close() {
      await enviar({ id: proximoId++, kind: 'close' })
      worker.terminate()
    },
  }
}

/**
 * Motor por flag de build (decisão 8 do desenho, precedente
 * `router.tsx:236`). Sem parâmetros: o único chamador de produção é a UI, e
 * os testes de `live-session` já injetam `engine` direto — um `opts` hoje
 * seria especulativo.
 */
export function engineFor(): TranscriptionEngine {
  return import.meta.env.VITE_FAKE_ASR === 'true' ? fakeEngine() : workerEngine()
}
