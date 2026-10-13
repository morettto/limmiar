import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SECURITY_HEADERS, connectSrc, securityHeaders, withHostedOrigins } from './security-headers.ts'

// public/_headers uses CRLF (Cloudflare Pages convention in this repo); normalize before
// comparing so a checkout-time line-ending change never fails this test for the wrong reason.
const headersPath = resolve(dirname(fileURLToPath(import.meta.url)), 'public/_headers')
const headersContent = readFileSync(headersPath, 'utf-8').replace(/\r\n/g, '\n')

describe('SECURITY_HEADERS', () => {
  it('is published verbatim as the header block in public/_headers', () => {
    const expectedBlock = Object.entries(SECURITY_HEADERS)
      .map(([name, value]) => `  ${name}: ${value}`)
      .join('\n')
    expect(headersContent).toContain(expectedBlock)
  })

  it('locks every fetch directive to this origin and sends the transport and privacy headers', () => {
    const csp = SECURITY_HEADERS['Content-Security-Policy'].split('; ')
    expect(csp).toEqual(expect.arrayContaining([
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "worker-src 'self' blob:",
      "media-src blob:",
      "connect-src 'self'",
    ]))
    expect(csp.join(' ')).not.toMatch(/https?:/)
    expect(SECURITY_HEADERS['Strict-Transport-Security']).toMatch(/^max-age=\d{8,}/)
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe('no-referrer')
    expect(SECURITY_HEADERS['Permissions-Policy']).toBe('microphone=(self), camera=(self), geolocation=()')
  })
})

describe('hosted origins', () => {
  const hosted = {
    VITE_API_BASE_URL: 'https://api.example.fly.dev',
    VITE_COPILOTO_BASE_URL: 'https://copiloto.example.fly.dev/',
    VITE_SPEECH_BASE_URL: 'https://fala.example.fly.dev',
    VITE_JUIZ_BASE_URL: 'http://127.0.0.1:8000',
  }

  it('adds each origin once with its WebSocket twin, and nothing when unset or empty', () => {
    expect(connectSrc({})).toBe("'self'")
    expect(connectSrc({ VITE_API_BASE_URL: '', VITE_COPILOTO_BASE_URL: undefined })).toBe("'self'")
    expect(connectSrc(hosted)).toBe(
      "'self' https://api.example.fly.dev wss://api.example.fly.dev https://copiloto.example.fly.dev wss://copiloto.example.fly.dev https://fala.example.fly.dev wss://fala.example.fly.dev http://127.0.0.1:8000 ws://127.0.0.1:8000")
    expect(connectSrc({ VITE_API_BASE_URL: hosted.VITE_API_BASE_URL, VITE_COPILOTO_BASE_URL: `${hosted.VITE_API_BASE_URL}/x` }))
      .toBe("'self' https://api.example.fly.dev wss://api.example.fly.dev")
  })

  it('refuses a relative or malformed origin instead of publishing a policy that ignores it', () => {
    expect(() => connectSrc({ VITE_COPILOTO_BASE_URL: '/copiloto' })).toThrow()
  })

  it('only connect-src changes in the headers and in the published file', () => {
    expect(securityHeaders({})).toEqual(SECURITY_HEADERS)
    const { 'Content-Security-Policy': hostedCsp, ...hostedRest } = securityHeaders(hosted)
    const { 'Content-Security-Policy': baselineCsp, ...baselineRest } = SECURITY_HEADERS
    expect(hostedRest).toEqual(baselineRest)
    expect(hostedCsp).toBe(baselineCsp.replace("connect-src 'self'", `connect-src ${connectSrc(hosted)}`))
    expect(withHostedOrigins(headersContent, {})).toBe(headersContent)
    expect(withHostedOrigins(headersContent, hosted)).toContain(`connect-src ${connectSrc(hosted)};`)
  })

  it('fails when the published file has no connect-src to extend', () => {
    expect(() => withHostedOrigins('X-Test: 1', hosted)).toThrow('connect-src')
  })
})
