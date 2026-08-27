import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CONTENT_SECURITY_POLICY } from './csp'
import { SUPPORTED_PROVIDERS } from './provider-registry'

const headersPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public/_headers')
const headersContent = readFileSync(headersPath, 'utf-8')

function connectSrcOrigins(text: string): string[] {
  const match = text.match(/connect-src ([^;]+);/)
  if (match === null) {
    throw new Error('connect-src directive not found in public/_headers -- CSP format changed')
  }
  return match[1].split(' ')
}

describe('CONTENT_SECURITY_POLICY', () => {
  it('is published verbatim as the Content-Security-Policy line in public/_headers', () => {
    expect(headersContent).toContain(`  Content-Security-Policy: ${CONTENT_SECURITY_POLICY}`)
  })

  it('connect-src in _headers covers every SUPPORTED_PROVIDERS baseUrl', () => {
    const origins = connectSrcOrigins(headersContent)
    for (const provider of SUPPORTED_PROVIDERS) {
      expect(origins).toContain(provider.baseUrl)
    }
  })

  it('connect-src in _headers has no origin beyond self and the supported providers', () => {
    const allowed = new Set(["'self'", ...SUPPORTED_PROVIDERS.map((provider) => provider.baseUrl)])
    for (const origin of connectSrcOrigins(headersContent)) {
      expect(allowed.has(origin)).toBe(true)
    }
  })

  it("sets object-src to 'none'", () => {
    expect(headersContent).toContain("object-src 'none'")
  })
})
