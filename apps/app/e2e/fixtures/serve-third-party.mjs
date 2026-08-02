import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dir = dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT ?? 5333)

createServer(async (_req, res) => {
  const body = await readFile(join(dir, 'third-party-stub', 'index.html'))
  // Terceiro cooperante: precisa mandar CORP cross-origin + algum COEP
  // pra ser embutível como iframe sob COEP (qualquer variante — require-corp
  // ou credentialless). Achado do spike: credentialless SÓ dispensa isso
  // pra subresource (img/script/etc, request no-cors); pra navegação de
  // iframe completa, sem os dois headers no lado do terceiro o Chromium
  // bloqueia com "coep-frame-resource-needs-coep-header" (falta COEP) ou
  // "corp-not-same-origin-after-defaulted-to-same-origin-by-coep" (COEP
  // presente mas CORP ausente vira same-origin por default, e falha porque
  // a origem realmente é cross-origin). É exatamente por isso que o
  // checkout real foi tirado do escopo isolado (ADR-S00-02/D8) — terceiro
  // de pagamento raramente coopera com esses dois headers.
  res.writeHead(200, {
    'Content-Type': 'text/html',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
  })
  res.end(body)
}).listen(port, '127.0.0.1', () => {
  console.log(`third-party stub listening on http://127.0.0.1:${port}`)
})
