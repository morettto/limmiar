export type HealthDbResult = { ok: true } | { ok: false; code: string; params: Record<string, string> }

// GET /health/db on the .NET API: 200 with an empty body when the database
// is reachable; a non-2xx `application/problem+json` body (RFC 9457) with a
// machine-readable `code` + `params` otherwise. Deliberately minimal — this
// is the only HTTP call in the app so far, no shared client/retry layer to
// fit into.
export async function getHealthDb(baseUrl: string): Promise<HealthDbResult> {
  const response = await fetch(`${baseUrl}/health/db`)

  if (response.ok) {
    return { ok: true }
  }

  const problem = (await response.json()) as { code: string; params: Record<string, string> }
  return { ok: false, code: problem.code, params: problem.params }
}
