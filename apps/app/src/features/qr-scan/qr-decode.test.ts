import { afterEach, describe, expect, it, vi } from 'vitest'
import jsQR from 'jsqr'
import { decodeFromCamera } from './qr-decode'

vi.mock('jsqr', () => ({ default: vi.fn() }))

function makeFakeStream() {
  const track = { stop: vi.fn() }
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track }
}

function stubGetUserMedia(stream: MediaStream) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  })
}

describe('decodeFromCamera', () => {
  it('não abre a câmera quando a navegação já cancelou a leitura', async () => {
    const { stream } = makeFakeStream()
    stubGetUserMedia(stream)
    const controller = new AbortController()
    controller.abort()
    await expect(decodeFromCamera(controller.signal)).rejects.toThrow()
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
  })
  it('para a câmera cuja permissão chega após a saída da página', async () => {
    const { stream, track } = makeFakeStream()
    let permit!: (stream: MediaStream) => void
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(() => new Promise<MediaStream>(resolve => { permit = resolve })) } })
    const controller = new AbortController()
    const reading = decodeFromCamera(controller.signal)
    controller.abort()
    permit(stream)
    await expect(reading).rejects.toThrow()
    expect(track.stop).toHaveBeenCalledOnce()
  })
  it('para e desconecta o preview se a reprodução falhar', async () => {
    const { stream, track } = makeFakeStream()
    stubGetUserMedia(stream)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('play failed'))
    const preview = document.createElement('video')
    await expect(decodeFromCamera(undefined, preview)).rejects.toThrow('play failed')
    expect(track.stop).toHaveBeenCalledOnce()
    expect(preview.srcObject).toBeNull()
  })
  it('cancela frames e para o preview durante a busca de um código', async () => {
    const { stream, track } = makeFakeStream()
    stubGetUserMedia(stream)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(0)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
    const request = vi.fn(() => 99), cancel = vi.fn()
    vi.stubGlobal('requestAnimationFrame', request)
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const controller = new AbortController()
    const preview = document.createElement('video')
    const reading = decodeFromCamera(controller.signal, preview)
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    expect(preview.srcObject).toBe(stream)
    controller.abort()
    await expect(reading).rejects.toMatchObject({ name: 'AbortError', message: 'QR scan cancelled' })
    expect(track.stop).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledWith(99)
    expect(preview.srcObject).toBeNull()
  })
  it('encerra a câmera após uma falha ao ler o frame', async () => {
    const { stream, track } = makeFakeStream()
    stubGetUserMedia(stream)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: () => { throw new Error('frame failed') } } as unknown as CanvasRenderingContext2D)
    await expect(decodeFromCamera()).rejects.toThrow('frame failed')
    expect(track.stop).toHaveBeenCalledOnce()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'mediaDevices')
  })

  it('stops the camera stream and throws when a 2D canvas context is unavailable', async () => {
    const { stream, track } = makeFakeStream()
    stubGetUserMedia(stream)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const setAttributeSpy = vi.spyOn(HTMLVideoElement.prototype, 'setAttribute')
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

    await expect(decodeFromCamera()).rejects.toThrow('Canvas 2D context unavailable for QR scanning')
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'environment' } })
    expect(setAttributeSpy).toHaveBeenCalledWith('playsinline', 'true')
    expect(getContextSpy).toHaveBeenCalledWith('2d')
  })

  it('resolves with the decoded QR text once jsQR finds a code, retrying frames until then', async () => {
    const { stream, track } = makeFakeStream()
    stubGetUserMedia(stream)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)

    let readyStateReads = 0
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockImplementation(() => {
      readyStateReads += 1
      return readyStateReads === 1 ? 0 : 4
    })
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(320)
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(240)

    const fakeImageData = { data: new Uint8ClampedArray(4), width: 320, height: 240 }
    const fakeContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn().mockReturnValue(fakeImageData),
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      fakeContext as unknown as CanvasRenderingContext2D,
    )

    const requestAnimationFrameMock = vi.fn((cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock)

    const jsQRMock = vi.mocked(jsQR)
    jsQRMock.mockReturnValueOnce(null).mockReturnValueOnce({
      data: 'decoded-qr-text',
    } as unknown as ReturnType<typeof jsQR>)

    const result = await decodeFromCamera()

    expect(result).toBe('decoded-qr-text')
    expect(fakeContext.drawImage).toHaveBeenCalled()
    expect(fakeContext.getImageData).toHaveBeenCalled()
    expect(jsQRMock).toHaveBeenCalledTimes(2)
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(2)
  })

  it('silencia o preview, não cancela frames que nunca existiram e solta o ouvinte de cancelamento', async () => {
    const { stream } = makeFakeStream()
    stubGetUserMedia(stream)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(4), width: 1, height: 1 }) } as unknown as CanvasRenderingContext2D)
    vi.mocked(jsQR).mockReturnValueOnce({ data: 'lido' } as unknown as ReturnType<typeof jsQR>)
    const cancel = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const controller = new AbortController()
    const remover = vi.spyOn(controller.signal, 'removeEventListener')
    const preview = document.createElement('video')

    expect(await decodeFromCamera(controller.signal, preview)).toBe('lido')

    expect(preview.muted).toBe(true)
    expect(cancel).not.toHaveBeenCalled()
    expect(remover).toHaveBeenCalledOnce()
    expect(remover).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('sem leitura iniciada não há ouvinte de cancelamento a soltar', async () => {
    const { stream } = makeFakeStream()
    stubGetUserMedia(stream)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const controller = new AbortController()
    const remover = vi.spyOn(controller.signal, 'removeEventListener')
    await expect(decodeFromCamera(controller.signal)).rejects.toThrow('Canvas 2D context unavailable')
    expect(remover).not.toHaveBeenCalled()
  })
})
