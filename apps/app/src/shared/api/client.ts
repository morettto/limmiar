export type HealthDbResult = { ok: true } | { ok: false; code: string; params: Record<string, string> }

export type ProblemResult = { ok: false; code: string; params: Record<string, string> }

async function readProblem(response: Response): Promise<ProblemResult> {
  const problem = (await response.json()) as { code: string; params: Record<string, string> }
  return { ok: false, code: problem.code, params: problem.params }
}

// The one place every endpoint (here, and in the entity-level api modules that import it)
// sends a request through: builds the URL, attaches JSON headers + the bearer token for
// POST, maps a non-2xx response to a ProblemResult via readProblem. Collapses what used to
// be ~300 lines of the same fetch+parse+error-map skeleton repeated once per endpoint.
// Callers that need the response body still parse it themselves (via
// `result.response.json()`), since which fields to pull -- and whether there is a body to
// parse at all -- differs per endpoint.
export async function request(
  baseUrl: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  accessToken?: string,
): Promise<{ ok: true; response: Response } | ProblemResult> {
  const response = await sendRequest(baseUrl, method, path, body, accessToken)
  if (!response.ok) {
    return readProblem(response)
  }
  return { ok: true, response }
}

async function sendRequest(
  baseUrl: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  accessToken?: string,
): Promise<Response> {
  if (method === 'GET') {
    if (accessToken === undefined) {
      return fetch(`${baseUrl}${path}`)
    }
    return fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } })
  }

  const headers: Record<string, string> = {}
  if (accessToken !== undefined) {
    headers.Authorization = `Bearer ${accessToken}`
  }
  if (method === 'DELETE') {
    return fetch(`${baseUrl}${path}`, { method, headers })
  }
  headers['Content-Type'] = 'application/json'
  return fetch(`${baseUrl}${path}`, { method, headers, body: JSON.stringify(body) })
}

export async function getHealthDb(baseUrl: string): Promise<HealthDbResult> {
  const result = await request(baseUrl, 'GET', '/health/db')
  if (!result.ok) {
    return result
  }
  return { ok: true }
}
