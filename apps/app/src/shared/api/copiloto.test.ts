import { afterEach, describe, expect, it, vi } from 'vitest'

async function baseUrl(env: string | undefined) {
  vi.stubEnv('VITE_COPILOTO_BASE_URL', env)
  vi.resetModules()
  return (await import('./copiloto')).COPILOTO_BASE_URL
}

describe('COPILOTO_BASE_URL', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

  it('usa o proxy /copiloto quando o build não nomeia a origem', async () => {
    expect(await baseUrl(undefined)).toBe('/copiloto')
  })

  it('usa a origem do build sem a barra final', async () => {
    expect(await baseUrl('https://copiloto.exemplo.test/v1///')).toBe('https://copiloto.exemplo.test/v1')
    expect(await baseUrl('https://copiloto.exemplo.test')).toBe('https://copiloto.exemplo.test')
  })

  it('só remove barras do fim, nunca as do meio', async () => {
    expect(await baseUrl('/a//b/')).toBe('/a//b')
  })
})
