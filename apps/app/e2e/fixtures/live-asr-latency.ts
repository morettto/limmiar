import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_LIVE_AUDIO = fileURLToPath(new URL('./live-asr/sessao-clinica.pcm', import.meta.url))
export const DEFAULT_LIVE_MANIFEST = fileURLToPath(new URL('./live-asr/sessao-clinica.words.json', import.meta.url))

export interface LiveWordBoundary {
  text: string
  speaker: string
  startSample: number
  endSampleExclusive: number
}

export interface LiveAudioManifest {
  schemaVersion: 2
  audio: {
    file: string
    sha256: string
    encoding: 'pcm_s16le'
    sampleRate: number
    channels: 1
    framesPerChannel: number
  }
  alignment: {
    method: 'synthesizer_word_boundaries'
    engine: string
    voices: Record<string, string>
    generatedAt: string
    script: string
  }
  words: LiveWordBoundary[]
}

export interface LatencyAggregate {
  expectedWordCount: number
  matchedWordCount: number
  missingWordCount: number
  minMs: number | null
  p50Ms: number | null
  p95Ms: number | null
  maxMs: number | null
  slo300MsPassed: boolean
}

/** One rendered frame of the live transcript: its text and when the frame ran. */
export interface TranscriptSnapshot {
  atMs: number
  text: string
}

export interface WordVisibility {
  firstVisibleMs: (number | null)[]
  /** Words that left the transcript after first showing up and later came back. */
  reappearedWordCount: number
  /** Words that showed up and are absent from the last snapshot. */
  lostWordCount: number
  longestAbsenceMs: number
}

export function tokenize(text: string): string[] {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').match(/[\p{L}\p{N}]+/gu) ?? []
}

export function normalizeWord(value: string): string {
  const tokens = tokenize(value)
  if (tokens.length !== 1) throw new Error('Cada limite precisa corresponder a exatamente uma palavra reconhecível.')
  return tokens[0]!
}

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

export function validateLiveAudioManifest(value: unknown, pcm: Uint8Array): LiveAudioManifest {
  if (!value || typeof value !== 'object') throw new Error('Manifesto de latência inválido.')
  const manifest = value as Partial<LiveAudioManifest>
  const audio = manifest.audio
  const alignment = manifest.alignment
  if (manifest.schemaVersion !== 2 || !audio || !alignment || !Array.isArray(manifest.words) || manifest.words.length === 0) {
    throw new Error('Manifesto exige formato, proveniência de alinhamento e limites de palavras.')
  }
  if (!nonEmpty(audio.file) || audio.encoding !== 'pcm_s16le' || audio.channels !== 1 || !Number.isInteger(audio.sampleRate) || audio.sampleRate <= 0 ||
      !Number.isInteger(audio.framesPerChannel) || audio.framesPerChannel <= 0 || !/^[\da-f]{64}$/i.test(audio.sha256)) {
    throw new Error('Formato ou hash do PCM não corresponde ao manifesto exigido.')
  }
  const voices = alignment.voices
  if (alignment.method !== 'synthesizer_word_boundaries' || !nonEmpty(alignment.engine) || !nonEmpty(alignment.script) ||
      !Number.isFinite(Date.parse(alignment.generatedAt)) || !voices || typeof voices !== 'object' ||
      Object.keys(voices).length === 0 || !Object.values(voices).every(nonEmpty)) {
    throw new Error('O alinhamento precisa vir dos limites de palavra do sintetizador, com motor, vozes, data e roteiro.')
  }
  if (pcm.byteLength !== audio.framesPerChannel * audio.channels * 2) throw new Error('Tamanho do PCM difere da quantidade de amostras declarada.')
  const sha256 = createHash('sha256').update(pcm).digest('hex')
  if (sha256 !== audio.sha256.toLowerCase()) throw new Error('Hash do PCM difere do manifesto.')

  let previousEnd = 0
  for (const word of manifest.words) {
    if (!word || typeof word.text !== 'string' || !Object.hasOwn(voices, word.speaker) || !Number.isInteger(word.startSample) ||
        !Number.isInteger(word.endSampleExclusive) || word.startSample < previousEnd || word.endSampleExclusive <= word.startSample ||
        word.endSampleExclusive > audio.framesPerChannel) {
      throw new Error('Limites de palavra devem ser inteiros crescentes, sem sobreposição, dentro do áudio e de uma voz declarada.')
    }
    normalizeWord(word.text)
    previousEnd = word.endSampleExclusive
  }
  return manifest as LiveAudioManifest
}

export async function loadLiveAudioFixture(): Promise<
  | { state: 'ready'; audio: Uint8Array; manifest: LiveAudioManifest }
  | { state: 'blocked'; reason: string }
