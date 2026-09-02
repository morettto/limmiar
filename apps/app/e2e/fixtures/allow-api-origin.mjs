// A CSP do E2E vem de dist-e2e/_headers, cujo connect-src é `'self'` mais os fornecedores de IA.
// Em produção a API é da mesma origem; no E2E corre noutra porta, e sem esta entrada o browser
// bloqueia as chamadas. Corre depois de build:e2e e só toca no artefacto de teste.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const apiOrigin = process.argv[2]
if (!apiOrigin) {
  console.error('uso: node allow-api-origin.mjs <origem-da-api>')
  process.exit(1)
}

const headersPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist-e2e', '_headers')
const headers = await readFile(headersPath, 'utf8')
const patched = headers.replace("connect-src 'self'", `connect-src 'self' ${apiOrigin}`)

if (patched === headers) {
  console.error(`connect-src 'self' não encontrado em ${headersPath}`)
  process.exit(1)
}

await writeFile(headersPath, patched)
