import type { Page } from '@playwright/test'
import { createReadStream, existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Infraestrutura, não regra do app: o wrangler dev ignora /models/ (public/.assetsignore) e recusa arquivos
// acima de 25 MiB. O worker e o modelo de produção são os mesmos; só vêm de um servidor local.
export const PASTA_MODELO_VOZ = fileURLToPath(new URL('../../public/models/voice-identity', import.meta.url))
export const modeloDeVozInstalado = () => existsSync(join(PASTA_MODELO_VOZ, 'titanet.onnx'))

const TIPOS: Record<string, string> = { '.js': 'text/javascript', '.wasm': 'application/wasm' }

export async function servirModeloDeVoz(page: Page): Promise<Server> {
  const servidor = createServer((pedido, resposta) => {
    const arquivo = join(PASTA_MODELO_VOZ, basename(new URL(pedido.url ?? '/', 'http://x').pathname))
    if (!existsSync(arquivo)) { resposta.statusCode = 404; resposta.end(); return }
    resposta.setHeader('Cross-Origin-Embedder-Policy', 'credentialless')
    resposta.setHeader('Content-Type', TIPOS[arquivo.slice(arquivo.lastIndexOf('.'))] ?? 'application/octet-stream')
    createReadStream(arquivo).pipe(resposta)
  })
  await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver))
  servidor.unref()
  const origem = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
  // route.continue com outra URL não é visível à página: origem, CSP e import.meta.url ficam os do app.
  await page.route('**/models/voice-identity/*', (rota) =>
    rota.continue({ url: `${origem}/${basename(new URL(rota.request().url()).pathname)}` }))
  return servidor
}
