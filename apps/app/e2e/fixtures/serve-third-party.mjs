import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dir = dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT ?? 5333)

createServer(async (_req, res) => {
  const body = await readFile(join(dir, 'third-party-stub', 'index.html'))
  // Terceiro cooperante: precisa de CORP cross-origin E de algum COEP para ser embutível como
  // iframe; credentialless só dispensa isso para subresource. Sem os dois, o Chromium bloqueia
  // a navegação do iframe — por isso o checkout real saiu do escopo isolado (ADR-S00-02/D8).
  res.writeHead(200, {
    'Content-Type': 'text/html',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
  })
  res.end(body)
}).listen(port, '127.0.0.1', () => {
  console.log(`third-party stub listening on http://127.0.0.1:${port}`)
})
