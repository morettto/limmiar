// connect-src is 'self' unless the build names other hosts (app on Cloudflare; API, copilot and speech service elsewhere).
// Each origin gets its ws:/wss: twin, because http: does not cover WebSockets (the speech service is one).
// The juiz is called by the copilot orchestrator, not the browser: leave its variable unset unless that changes.
export const ORIGIN_VARIABLES = ['VITE_API_BASE_URL', 'VITE_COPILOTO_BASE_URL', 'VITE_SPEECH_BASE_URL', 'VITE_JUIZ_BASE_URL'] as const

type BuildEnv = Readonly<Record<string, string | undefined>>

const BASELINE_CONNECT_SRC = "connect-src 'self'"

export function connectSrc(env: BuildEnv): string {
  const origins = ORIGIN_VARIABLES.flatMap((name) => {
    const value = env[name]
    if (!value) return []
    const { origin } = new URL(value)
    return [origin, origin.replace(/^http/, 'ws')]
  })
  return ["'self'", ...new Set(origins)].join(' ')
}

// public/_headers carries the baseline; the build rewrites its copy in the output directory.
export function withHostedOrigins(headersFile: string, env: BuildEnv): string {
  if (!headersFile.includes(BASELINE_CONNECT_SRC)) throw new Error(`${BASELINE_CONNECT_SRC} not found in _headers`)
  return headersFile.replace(BASELINE_CONNECT_SRC, `connect-src ${connectSrc(env)}`)
}

export function securityHeaders(env: BuildEnv) {
  return {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'X-Content-Type-Options': 'nosniff',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'microphone=(self), camera=(self), geolocation=()',
    // img-src data: is the pairing QR (PairingQr.tsx); media-src blob: is the recorded session audio.
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "worker-src 'self' blob:",
      "media-src blob:",
      "img-src 'self' data:",
      `connect-src ${connectSrc(env)}`,
      "object-src 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  } as const
}

export const SECURITY_HEADERS = securityHeaders({})
