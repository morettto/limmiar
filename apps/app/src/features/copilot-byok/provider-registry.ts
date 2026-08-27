// Provider list is fixed and small (MVP: 3 fornecedores) -- a plain array literal is enough,
// no registry/factory abstraction for something that never grows at runtime.

export interface AiProvider {
  id: 'openai' | 'anthropic' | 'gemini'
  label: string
  baseUrl: string
  /** GET path probed for CORS reachability (cors-probe.ts) -- never used to send the API key. */
  probePath: string
  /** Extra headers the probe request must carry -- Anthropic requires 'anthropic-version' plus
   * 'anthropic-dangerous-direct-browser-access' for its CORS preflight to answer '*' at all;
   * empirically verified (see S07-01 ticket), not documented behavior to rely on blindly. */
  probeHeaders: Readonly<Record<string, string>>
}

export const SUPPORTED_PROVIDERS: readonly AiProvider[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    probePath: '/v1/models',
    probeHeaders: {},
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    probePath: '/v1/models?limit=1',
    probeHeaders: {
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
  },
  {
    id: 'gemini',
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    probePath: '/v1beta/models',
    probeHeaders: {},
  },
]
