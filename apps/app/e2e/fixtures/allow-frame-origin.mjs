// A CSP do E2E vem de dist-e2e/_headers: a API entra por VITE_API_BASE_URL no build (security-headers.ts),
// mas o iframe de terceiro tem outra origem e a CSP não tem frame-src. Corre depois de build:e2e e só toca no artefacto de teste.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const [frameOrigin] = process.argv.slice(2)
if (!frameOrigin) {
  console.error('uso: node allow-frame-origin.mjs <origem-do-iframe>')
  process.exit(1)
}

const headersPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist-e2e', '_headers')
const headers = await readFile(headersPath, 'utf8')
const patched = headers.replace(/(connect-src [^;]*)/, `$1; frame-src 'self' ${frameOrigin}`)

if (patched === headers) {
  console.error(`connect-src não encontrado em ${headersPath}`)
  process.exit(1)
}

await writeFile(headersPath, patched)
