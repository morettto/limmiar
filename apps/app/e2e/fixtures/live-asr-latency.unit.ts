import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { aggregateWordLatency, creditVisibility, normalizeWord, validateLiveAudioManifest, wordErrorRate } from './live-asr-latency.ts'

const pcm = Uint8Array.from([0, 0, 1, 0, 2, 0, 3, 0])
const hash = createHash('sha256').update(pcm).digest('hex')
const manifest = {
  schemaVersion: 2,
  audio: { file: 'fixture.pcm', sha256: hash, encoding: 'pcm_s16le', sampleRate: 16_000, channels: 1, framesPerChannel: 4 },
  alignment: {
    method: 'synthesizer_word_boundaries', engine: 'System.Speech 4.0.0.0', voices: { profissional: 'Voz A', paciente: 'Voz B' },
    generatedAt: '2026-10-19T12:00:00Z', script: 'roteiro.json',
  },
  words: [{ text: 'Olá,', speaker: 'profissional', startSample: 0, endSampleExclusive: 2 }, { text: 'mundo.', speaker: 'paciente', startSample: 2, endSampleExclusive: 4 }],
} as const

test('accepts only synthesizer boundaries that are ordered, non-overlapping, voiced and hash-matched', () => {
  assert.equal(validateLiveAudioManifest(manifest, pcm).words.length, 2)
  assert.throws(() => validateLiveAudioManifest({ ...manifest, alignment: { ...manifest.alignment, method: 'manual_sample_boundary_review' } }, pcm), /sintetizador/)
  assert.throws(() => validateLiveAudioManifest({ ...manifest, alignment: { ...manifest.alignment, voices: {} } }, pcm), /sintetizador/)
  assert.throws(() => validateLiveAudioManifest({ ...manifest, words: [manifest.words[0], { ...manifest.words[1], startSample: 1 }] }, pcm), /sobreposição/)
  assert.throws(() => validateLiveAudioManifest({ ...manifest, words: [manifest.words[0], { ...manifest.words[1], speaker: 'terceiro' }] }, pcm), /voz declarada/)
  assert.throws(() => validateLiveAudioManifest(manifest, Uint8Array.from([9, 9])), /Tamanho do PCM/)
  assert.throws(() => validateLiveAudioManifest(manifest, Uint8Array.from([9, 9, 9, 9, 9, 9, 9, 9])), /Hash/)
})

test('an ASR error on one word does not stop crediting the words after it', () => {
  const expected = ['como', 'voce', 'passou', 'a', 'semana'].map(normalizeWord)
  const { firstVisibleMs } = creditVisibility(expected, [0, 100, 200, 300, 400], [
    { atMs: 250, text: 'Como você' },
    { atMs: 600, text: 'Como você pasou a semana?' },
  ])
  assert.deepEqual(firstVisibleMs, [250, 250, null, 600, 600])
})

test('a phrase that leaves the screen counts as vanished, and the next phrase is still credited when it shows', () => {
  const visibility = creditVisibility(['boa', 'tarde', 'como', 'vai'], [0, 100, 200, 300], [
    { atMs: 150, text: 'Boa tarde.' },
    { atMs: 350, text: 'Como vai' },
    { atMs: 500, text: 'Boa tarde. Como vai?' },
  ])
  assert.deepEqual(visibility, { firstVisibleMs: [150, 150, 350, 350], reappearedWordCount: 2, lostWordCount: 0, longestAbsenceMs: 150 })
  assert.equal(creditVisibility(['boa', 'tarde'], [0, 100], [{ atMs: 150, text: 'Boa tarde' }, { atMs: 300, text: '' }]).lostWordCount, 2)
})

test('a repeated word is never credited before that occurrence has started', () => {
  const { firstVisibleMs } = creditVisibility(['o', 'medo', 'de', 'errar', 'o', 'medo'], [0, 100, 200, 300, 400, 500], [
    { atMs: 350, text: 'o medo de errar o' },
    { atMs: 650, text: 'o medo de errar o medo' },
  ])
  assert.deepEqual(firstVisibleMs, [350, 350, 350, 350, 650, 650])
})

test('word error rate counts substitutions, deletions and insertions against the expected length', () => {
  assert.equal(wordErrorRate(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd']), 0.25)
  assert.equal(wordErrorRate(['a', 'b', 'c', 'd'], ['a', 'c', 'd', 'e', 'f']), 0.75)
  assert.equal(wordErrorRate(['a', 'b'], ['a', 'b']), 0)
})

test('the SLO passes only with every word credited and the slowest at most 300 ms', () => {
  assert.equal(normalizeWord('AÇÃO!'), 'acao')
  assert.deepEqual(aggregateWordLatency([90.25, 301, null]), {
    expectedWordCount: 3, matchedWordCount: 2, missingWordCount: 1, minMs: 90.3, p50Ms: 90.3, p95Ms: 301, maxMs: 301, slo300MsPassed: false,
  })
  assert.equal(aggregateWordLatency([-20, 45, 300]).slo300MsPassed, true)
  assert.equal(aggregateWordLatency([-20, 45, 300]).minMs, -20)
  assert.equal(aggregateWordLatency([20, 301]).slo300MsPassed, false)
  assert.equal(aggregateWordLatency([20, null]).slo300MsPassed, false)
})
