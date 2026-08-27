import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SECURITY_HEADERS } from './security-headers.ts'

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
})
