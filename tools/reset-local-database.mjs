import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const container = 'limmiar-local-postgres'
const database = 'limmiar_local'
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] })

try {
  const [state] = JSON.parse(docker(['inspect', container]))
  assert.equal(state.Name, `/${container}`)
  assert.ok(state.Config.Env.includes(`POSTGRES_DB=${database}`))
  assert.ok(state.Mounts.some(mount => mount.Name === container && mount.Destination === '/var/lib/postgresql/data'))
  assert.deepEqual(state.NetworkSettings.Ports['5432/tcp'], [{ HostIp: '127.0.0.1', HostPort: '5432' }])
  const actual = docker(['exec', container, 'psql', '-U', 'postgres', '-d', database, '-Atc', 'SELECT current_database()']).trim()
  assert.equal(actual, database)
  docker(['exec', container, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-c',
    'BEGIN; DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO app_role; COMMIT;'])
  console.log(`Base local ${database} zerada. Reinicie com pnpm dev para recriar o esquema.`)
} catch {
  console.error('Não foi possível confirmar o reset: Docker indisponível ou alvo diferente da base local esperada.')
  process.exitCode = 1
}
