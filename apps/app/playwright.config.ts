import { defineConfig, devices } from '@playwright/test'

// device-pairing.spec.ts (S02-04 slice 7) is the first E2E spec that needs a real, running
// instance of the .NET API rather than just the static frontend -- see that file's own doc
// comment for the full rationale. This is a plain, fixed port (not baseURL's 127.0.0.1:8787,
// which wrangler already owns) that the spec file also hardcodes as API_BASE_URL.
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
      // VITE_ENABLE_E2E_TEST_ROUTES: router.tsx gates the /devices/pair-primary and
      // /devices/pair-new test-only routes behind this flag so they never ship in a real
      // production build -- see that file's own doc comment. Only this E2E build sets it.
      //
      // This build writes to dist-e2e/, not dist/ -- wrangler.jsonc's `assets.directory` is
      // ./dist, the exact path `wrangler deploy` publishes (deploy.yml). Routes gated by this
      // flag accept a raw accessToken/KEK in the query string; if this build ever landed in
      // dist/, deploy.yml running its own build afterwards would (today) overwrite it before
      // publish, but that's an ordering accident, not a guarantee. `--assets dist-e2e` below
      // points this wrangler dev at the isolated directory instead, so dist/ is never written
      // by this variant at all -- confirmed `wrangler dev --assets <dir>` overrides
      // wrangler.jsonc's configured directory (wrangler 4.118.0).
      // allow-api-origin.mjs: build:e2e copia public/_headers para dist-e2e/ e o wrangler dev
      // serve essa CSP, cujo `connect-src 'self'` não cobre a API .NET desta suite -- ela corre
      // noutra porta, logo noutra origem (ver o comentário do próprio ficheiro). O passo corre
      // entre o build e o wrangler, e só altera o artefacto de teste.
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
      // `--no-launch-profile`: Properties/launchSettings.json binds to a fixed port
      // (localhost:5037) and forces ASPNETCORE_ENVIRONMENT=Development when `dotnet run`
      // picks it up by default -- neither is what this E2E process wants (ASPNETCORE_URLS
      // below, Production environment so `MapOpenApi()`'s Development-only gate stays off).
      //
      // ConnectionStrings__AppDb / StaffAccess__ApiKey are BuildApp's two "fail fast if
      // unconfigured" requirements (Program.Composition.cs) -- this repo has no local
      // Postgres/Docker set up for E2E (verified: `NpgsqlSlimDataSourceBuilder.Build()`
      // does not eagerly connect, and nothing this spec exercises touches the database --
      // only `/health/db`, which this spec never calls, would actually need it reachable),
      // so a syntactically valid but unreachable connection string is enough to let the app
      // start; StaffAccess:ApiKey just needs to be non-empty, nothing here calls a
      // staff-only endpoint.
      //
      // DevicePairing__SessionLifetimeSeconds=8: overrides DevicePairingIssuer's normal
      // 2-minute session TTL (see that class's own doc comment) so the "expired QR" test
      // can run for real instead of waiting out the production window. Generous enough
      // (backend round trips in this suite are sub-second) that the other three tests --
      // which share this same process -- are not at risk of hitting it by accident.
      command:
        'dotnet run --no-launch-profile --project ../api/src/Api/Api.csproj',
      // Plain liveness probe (always 200, no DB touched -- see HealthEndpoints.cs), not
      // /health/db: this E2E has no real Postgres behind ConnectionStrings:AppDb (see
      // below), so /health/db would never turn healthy and Playwright would wait out its
      // full timeout every run.
      url: `${API_BASE_URL}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ASPNETCORE_URLS: API_BASE_URL,
        ConnectionStrings__AppDb: 'Host=127.0.0.1;Port=5432;Database=limmiar_e2e;Username=limmiar_e2e;Password=limmiar_e2e',
        StaffAccess__ApiKey: 'e2e-unused-staff-key',
        // WebAuthn:RelyingPartyId / WebAuthn:ExpectedOrigin (S02-05): BuildApp's third
        // "fail fast if unconfigured" requirement (Program.Composition.cs), added after
        // ConnectionStrings:AppDb/StaffAccess:ApiKey above -- every E2E run through this
        // webServer needs both set or the process never starts, not just magic-link-login.spec.ts
        // (the only spec that actually exercises a WebAuthn ceremony).
        // RelyingPartyId is "localhost", not wrangler's usual 127.0.0.1 dev origin above --
        // confirmed empirically (Chromium rejects it at `navigator.credentials.create()` with
        // "SecurityError: This is an invalid domain."): a real browser's WebAuthn effective-
        // domain algorithm treats IP-literal hosts as never a valid RP ID, even as an exact
        // match against the page's own origin, unlike the server-side-only relying-party-id
        // checks this repo's own tests (e.g. AuthEndpointsTests' "limmiar.test") get away
        // with. wrangler dev's default bind also answers on "localhost" (same loopback
        // interface as 127.0.0.1) -- magic-link-login.spec.ts overrides its own `baseURL` to
        // `http://localhost:8787` to match.
        WebAuthn__RelyingPartyId: 'localhost',
        WebAuthn__ExpectedOrigin: 'http://localhost:8787',
        DevicePairing__SessionLifetimeSeconds: '8',
        // MagicLink:TestCaptureEndpoint=true (S02-05, E2E only): swaps IMagicLinkEmailSender
        // for CapturingMagicLinkEmailSender and maps GET /auth/magic-link/_debug-last -- see
        // Program.Composition.cs's own doc comment on that flag. There is no real e-mail
        // infrastructure this suite could otherwise read a "sent" magic link from.
        MagicLink__TestCaptureEndpoint: 'true',
        // MagicLink:TokenLifetimeSeconds=8: same precedent/value as
        // DevicePairing__SessionLifetimeSeconds above -- overrides MagicLinkIssuer's normal
        // 15-minute token TTL (see that class's own doc comment) so the "expired magic link"
        // test can run for real instead of waiting out the production window.
        MagicLink__TokenLifetimeSeconds: '8',
        // Locks CORS down to exactly the wrangler dev origins this suite calls from --
        // Program.Composition.cs's default policy allows nothing unless configured. Two
        // entries, not one: device-pairing.spec.ts (and every other existing E2E spec) calls
        // from http://127.0.0.1:8787 (playwright.config.ts's own `use.baseURL` above);
        // magic-link-login.spec.ts calls from http://localhost:8787 instead (see
        // WebAuthn:RelyingPartyId's own doc comment on why) -- both are the exact same
        // wrangler dev server, reachable on either loopback hostname.
        Cors__AllowedOrigins__0: 'http://127.0.0.1:8787',
        Cors__AllowedOrigins__1: 'http://localhost:8787',
      },
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
