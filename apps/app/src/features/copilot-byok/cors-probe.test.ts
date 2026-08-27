import { describe, expect, it, vi } from 'vitest'
import { probeProviderCors } from './cors-probe'
import type { AiProvider } from './provider-registry'

const PROVIDER: AiProvider = {
  id: 'openai',
  label: 'OpenAI',
  baseUrl: 'https://api.openai.com',
  probePath: '/v1/models',
  probeHeaders: { 'x-test-header': '1' },
}

describe('probeProviderCors', () => {
  it('defaults fetchImpl to the global fetch when none is passed', async () => {
    const globalFetch = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', globalFetch)

    const result = await probeProviderCors(PROVIDER)

    expect(result).toEqual({ ok: true, status: 401 })
    expect(globalFetch).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('classifies a reachable response (even 401) as ok:true with its status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))

    const result = await probeProviderCors(PROVIDER, fetchImpl)

    expect(result).toEqual({ ok: true, status: 401 })
  })

  it('classifies a fetch rejection (CORS block or network failure) as ok:false, reason:blocked', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

    const result = await probeProviderCors(PROVIDER, fetchImpl)

    expect(result).toEqual({ ok: false, reason: 'blocked' })
  })

  it('calls fetch with mode:cors, credentials:omit, and the provider probeHeaders', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))

    await probeProviderCors(PROVIDER, fetchImpl)

    expect(fetchImpl).toHaveBeenCalledWith('https://api.openai.com/v1/models', {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      headers: { 'x-test-header': '1' },
    })
  })
})
