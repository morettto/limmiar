// Orçamento de bundle: falha o CI se o gzip de um grupo de arquivos de dist/assets passa do teto.
// Tetos em bytes, medidos num build limpo mais ~5% (JS lazy remedido em 11/10/2026: 46.802 B, os catálogos cresceram; CSS: 6.828 B com a barra do consultório). Subir um teto é decisão de PR.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const BUDGETS = [
  { name: 'JS de entrada', match: /^index-.*\.js$/, max: 247_000 },
  { name: 'JS lazy (catálogos de idioma, workers)', match: /^(?!index-).*\.js$/, max: 49_200 },
  { name: 'CSS', match: /\.css$/, max: 7_200 },
]

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'assets')
const files = readdirSync(dir)
let failed = false

for (const { name, match, max } of BUDGETS) {
  const group = files.filter((file) => match.test(file))
  if (group.length === 0) {
    console.error(`${name}: nenhum arquivo em ${dir}; rode o build antes`)
    failed = true
    continue
  }
  const size = group.reduce((total, file) => total + gzipSync(readFileSync(join(dir, file))).length, 0)
  const ok = size <= max
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${size} B gzip (teto ${max} B)`)
  failed ||= !ok
}

process.exit(failed ? 1 : 0)
