import type { AiProvider } from './provider-registry'

export type CorsProbeResult = { ok: true; status: number } | { ok: false; reason: 'blocked' }

/**
 * Probes whether `provider`'s API answers cross-origin requests at all — never sends the API key,
 * just a bare GET to a documented unauthenticated path. `credentials: 'omit'` is required, since a
 * wildcard CORS header plus credentials is rejected outright.
 */
export async function probeProviderCors(
  provider: AiProvider,
  fetchImpl: typeof fetch = fetch,
): Promise<CorsProbeResult> {
  try {
    const response = await fetchImpl(provider.baseUrl + provider.probePath, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      headers: provider.probeHeaders,
    })
    return { ok: true, status: response.status }
  } catch {
    return { ok: false, reason: 'blocked' }
  }
}
