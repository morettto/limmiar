import { SESSOES_POR_INSTANCIA, URLS_REALTIME } from './nemotron/garantir.mjs'
import { spawn, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
process.chdir(root)
const settingsPath = resolve(root, '.local/settings.json')
const secret = () => randomBytes(32).toString('base64')
if (!existsSync(settingsPath)) {
  mkdirSync(resolve(root, '.local'), { recursive: true })
  const pgPassword = secret()
  writeFileSync(settingsPath, JSON.stringify({
    ConnectionStrings: {
      AdminDb: `Host=127.0.0.1;Port=5432;Database=limmiar_local;Username=postgres;Password=${pgPassword}`,
      AppDb: `Host=127.0.0.1;Port=5432;Database=limmiar_local;Username=app_role;Password=${secret()}`,
    },
    StaffAccess: { ApiKey: secret() },
    Totp: { EncryptionKey: secret() },
    AbacatePay: { WebhookSecret: secret() },
    WebAuthn: { RelyingPartyId: 'localhost', ExpectedOrigin: 'http://localhost:5173' },
    Cors: { AllowedOrigins: ['http://localhost:5173'] },
  }, null, 2))
}
const settings = JSON.parse(readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, ''))
const copilotPython = resolve(root, 'mvp-copiloto/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
if (!existsSync(copilotPython)) {
  console.error('Prepare o serviço bibliográfico com uv sync --project mvp-copiloto antes de rodar pnpm dev. Veja README.md.')
  process.exit(1)
}
const env = { ...process.env, ASPNETCORE_ENVIRONMENT: 'Development', ASPNETCORE_URLS: 'http://127.0.0.1:5259' }
function flatten(value, prefix = '') {
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}__${key}` : key
    if (item !== null && typeof item === 'object') flatten(item, path)
    else env[path] = String(item)
  }
}
flatten(settings)
const docker = (args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
try {
  docker(['info', '--format', '{{.ServerVersion}}'])
  let container
  try { container = docker(['inspect', 'limmiar-local-postgres', '--format', '{{.State.Status}}']) } catch { /* Container ainda não criado. */ }
  if (!container) {
    const pgPassword = settings.ConnectionStrings.AdminDb.match(/(?:^|;)Password=([^;]+)/)[1]
    execFileSync('docker', ['run', '-d', '--name', 'limmiar-local-postgres', '-p', '127.0.0.1:5432:5432',
      '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=limmiar_local', '-v', 'limmiar-local-postgres:/var/lib/postgresql/data',
      '--health-cmd', 'pg_isready -U postgres -d limmiar_local', '--health-interval', '2s', '--health-retries', '20', 'postgres:17-alpine'],
    { env: { ...process.env, POSTGRES_PASSWORD: pgPassword }, stdio: ['ignore', 'pipe', 'pipe'] })
  } else if (container !== 'running') docker(['start', 'limmiar-local-postgres'])
  for (let attempts = 0; ; attempts++) {
    if (docker(['inspect', 'limmiar-local-postgres', '--format', '{{.State.Health.Status}}']) === 'healthy') break
    if (attempts === 30) throw new Error('PostgreSQL não ficou pronto; confira docker logs limmiar-local-postgres.')
    await new Promise((done) => setTimeout(done, 1000))
  }
  execFileSync('dotnet', ['run', '--no-launch-profile', '--project', 'apps/api/src/Api', '--', '--migrate-only'], { env, stdio: 'inherit' })
} catch (error) {
  console.error('Não foi possível preparar o banco local. Abra o Docker Desktop e rode pnpm dev novamente.')
  console.error(error.stderr?.toString() || error.message)
  process.exit(1)
}
console.log('Garantindo o serviço de transcrição (containers nemotron-speech-N).')
try { execFileSync(process.execPath, ['tools/nemotron/garantir.mjs'], { stdio: 'inherit' }) }
catch { process.exit(1) }
const children = []
console.log('Preparando o perfil de voz local (TitaNet).')
try { execFileSync(process.execPath, ['tools/voice-identity/setup.mjs'], { stdio: 'inherit' }); execFileSync(process.execPath, ['tools/voice-identity/setup-segmentacao.mjs'], { stdio: 'inherit' }) }
catch {
  console.error('Não foi possível preparar a identificação de voz. Confira tools/voice-identity/README.md.')
  process.exit(1)
}
function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', ...options })
  children.push(child)
  child.on('error', (error) => { console.error(error.message); stop(1) })
  child.on('exit', (code) => stop(code ?? 1))
  return child
}
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (process.platform === 'win32' && child.pid) {
      try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* Processo já encerrado. */ }
    } else child.kill()
  }
  process.exitCode = code
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
start(copilotPython, ['-m', 'uvicorn', 'copiloto.api:app', '--app-dir', 'src', '--host', '127.0.0.1', '--port', '8000'], {
  cwd: resolve(root, 'mvp-copiloto'),
  env: { ...env, COPILOTO_EMBEDDER_DISPOSITIVO: env.COPILOTO_EMBEDDER_DISPOSITIVO ?? 'cpu',
    COPILOTO_JUIZ_DISPOSITIVO: process.env.COPILOTO_JUIZ_DISPOSITIVO ?? 'cpu' },
})
// Gateway de fala (apps/gateway-fala): o /speech do Vite chega aqui; ele fala com o container do NeMo-Speech.
start(process.execPath, ['apps/gateway-fala/src/main.ts'], {
  env: { ...env, GATEWAY_FALA_MODELO: resolve(root, 'apps/app/public/models/voice-identity/titanet.onnx'),
    GATEWAY_FALA_SEGMENTACAO: resolve(root, '.local/diarization/sherpa-onnx-pyannote-segmentation-3-0/model.onnx'), NEMOTRON_URLS: URLS_REALTIME.join(','),
    NEMOTRON_SESSOES_POR_INSTANCIA: String(SESSOES_POR_INSTANCIA) },
})
console.log('Carregando o acervo e o juiz bibliográfico local.')
start('dotnet', ['run', '--no-launch-profile', '--project', 'apps/api/src/Api'])
const pnpmEntry = process.env.npm_execpath
if (pnpmEntry) start(process.execPath, [pnpmEntry, '--filter', 'app', 'dev'])
else start('pnpm', ['--filter', 'app', 'dev'], { shell: process.platform === 'win32' })
console.log('\nLimmiar local: http://localhost:5173 — Ctrl+C encerra API, interface e serviço bibliográfico.\n')
