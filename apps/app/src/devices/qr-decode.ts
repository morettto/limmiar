import jsQR from 'jsqr'

// Not exercised by automated tests: CI has no camera. PairingScan's `decode` prop
// defaults to this function; tests inject a fake that resolves immediately instead.
// Camera-frame decoding itself is left to manual QA.
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
