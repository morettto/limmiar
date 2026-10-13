import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = resolve(root, 'apps/app/public/models/voice-identity')
const source = fileURLToPath(new URL('./', import.meta.url))
const modelHash = 'd51abcf31717ef28162f26acb9d44dd4127c3d44c9b8624f699f3425daca8e77'
const modelPath = resolve(output, 'titanet.onnx')
const manifestPath = resolve(output, 'build.json')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const sourceHash = hash(Buffer.concat(['Dockerfile', 'CMakeLists.txt', 'embedding.cpp', 'worker.js']
  .map(name => readFileSync(resolve(source, name)))))
mkdirSync(output, { recursive: true })
let manifest
if (existsSync(manifestPath)) manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const runtimeFiles = ['limmiar-titanet.js', 'limmiar-titanet.wasm', 'worker.js']
if (manifest?.sourceHash !== sourceHash || runtimeFiles.some(name =>
  !existsSync(resolve(output, name)) || hash(readFileSync(resolve(output, name))) !== manifest.files[name])) {
  execFileSync('docker', ['build', '--output', `type=local,dest=${output}`, source], { stdio: 'inherit' })
  const files = Object.fromEntries(runtimeFiles.map(name => [name, hash(readFileSync(resolve(output, name)))]))
  writeFileSync(manifestPath, JSON.stringify({ sourceHash, modelHash, files }, null, 2))
}
if (!existsSync(modelPath)) {
  const response = await fetch('https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_titanet_large.onnx')
  if (!response.ok || !response.body) throw new Error('Não foi possível baixar o modelo público TitaNet.')
  const temporary = `${modelPath}.download`
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary))
  if (hash(readFileSync(temporary)) !== modelHash) throw new Error('Hash do modelo TitaNet inválido.')
  renameSync(temporary, modelPath)
}
if (hash(readFileSync(modelPath)) !== modelHash) throw new Error('Modelo TitaNet local adulterado.')
console.log('Extrator TitaNet local verificado; nenhuma gravação é baixada ou armazenada.')
