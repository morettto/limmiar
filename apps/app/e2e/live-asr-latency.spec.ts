import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { aggregateWordLatency, creditVisibility, loadLiveAudioFixture, normalizeWord, tokenize, wordErrorRate, type TranscriptSnapshot } from './fixtures/live-asr-latency'
import { abrirCarteira, iniciarSessaoAgora, registrarProfissionalNaInterface } from './fixtures/profissional-interface'

const fixture = await loadLiveAudioFixture()
test.skip(fixture.state === 'blocked', fixture.state === 'blocked' ? fixture.reason : '')

const MAX_WER = 0.05
const PAUSA_MS = 150

interface HarnessWindow extends Window {
  __limmiarLiveLatency?: {
    sourceEnded: boolean
    snapshots: TranscriptSnapshot[]
    wordStartPerformanceMs: number[]
    wordEndPerformanceMs: number[]
    baseLatencyMs: number
    outputLatencyMs: number
    startFixture: () => void
    stop: () => string
  }
}

async function abrirSessaoSintetica(page: Page, request: APIRequestContext): Promise<void> {
  const sessionUrl = process.env.LIVE_ASR_SESSION_URL
  if (sessionUrl) {
    await page.goto(sessionUrl)
    return
  }
  await registrarProfissionalNaInterface(page, request)
  await abrirCarteira(page)
  const carteira = page.getByRole('region', { name: 'Pacientes', exact: true })
  const nomePaciente = `PACIENTE-SINTETICO-LATENCIA-${crypto.randomUUID()}`
  await carteira.locator('details.patient-add > summary').click()
  await carteira.getByLabel('Nome do paciente', { exact: true }).fill(nomePaciente)
  await carteira.getByRole('button', { name: 'Adicionar paciente', exact: true }).click()
  await carteira.getByRole('link', { name: nomePaciente, exact: true }).click()
  await iniciarSessaoAgora(page)
  // Without the AI-analysis consent SessionReview records and transcribes after the stop, never live.
  const consentimento = page.getByRole('region', { name: 'Consentimento e tipo de sessão', exact: true })
  for (const nome of ['Paciente autorizou a gravação', 'Paciente autorizou a análise por IA local']) {
    const caixa = consentimento.getByRole('checkbox', { name: nome, exact: true })
    await caixa.click()
    await expect(caixa).toBeChecked()
  }
}

