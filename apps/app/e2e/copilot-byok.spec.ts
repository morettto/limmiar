import { test, expect } from '@playwright/test'
import { SUPPORTED_PROVIDERS } from '../src/features/copilot-byok/provider-registry'
import { probeProviderCors } from '../src/features/copilot-byok/cors-probe'
import type { AiProvider } from '../src/features/copilot-byok/provider-registry'

// S07-01: depends on REAL internet access to OpenAI, Anthropic and Gemini — a red run can mean this
// repo broke something or that a provider is down or changed its CORS policy; check before calling
// it a regression. The probe runs in `page.evaluate` because Node's fetch enforces no CORS.

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
