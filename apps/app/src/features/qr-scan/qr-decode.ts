import jsQR from 'jsqr'

export async function decodeFromCamera(signal?: AbortSignal, preview?: HTMLVideoElement): Promise<string> {
  signal?.throwIfAborted()
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
  const video = preview ?? document.createElement('video')
  let frame: number | undefined
  let abort: (() => void) | undefined

  try {
    signal?.throwIfAborted()
    video.srcObject = stream
    video.muted = true
    video.setAttribute('playsinline', 'true')
    await video.play()
    signal?.throwIfAborted()
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D context unavailable for QR scanning')
    return await new Promise<string>((resolve, reject) => {
      abort = () => reject(new DOMException('QR scan cancelled', 'AbortError'))
      signal?.addEventListener('abort', abort)
      function tick() {
        try {
          signal?.throwIfAborted()
          if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            context!.drawImage(video, 0, 0, canvas.width, canvas.height)
            const imageData = context!.getImageData(0, 0, canvas.width, canvas.height)
            const code = jsQR(imageData.data, imageData.width, imageData.height)
            if (code) { resolve(code.data); return }
          }
          frame = requestAnimationFrame(tick)
        } catch (error) { reject(error) }
      }

      tick()
    })
  } finally {
    if (frame !== undefined) cancelAnimationFrame(frame)
    if (abort) signal?.removeEventListener('abort', abort)
    stream.getTracks().forEach((track) => track.stop())
    video.srcObject = null
  }
}
