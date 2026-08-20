import { describe, expect, it } from 'vitest'
import { SUPPORTED_PROVIDERS } from './provider-registry'

describe('SUPPORTED_PROVIDERS', () => {
  it('lists exactly the 3 supported provider ids', () => {
    expect(SUPPORTED_PROVIDERS.map((provider) => provider.id)).toEqual(['openai', 'anthropic', 'gemini'])
  })

  it('every provider has every field populated', () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      expect(provider.label).toBeTruthy()
      expect(provider.baseUrl).toMatch(/^https:\/\//)
      expect(provider.probePath.startsWith('/')).toBe(true)
      expect(provider.probeHeaders).toBeDefined()
    }
  })

  it("anthropic carries the anthropic-dangerous-direct-browser-access probe header", () => {
    const anthropic = SUPPORTED_PROVIDERS.find((provider) => provider.id === 'anthropic')
    expect(anthropic?.probeHeaders['anthropic-dangerous-direct-browser-access']).toBe('true')
  })
})
