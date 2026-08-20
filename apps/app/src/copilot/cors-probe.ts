import type { AiProvider } from './provider-registry'

export type CorsProbeResult = { ok: true; status: number } | { ok: false; reason: 'blocked' }

/**
 * Probes whether `provider`'s API answers cross-origin requests from this browser at all --
 * never sends the profissional's API key, just a bare GET to a documented, unauthenticated-safe
 * path (see provider-registry.ts's per-provider comment on why each probePath/probeHeaders pair
 * is what it is). `credentials: 'omit'` is required: a wildcard `Access-Control-Allow-Origin: '*'`
 * combined with credentials on the request is itself rejected by the browser.
 *
 * A `fetch` rejection is always classified as `{ ok: false, reason: 'blocked' }` -- both "CORS
 * blocked it" and "network/DNS failure" surface to `fetch` as the same opaque TypeError, and this
 * MVP has no way (nor real need) to tell them apart client-side.
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
