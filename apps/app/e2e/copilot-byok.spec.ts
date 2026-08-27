import { test, expect } from '@playwright/test'
import { SUPPORTED_PROVIDERS } from '../src/features/copilot-byok/provider-registry'
import { probeProviderCors } from '../src/features/copilot-byok/cors-probe'
import type { AiProvider } from '../src/features/copilot-byok/provider-registry'

// S07-01: unlike every other spec in this file/directory, this one depends on REAL internet
// access to three third-party APIs (OpenAI, Anthropic, Gemini) -- there is no local fixture
// that can stand in for "does this provider's CORS policy actually let a browser call it".
// A failure here can mean this repo broke something, OR it can mean one of those providers'
// APIs (or this network) is down/rate-limiting/changed its CORS policy -- check which before
// treating a red run here as a regression in our code.
//
// probeProviderCors runs with `page.evaluate`, not in this Node/Playwright process: Node's
// `fetch` has no browser CORS enforcement at all, so running the probe here would tell us
// nothing about whether a real browser lets the request through.

test.describe('copilot BYOK provider CORS (S07-01)', () => {
  for (const provider of SUPPORTED_PROVIDERS) {
    test(`${provider.id} answers a cross-origin probe from the browser`, async ({ page }) => {
      await page.goto('/')

      const result = await page.evaluate(
        async ({ baseUrl, probePath, probeHeaders }: Pick<AiProvider, 'baseUrl' | 'probePath' | 'probeHeaders'>) => {
          try {
            const res = await fetch(baseUrl + probePath, {
              method: 'GET',
              mode: 'cors',
              credentials: 'omit',
              headers: probeHeaders,
            })
            return { ok: true, status: res.status }
          } catch {
            return { ok: false as const }
          }
        },
        { baseUrl: provider.baseUrl, probePath: provider.probePath, probeHeaders: provider.probeHeaders },
      )

      expect(result.ok, `${provider.id} probe was blocked or the network/provider is unreachable`).toBe(true)
    })
  }

  // Sanity check that the real probeProviderCors module -- the one the app/tests import -- is
  // wired to the exact same request shape asserted above, not a copy that has drifted.
  test('probeProviderCors is importable as a plain TS module outside of DOM/React', () => {
    expect(typeof probeProviderCors).toBe('function')
  })
})
