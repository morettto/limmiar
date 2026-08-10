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
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'mediaDevices')
  })

  it('stops the camera stream and throws when a 2D canvas context is unavailable', async () => {
    const { stream, track } = makeFakeStream()
    stubGetUserMedia(stream)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

    await expect(decodeFromCamera()).rejects.toThrow('Canvas 2D context unavailable for QR scanning')
    expect(track.stop).toHaveBeenCalledTimes(1)
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

    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })

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
  })
})