> {
  const audioPath = resolve(process.env.LIVE_ASR_AUDIO ?? DEFAULT_LIVE_AUDIO)
  const manifestPath = resolve(process.env.LIVE_ASR_WORD_MANIFEST ?? DEFAULT_LIVE_MANIFEST)
  let manifestText: string
  try {
    manifestText = await readFile(manifestPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { state: 'blocked', reason: `Manifesto temporal ausente: ${manifestPath}. Gere com e2e/fixtures/live-asr/gerar-fixture.ps1.` }
    }
    throw error
  }
  const audio = await readFile(audioPath)
  const manifest = validateLiveAudioManifest(JSON.parse(manifestText) as unknown, audio)
  return { state: 'ready', audio, manifest }
}

function editCosts(expected: readonly string[], actual: readonly string[]): Int32Array[] {
  const costs = Array.from({ length: expected.length + 1 }, () => new Int32Array(actual.length + 1))
  for (let j = 0; j <= actual.length; j += 1) costs[0]![j] = j
  for (let i = 1; i <= expected.length; i += 1) {
    const row = costs[i]!
    const above = costs[i - 1]!
    row[0] = i
    for (let j = 1; j <= actual.length; j += 1) {
      row[j] = Math.min(above[j - 1]! + (expected[i - 1] === actual[j - 1] ? 0 : 1), above[j]! + 1, row[j - 1]! + 1)
    }
  }
  return costs
}

/** For each expected word, the index of the equal visible token a minimum-edit alignment pairs it with, or null. */
export function alignToExpected(expected: readonly string[], visible: readonly string[]): (number | null)[] {
  const costs = editCosts(expected, visible)
  const aligned = expected.map(() => null as number | null)
  let i = expected.length
  let j = visible.length
  while (i > 0 && j > 0) {
    const equal = expected[i - 1] === visible[j - 1]
    if (costs[i]![j] === costs[i - 1]![j - 1]! + (equal ? 0 : 1)) {
      if (equal) aligned[i - 1] = j - 1
      i -= 1
      j -= 1
    } else if (costs[i]![j] === costs[i - 1]![j]! + 1) i -= 1
    else j -= 1
  }
  return aligned
}

export function wordErrorRate(expected: readonly string[], actual: readonly string[]): number {
  return editCosts(expected, actual)[expected.length]![actual.length]! / expected.length
}

/**
 * Each snapshot is aligned against the words already started at its time, so a phrase missing from the
 * screen costs deletions instead of being mistaken for speech still to come.
 */
export function creditVisibility(expected: readonly string[], wordStartMs: readonly number[], snapshots: readonly TranscriptSnapshot[]): WordVisibility {
  const firstVisibleMs = expected.map(() => null as number | null)
  const absentSince = expected.map(() => null as number | null)
  const reappeared = new Set<number>()
  let longestAbsenceMs = 0
  for (const { atMs, text } of snapshots) {
    const spoken = wordStartMs.filter((start) => start <= atMs).length
    alignToExpected(expected.slice(0, spoken), tokenize(text)).forEach((visibleIndex, word) => {
      if (visibleIndex === null) {
        if (firstVisibleMs[word] !== null && absentSince[word] === null) absentSince[word] = atMs
      } else if (firstVisibleMs[word] === null) {
        firstVisibleMs[word] = atMs
      } else if (absentSince[word] !== null) {
        reappeared.add(word)
        longestAbsenceMs = Math.max(longestAbsenceMs, atMs - absentSince[word]!)
        absentSince[word] = null
      }
    })
  }
  return { firstVisibleMs, reappearedWordCount: reappeared.size, lostWordCount: absentSince.filter((since) => since !== null).length, longestAbsenceMs }
}

export function aggregateWordLatency(delaysMs: readonly (number | null)[]): LatencyAggregate {
  const matched = delaysMs.filter((delay): delay is number => delay !== null && Number.isFinite(delay)).sort((a, b) => a - b)
  const round = (value: number | undefined) => value === undefined ? null : Math.round(value * 10) / 10
  const percentile = (fraction: number) => round(matched[Math.ceil(fraction * matched.length) - 1])
  const maxMs = round(matched.at(-1))
  const missingWordCount = delaysMs.length - matched.length
  return {
    expectedWordCount: delaysMs.length,
    matchedWordCount: matched.length,
    missingWordCount,
    minMs: round(matched[0]),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs,
    slo300MsPassed: delaysMs.length > 0 && missingWordCount === 0 && maxMs !== null && maxMs <= 300,
  }
}
