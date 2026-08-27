import { nemotronEngine } from '@limmiar/audio'
import type { TranscriptionSegment } from '@limmiar/audio'
import { carregarReconhecedor } from './nemotron-loader'
import type { GlueSherpa } from './nemotron-loader'

export type AsrRequest =
  | { id: number; kind: 'warmup' }
  | { id: number; kind: 'transcribe'; pcm: Float32Array }
  | { id: number; kind: 'close' }

export type AsrReply =
  | { id: number; ok: true; segments: TranscriptionSegment[] }
  | { id: number; ok: false; error: string }

// Motor real (fatia 6 do desenho): `nemotronEngine` recebe a *promessa* do
// reconhecedor — o carregamento (glue + WASM + pesos) arranca já aqui, e
// `warmup()` é o ponto onde se espera por ele. `carregarReconhecedor` recebe
// `importarGlue` como seam de plataforma (decisão 6 do desenho da fatia 6):
// `import()` de uma URL só conhecida em runtime não é intercetável por
// `vi.mock`.
const engine = nemotronEngine(
  carregarReconhecedor((url) => import(/* @vite-ignore */ url) as Promise<GlueSherpa>),
)

// Fila serial (decisão 6 do desenho): uma sessão ONNX não é reentrante —
// warmup/transcribe/close no engine nunca correm em paralelo, mesmo que
// vários pedidos cheguem em voo ao mesmo tempo (`live-session` não aguarda
// o warmup antes de começar a transcrever).
let fila: Promise<void> = Promise.resolve()

async function processar(request: AsrRequest): Promise<AsrReply> {
  try {
    if (request.kind === 'warmup') {
      await engine.warmup()
      return { id: request.id, ok: true, segments: [] }
    }
    if (request.kind === 'transcribe') {
      const segments = await engine.transcribe(request.pcm)
      return { id: request.id, ok: true, segments }
    }
    await engine.close()
    return { id: request.id, ok: true, segments: [] }
  } catch (error) {
    return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// Ver nota de `patient-summary.worker.ts` sobre `self` tipar contra o
// `Window` do lib.dom (sem lib "webworker" separada) — compatível nos sítios
// usados aqui.
self.onmessage = (event: MessageEvent<AsrRequest>) => {
  fila = fila.then(async () => {
    self.postMessage(await processar(event.data))
  })
}
