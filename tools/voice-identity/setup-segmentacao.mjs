import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const MODELO_SEGMENTACAO = fileURLToPath(new URL('../../.local/diarization/sherpa-onnx-pyannote-segmentation-3-0/model.onnx', import.meta.url))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const modeloHash = '220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079'
const arquivoHash = '24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488'

if (!existsSync(MODELO_SEGMENTACAO)) {
  const pasta = fileURLToPath(new URL('../../.local/diarization/', import.meta.url))
  mkdirSync(pasta, { recursive: true })
  const arquivo = fileURLToPath(new URL('../../.local/diarization/pyannote.tar.bz2', import.meta.url))
  const resposta = await fetch('https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2')
  if (!resposta.ok) throw new Error('Não foi possível baixar o modelo de separação de vozes.')
  const bytes = Buffer.from(await resposta.arrayBuffer())
  if (sha256(bytes) !== arquivoHash) throw new Error('Hash do arquivo de separação de vozes inválido.')
  writeFileSync(arquivo, bytes)
  execFileSync('tar', ['-xjf', arquivo, '-C', pasta, 'sherpa-onnx-pyannote-segmentation-3-0/model.onnx', 'sherpa-onnx-pyannote-segmentation-3-0/LICENSE'])
}
if (sha256(readFileSync(MODELO_SEGMENTACAO)) !== modeloHash) throw new Error('Modelo de separação de vozes local adulterado.')
console.log('Modelo de separação de vozes verificado.')