test('cada palavra falada aparece no DOM da transcrição ao vivo até 300 ms após seu fim acústico', async ({ page, request }, testInfo) => {
  if (fixture.state !== 'ready') throw new Error('O teste iniciou sem fixture.')
  const { manifest } = fixture
  const sampleRate = manifest.audio.sampleRate
  const audioMs = manifest.audio.framesPerChannel / sampleRate * 1000
  test.setTimeout(180_000 + audioMs)

  let speechConnections = 0
  let copilotRequests = 0
  page.on('websocket', (socket) => { if (new URL(socket.url()).pathname === '/speech/v1/fala') speechConnections += 1 })
  page.on('request', (pedido) => { if (new URL(pedido.url()).pathname.startsWith('/copiloto/')) copilotRequests += 1 })

  await abrirSessaoSintetica(page, request)
  const session = page.getByRole('region', { name: 'Gravação e transcrição', exact: true })
  const transcript = page.getByRole('region', { name: 'Transcrição ao vivo', exact: true })
  await expect(transcript).toBeVisible()
  await expect(transcript.locator('.transcript-text')).toHaveCount(0)
  const iniciar = session.getByRole('button', { name: 'Iniciar gravação', exact: true })
  await expect(iniciar).toBeEnabled()

  await page.evaluate(({ pcmBase64, rate, frameCount, startSamples, endSamples }) => {
    const harness = window as HarnessWindow
    const snapshots: TranscriptSnapshot[] = []
    const lerTranscricao = () => [...document.querySelectorAll<HTMLElement>('[aria-label="Transcrição ao vivo"] .transcript-text > :not(.transcript-aviso)')]
      .map((linha) => linha.textContent ?? '').join(' ')
    let quadroPendente = false
    // A mutation is not on screen yet: the first visible time is the next animation frame after it.
    const observer = new MutationObserver(() => {
      if (quadroPendente) return
      quadroPendente = true
      requestAnimationFrame(() => {
        quadroPendente = false
        const atMs = performance.now()
        const text = lerTranscricao()
        if (text !== snapshots.at(-1)?.text) snapshots.push({ atMs, text })
      })
    })
    observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true })

    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        const context = new AudioContext({ sampleRate: rate })
        await context.resume()
        const bytes = Uint8Array.from(atob(pcmBase64), (character) => character.charCodeAt(0))
        const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        const audio = context.createBuffer(1, frameCount, rate)
        const channel = audio.getChannelData(0)
        for (let index = 0; index < frameCount; index += 1) channel[index] = data.getInt16(index * 2, true) / 32768

        const streamDestination = context.createMediaStreamDestination()
        const source = context.createBufferSource()
        source.buffer = audio
        source.connect(streamDestination)
        const silentMonitor = context.createGain()
        silentMonitor.gain.value = 0
        source.connect(silentMonitor).connect(context.destination)
        const startAt = context.currentTime + 0.4
        const { performanceTime, contextTime } = context.getOutputTimestamp()
        if (performanceTime === undefined || performanceTime <= 0 || contextTime === undefined ||
            !Number.isFinite(performanceTime) || !Number.isFinite(contextTime)) {
          throw new Error('Chromium não forneceu correlação de relógio de áudio auditável.')
        }
        const paraPerformance = (sample: number) => performanceTime + ((startAt + sample / rate) - contextTime) * 1000
        harness.__limmiarLiveLatency = {
          sourceEnded: false,
          snapshots,
          wordStartPerformanceMs: startSamples.map(paraPerformance),
          wordEndPerformanceMs: endSamples.map(paraPerformance),
          baseLatencyMs: context.baseLatency * 1000,
          outputLatencyMs: context.outputLatency * 1000,
          startFixture: () => {
            source.onended = () => { harness.__limmiarLiveLatency!.sourceEnded = true }
            source.start(startAt)
          },
          stop: () => { observer.disconnect(); return lerTranscricao() },
        }
        return streamDestination.stream
      },
    })
  }, {
    pcmBase64: Buffer.from(fixture.audio).toString('base64'),
    rate: sampleRate,
    frameCount: manifest.audio.framesPerChannel,
    startSamples: manifest.words.map((word) => word.startSample),
    endSamples: manifest.words.map((word) => word.endSampleExclusive),
  })

  const connectedToGateway = page.waitForEvent('websocket', (socket) => new URL(socket.url()).pathname === '/speech/v1/fala')
  await iniciar.click()
  await connectedToGateway
  await expect(session.getByRole('status').filter({ hasText: 'Transcrição ao vivo. Seu perfil de voz identifica' })).toBeVisible()
  await page.evaluate(() => (window as HarnessWindow).__limmiarLiveLatency!.startFixture())
  await page.waitForFunction(() => (window as HarnessWindow).__limmiarLiveLatency?.sourceEnded === true, undefined, { timeout: audioMs + 15_000 })
  await session.getByRole('button', { name: 'Encerrar gravação', exact: true }).click()
  let transcriptionCompleted = false
  try {
    await expect(session.getByRole('status').filter({ hasText: 'Transcrição concluída. Confirme os papéis das vozes.' })).toBeVisible({ timeout: 30_000 })
    transcriptionCompleted = true
  } catch {
    // Keep the measurements when the live pipeline fails to finish.
  }

  const observation = await page.evaluate(() => {
    const telemetry = (window as HarnessWindow).__limmiarLiveLatency!
    return {
      finalText: telemetry.stop(),
      snapshots: telemetry.snapshots,
      wordStartPerformanceMs: telemetry.wordStartPerformanceMs,
      wordEndPerformanceMs: telemetry.wordEndPerformanceMs,
      baseLatencyMs: telemetry.baseLatencyMs,
      outputLatencyMs: telemetry.outputLatencyMs,
    }
  })
  const expected = manifest.words.map((word) => normalizeWord(word.text))
  const visibility = creditVisibility(expected, observation.wordStartPerformanceMs, observation.snapshots)
  const delays = visibility.firstVisibleMs.map((visible, index) => visible === null ? null : visible - observation.wordEndPerformanceMs[index]!)
  const pauseAfterMs = manifest.words.map((word, index) => {
    const next = manifest.words[index + 1]
    return Math.round(((next ? next.startSample : manifest.audio.framesPerChannel) - word.endSampleExclusive) / sampleRate * 1000)
  })
  const finalWords = tokenize(observation.finalText)
  const report = {
    ...aggregateWordLatency(delays),
    wordErrorRate: Math.round(wordErrorRate(expected, finalWords) * 1000) / 1000,
    finalTranscriptWordCount: finalWords.length,
    transcriptionCompleted,
    speechConnections,
    copilotRequests,
    snapshotCount: observation.snapshots.length,
    vanished: { reappearedWordCount: visibility.reappearedWordCount, lostWordCount: visibility.lostWordCount, longestAbsenceMs: Math.round(visibility.longestAbsenceMs) },
    byPosition: {
      midPhrase: aggregateWordLatency(delays.filter((_, index) => pauseAfterMs[index]! < PAUSA_MS)),
      beforePause: aggregateWordLatency(delays.filter((_, index) => pauseAfterMs[index]! >= PAUSA_MS)),
    },
    audioClock: { baseLatencyMs: observation.baseLatencyMs, outputLatencyMs: observation.outputLatencyMs },
    fixture: { file: manifest.audio.file, sha256: manifest.audio.sha256, seconds: audioMs / 1000, alignment: manifest.alignment },
    words: manifest.words.map((word, index) => ({
      index, text: word.text, speaker: word.speaker, pauseAfterMs: pauseAfterMs[index],
      delayMs: delays[index] === null ? null : Math.round(delays[index]! * 10) / 10,
    })),
  }
  const body = JSON.stringify(report, null, 2)
  const reportPath = testInfo.outputPath('live-asr-dom-latency.json')
  await writeFile(reportPath, body)
  if (process.env.LIVE_ASR_REPORT) {
    await mkdir(dirname(process.env.LIVE_ASR_REPORT), { recursive: true })
    await writeFile(process.env.LIVE_ASR_REPORT, body)
  }
  await testInfo.attach('live-asr-dom-latency.json', { path: reportPath, contentType: 'application/json' })
  console.log(JSON.stringify({ ...report, words: undefined, fixture: undefined }))

  expect(speechConnections, 'A captura abriu mais de uma conexão de fala.').toBe(1)
  expect(transcriptionCompleted, 'O gateway não concluiu a transcrição da fixture.').toBe(true)
  expect.soft(report.wordErrorRate, `WER da transcrição final acima de ${MAX_WER}.`).toBeLessThanOrEqual(MAX_WER)
  expect(report.slo300MsPassed, `SLO de 300 ms não atendido: ${JSON.stringify({ ...report, words: undefined })}`).toBe(true)
})
