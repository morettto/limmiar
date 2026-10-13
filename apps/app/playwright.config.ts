import { defineConfig, devices } from '@playwright/test'

// A API real usa uma porta diferente do wrangler (8787). Portas configuráveis permitem
// rodar os E2E ao lado do `pnpm dev`, que ocupa 5259 e 5432.
export const API_BASE_URL = `http://127.0.0.1:${process.env.E2E_API_PORTA ?? '5259'}`
const PG_PORTA = process.env.E2E_PG_PORTA ?? '5432'

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
      // and VITE_API_BASE_URL puts the API's other origin in the CSP (security-headers.ts).
      command: `pnpm run build:e2e && node e2e/fixtures/allow-frame-origin.mjs http://127.0.0.1:5333 && pnpm exec wrangler dev --port 8787 --local-protocol http --assets dist-e2e`,
      url: 'http://127.0.0.1:8787',
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        VITE_ENABLE_E2E_TEST_ROUTES: 'true',
        // O host da API entra como constante de build (router.tsx, S18-17), não pela query
        // string: sem isto /auth/magic-link falaria sempre com API_BASE_URL === ''.
        VITE_API_BASE_URL: API_BASE_URL,
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
      // Development environment. Accounts moved into Postgres (S11-03): migrations run first,
      // against a real Postgres this suite expects on 5432 (see apps/app/README.md).
      command:
        'dotnet run --no-launch-profile --project ../api/src/Api/Api.csproj -- --migrate-only && ' +
        'dotnet run --no-launch-profile --project ../api/src/Api/Api.csproj',
      // /health/db, not the plain liveness probe -- the readiness signal that migrations have
      // actually finished, now that a real Postgres backs ConnectionStrings:AppDb.
      url: `${API_BASE_URL}/health/db`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ASPNETCORE_URLS: API_BASE_URL,
        ConnectionStrings__AdminDb: `Host=127.0.0.1;Port=${PG_PORTA};Database=limmiar_e2e;Username=postgres;Password=postgres`,
        ConnectionStrings__AppDb: `Host=127.0.0.1;Port=${PG_PORTA};Database=limmiar_e2e;Username=app_role;Password=limmiar_e2e`,
        StaffAccess__ApiKey: 'e2e-unused-staff-key',
        AbacatePay__WebhookSecret: 'e2e-unused-webhook-secret',
        // AES-256-GCM key for accounts.totp_secret_encrypted (S11-03, endurecimento) -- base64
        // of 32 bytes, fixed test value like every other E2E-only secret on this list.
        Totp__EncryptionKey: 'VFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFQ=',
        // WebAuthn is BuildApp's third fail-fast requirement, so every run through this
        // webServer needs both values. RelyingPartyId is "localhost", not 127.0.0.1:
        // Chromium rejects an IP literal as an RP ID at credentials.create().
        WebAuthn__RelyingPartyId: 'localhost',
        WebAuthn__ExpectedOrigin: 'http://localhost:8787',
        DevicePairing__SessionLifetimeSeconds: '8',
        // Every spec calls /auth/* from the same loopback IP, far past the per-IP production limit.
        RateLimiting__Disabled: 'true',
        // CORS locked to the two wrangler dev origins this suite calls from: most specs
        // use 127.0.0.1:8787; the passkey ceremony (magic-link-login.spec.ts, the registrarPaciente
        // fixture) uses localhost:8787 (see the WebAuthn note above). Same server, either hostname.
        Cors__AllowedOrigins__0: 'http://127.0.0.1:8787',
        Cors__AllowedOrigins__1: 'http://localhost:8787',
      },
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
