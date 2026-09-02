import { defineConfig, devices } from '@playwright/test'

// device-pairing.spec.ts is the first E2E spec that needs the real .NET API, not just
// the static frontend. Fixed port (not baseURL's 127.0.0.1:8787, which wrangler owns),
// hardcoded as API_BASE_URL in that spec too.
export const API_BASE_URL = 'http://127.0.0.1:5259'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8787',
  },
  webServer: [
    {
      // VITE_ENABLE_E2E_TEST_ROUTES gates the pairing test-only routes (router.tsx).
      // This build writes to dist-e2e/, so it can never land in the deployed dist/,
      // and allow-api-origin.mjs widens the copied CSP to the API's other origin.
      command: `pnpm run build:e2e && node e2e/fixtures/allow-api-origin.mjs ${API_BASE_URL} && pnpm exec wrangler dev --port 8787 --local-protocol http --assets dist-e2e`,
      url: 'http://127.0.0.1:8787',
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        VITE_ENABLE_E2E_TEST_ROUTES: 'true',
      },
    },
    {
      command: 'node e2e/fixtures/serve-third-party.mjs',
      url: 'http://127.0.0.1:5333',
      reuseExistingServer: false,
      timeout: 10_000,
    },
    {
      // `--no-launch-profile`: launchSettings.json would pin its own port and force the
      // Development environment. The `__` settings below satisfy BuildApp's fail-fast
      // requirements (no local Postgres here) and shorten the TTLs the expiry tests need.
      command:
        'dotnet run --no-launch-profile --project ../api/src/Api/Api.csproj',
      // Plain liveness probe, not /health/db: this suite has no real Postgres behind
      // ConnectionStrings:AppDb, so /health/db would never turn healthy and Playwright
      // would wait out its full timeout every run.
      url: `${API_BASE_URL}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ASPNETCORE_URLS: API_BASE_URL,
        ConnectionStrings__AppDb: 'Host=127.0.0.1;Port=5432;Database=limmiar_e2e;Username=limmiar_e2e;Password=limmiar_e2e',
        StaffAccess__ApiKey: 'e2e-unused-staff-key',
        // WebAuthn is BuildApp's third fail-fast requirement, so every run through this
        // webServer needs both values. RelyingPartyId is "localhost", not 127.0.0.1:
        // Chromium rejects an IP literal as an RP ID at credentials.create().
        WebAuthn__RelyingPartyId: 'localhost',
        WebAuthn__ExpectedOrigin: 'http://localhost:8787',
        DevicePairing__SessionLifetimeSeconds: '8',
        // MagicLink:TestCaptureEndpoint (E2E only) swaps in CapturingMagicLinkEmailSender
        // and maps GET /auth/magic-link/_debug-last — there is no real e-mail
        // infrastructure this suite could read a sent link from.
        MagicLink__TestCaptureEndpoint: 'true',
        // Overrides MagicLinkIssuer's 15-minute TTL so the "expired magic link" test runs
        // for real instead of waiting out the production window (same precedent and value
        // as DevicePairing__SessionLifetimeSeconds above).
        MagicLink__TokenLifetimeSeconds: '8',
        // CORS locked to the two wrangler dev origins this suite calls from: most specs
        // use 127.0.0.1:8787, magic-link-login.spec.ts uses localhost:8787 (see the
        // WebAuthn note above). Same server, either loopback hostname.
        Cors__AllowedOrigins__0: 'http://127.0.0.1:8787',
        Cors__AllowedOrigins__1: 'http://localhost:8787',
      },
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
