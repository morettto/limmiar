import '@vitest/web-worker'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { engineFor } from './engine-for'
import type { AsrReply, AsrRequest } from './asr.worker'

interface WorkerFalsoListeners {
  onmessage?: (event: MessageEvent<AsrReply>) => void
  onerror?: (event: { message: string }) => void
}

function msg(reply: AsrReply): MessageEvent<AsrReply> {
  return { data: reply } as unknown as MessageEvent<AsrReply>
}

function stubWorkerFalso(postMessage: (req: AsrRequest) => void = () => {}) {
  const listeners: WorkerFalsoListeners = {}
  const terminate = vi.fn()
  vi.stubGlobal(
    'Worker',
    vi.fn().mockImplementation(function FakeWorker() {
      return {
        postMessage: vi.fn((req: AsrRequest) => postMessage(req)),
        terminate,
        set onmessage(fn: (event: MessageEvent<AsrReply>) => void) {
          listeners.onmessage = fn
        },
        set onerror(fn: (event: { message: string }) => void) {
          listeners.onerror = fn
        },
      }
    }),
  )
  return { listeners, terminate }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('engineFor', () => {
  it('VITE_FAKE_ASR="true" → motor local (fakeEngine), sem construir Worker', async () => {
    vi.stubEnv('VITE_FAKE_ASR', 'true')
    const WorkerSpy = vi.fn()
    vi.stubGlobal('Worker', WorkerSpy)

    const engine = engineFor()

    await expect(engine.transcribe(new Float32Array(0))).resolves.toEqual([])
    expect(WorkerSpy).not.toHaveBeenCalled()
  })

  it('VITE_FAKE_ASR ausente → constrói um Worker', () => {
    stubWorkerFalso()
    const WorkerCtor = globalThis.Worker

    engineFor()

    expect(WorkerCtor).toHaveBeenCalledOnce()
  })

  it('roteia respostas por id mesmo fora de ordem, e ignora um id desconhecido', async () => {
    const { listeners } = stubWorkerFalso()

    const engine = engineFor()
    const p1 = engine.transcribe(new Float32Array(1))
    const p2 = engine.transcribe(new Float32Array(2))

    // Resposta ao segundo pedido chega primeiro; um id desconhecido é ignorado.
    listeners.onmessage?.(msg({ id: 1, ok: true, segments: [{ startMs: 0, endMs: 1, text: 'b' }] }))
    listeners.onmessage?.(msg({ id: 99, ok: true, segments: [] }))
    listeners.onmessage?.(msg({ id: 0, ok: true, segments: [{ startMs: 0, endMs: 1, text: 'a' }] }))

    await expect(p1).resolves.toEqual([{ startMs: 0, endMs: 1, text: 'a' }])
    await expect(p2).resolves.toEqual([{ startMs: 0, endMs: 1, text: 'b' }])
  })

  it('reply {ok:false} rejeita a promise pendente com o erro', async () => {
    const { listeners } = stubWorkerFalso()

    const engine = engineFor()
    const promessa = engine.warmup()
    listeners.onmessage?.(msg({ id: 0, ok: false, error: 'sem gpu' }))

    await expect(promessa).rejects.toThrow('sem gpu')
  })

  it('onerror do Worker rejeita todos os pedidos pendentes', async () => {
    const { listeners } = stubWorkerFalso()

    const engine = engineFor()
    const p1 = engine.warmup()
    const p2 = engine.transcribe(new Float32Array(1))
    listeners.onerror?.({ message: 'worker caiu' })

    await expect(p1).rejects.toThrow('worker caiu')
    await expect(p2).rejects.toThrow('worker caiu')
  })

  it('close() envia kind "close" e termina o worker depois da resposta', async () => {
    const { listeners, terminate } = stubWorkerFalso((req) => {
      listeners.onmessage?.(msg({ id: req.id, ok: true, segments: [] }))
    })

    const engine = engineFor()
    await engine.close()

    expect(terminate).toHaveBeenCalledOnce()
  })

  // Load-criterion test: roundtrip contra o Worker de verdade (@vitest/web-worker,
  // já instalado — worker_threads por baixo), hospedando o motor real
  // (`nemotronEngine` + `carregarReconhecedor`) dentro de asr.worker.ts.
  // Sem `.wasm`/artefactos disponíveis em jsdom/Node, `import(/* @vite-ignore */ url)`
  // de `sherpa-onnx-wasm-main-asr.mjs` rejeita — e é exatamente essa rejeição, ponta
  // a ponta (carregador → fila do Worker → `AsrReply{ok:false}` → `postMessage` →
  // proxy → `Error`), que prova o protocolo de erro da decisão 4/10 do desenho da
  // fatia 6. Precedente: apps/app/src/patients/worker-client.test.ts.
  it('roundtrip real: warmup contra o Worker de verdade rejeita — motor real não tem artefactos em teste', async () => {
    const engine = engineFor()

    await expect(engine.warmup()).rejects.toThrow(/falhou a carregar/)
    await expect(engine.close()).resolves.toBeUndefined()
  })
})
