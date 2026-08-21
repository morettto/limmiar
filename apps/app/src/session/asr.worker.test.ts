import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TranscriptionSegment } from '@limmiar/audio'

const transcribeMock = vi.fn<(pcm: Float32Array) => TranscriptionSegment[]>()
const warmupMock = vi.fn<() => void>()
const closeMock = vi.fn<() => void>()

vi.mock('@limmiar/audio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@limmiar/audio')>()
  return {
    ...actual,
    fakeEngine: () => ({
      warmup: async () => warmupMock(),
      transcribe: async (pcm: Float32Array) => transcribeMock(pcm),
      close: async () => closeMock(),
    }),
  }
})

// `self.onmessage` corre como efeito de import em jsdom (`self` é `window`) —
// precedente `patient-summary.worker.test.ts`. O engine é substituído acima
// (`vi.mock`) para poder provar o ramo de rejeição sem depender do
// comportamento fixo do `fakeEngine` real.
import './asr.worker'
import type { AsrRequest } from './asr.worker'

async function enviar(request: AsrRequest): Promise<void> {
  self.onmessage?.({ data: request } as MessageEvent<AsrRequest>)
}

describe('asr.worker', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    transcribeMock.mockReset()
    warmupMock.mockReset()
    closeMock.mockReset()
  })

  it('kind "warmup" → chama engine.warmup() e responde {ok:true, segments:[]}', async () => {
    const postMessage = vi.spyOn(self, 'postMessage').mockImplementation(() => {})

    await enviar({ id: 1, kind: 'warmup' })

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ id: 1, ok: true, segments: [] }))
    expect(warmupMock).toHaveBeenCalledOnce()
  })

  it('kind "transcribe" → responde {ok:true, segments} com o pcm passado ao engine', async () => {
    const segmentos: TranscriptionSegment[] = [{ startMs: 0, endMs: 100, text: 'oi' }]
    transcribeMock.mockReturnValue(segmentos)
    const postMessage = vi.spyOn(self, 'postMessage').mockImplementation(() => {})
    const pcm = new Float32Array(4)

    await enviar({ id: 2, kind: 'transcribe', pcm })

    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith({ id: 2, ok: true, segments: segmentos }),
    )
    expect(transcribeMock).toHaveBeenCalledWith(pcm)
  })

  it('kind "close" → chama engine.close() e responde {ok:true, segments:[]}', async () => {
    const postMessage = vi.spyOn(self, 'postMessage').mockImplementation(() => {})

    await enviar({ id: 3, kind: 'close' })

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ id: 3, ok: true, segments: [] }))
    expect(closeMock).toHaveBeenCalledOnce()
  })

  it('engine rejeita com Error → {ok:false, error: mensagem}', async () => {
    warmupMock.mockImplementation(() => {
      throw new Error('sem gpu')
    })
    const postMessage = vi.spyOn(self, 'postMessage').mockImplementation(() => {})

    await enviar({ id: 4, kind: 'warmup' })

    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith({ id: 4, ok: false, error: 'sem gpu' }),
    )
  })

  it('engine rejeita com valor não-Error → error é o valor stringificado', async () => {
    transcribeMock.mockImplementation(() => {
      throw 'boom'
    })
    const postMessage = vi.spyOn(self, 'postMessage').mockImplementation(() => {})

    await enviar({ id: 5, kind: 'transcribe', pcm: new Float32Array(0) })

    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith({ id: 5, ok: false, error: 'boom' }),
    )
  })
})
