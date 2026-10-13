import { preview } from 'astro'
import { fileURLToPath } from 'node:url'

await preview({
  root: fileURLToPath(new URL('../', import.meta.url)),
  server: { host: '127.0.0.1', port: 4321 },
})
