import { afterEach, describe, expect, it, vi } from 'vitest'
import { getHealthDb } from './client'

describe('getHealthDb', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns { ok: true } on a 2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getHealthDb('http://api.test')).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/health/db')
  })

  it('returns { ok: false, code, params } parsed from the problem+json body on a non-2xx response', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Database unreachable',
      status: 503,
      code: 'health.database_unreachable',
      params: {},
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), {
        status: 503,
        headers: { 'Content-Type': 'application/problem+json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getHealthDb('http://api.test')).resolves.toEqual({
      ok: false,
      code: 'health.database_unreachable',
      params: {},
    })
  })
})
