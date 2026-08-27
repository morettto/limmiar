// A CSP que o E2E recebe vem de dist-e2e/_headers (cópia de public/_headers), cujo
// connect-src é `'self'` mais os três fornecedores de IA -- ver apps/app/security-headers.ts.
// Em produção a API .NET é servida na mesma origem do app, então `'self'` cobre-a; no E2E ela
// corre num processo à parte (playwright.config.ts, API_BASE_URL), noutra porta e portanto
// noutra origem, e sem esta entrada o browser bloqueia toda chamada de API -- as páginas de
// pareamento e de recuperação ficam presas no estado "a preparar" e o spec falha a apontar
// para um elemento que nunca chega a existir.
//
// Corre depois de `build:e2e` e só toca no artefacto de teste: public/_headers e o build de
// produção (dist/) ficam intactos, e security-headers.test.ts continua a comparar a fonte.
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
