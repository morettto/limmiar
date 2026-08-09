import jsQR from 'jsqr'

/**
 * Production QR decoder for the new device's pairing scan (PairingScan.tsx): opens the
 * camera, draws frames to an offscreen canvas, and runs jsQR against each frame until it
 * finds a code, then tears the stream down.
 *
 * Deliberately NOT exercised by this repo's automated tests -- PairingScan accepts a
 * `decode` prop that defaults to this function, and tests/E2E inject a fake that resolves
 * immediately with a known QR string instead. That seam proves the pairing PROTOCOL
 * (claim -> derive -> decrypt -> adopt KEK) end-to-end without needing a real or
 * fake-flagged camera device in CI; actual camera-frame decoding is left to manual QA.
 */
export async function decodeFromCamera(): Promise<string> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })

  const video = document.createElement('video')
  video.srcObject = stream
  video.setAttribute('playsinline', 'true')
  await video.play()

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    stream.getTracks().forEach((track) => track.stop())
    throw new Error('Canvas 2D context unavailable for QR scanning')
  }

  try {
    return await new Promise<string>((resolve) => {
      function tick() {
        if (video.readyState !== video.HAVE_ENOUGH_DATA) {
          requestAnimationFrame(tick)
          return
        }

        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        context!.drawImage(video, 0, 0, canvas.width, canvas.height)
        const imageData = context!.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(imageData.data, imageData.width, imageData.height)

        if (code) {
          resolve(code.data)
          return
        }

        requestAnimationFrame(tick)
      }

      tick()
    })
  } finally {
    stream.getTracks().forEach((track) => track.stop())
  }
}
