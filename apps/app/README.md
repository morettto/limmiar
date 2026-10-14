# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## E2E (Playwright)

`playwright.config.ts`'s `webServer` boots the real .NET API. Since S11-03, accounts live in
Postgres, so the API needs a real, reachable database on `5432` before `pnpm exec playwright
test` -- run once per machine/session:

```
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=limmiar_e2e postgres:17-alpine
```

The config runs `--migrate-only` against it before starting the app; `AbacatePay__WebhookSecret`
still needs to be set in the environment running Playwright (e.g. `AbacatePay__WebhookSecret=e2e-local`).

## Security headers and bundle budget

`security-headers.ts` is the single source of the response headers; `public/_headers` must repeat its
baseline verbatim (`security-headers.test.ts` checks). The baseline CSP is `default-src 'self'` with
`connect-src 'self'`: `pnpm dev` proxies the API, `/copiloto` and `/speech` (the transcription WebSocket, `tools/nemotron`) to the same origin.
A hosted build (`docs/ambiente-de-teste.md`) names the other origins in `VITE_API_BASE_URL`,
`VITE_COPILOTO_BASE_URL`, `VITE_SPEECH_BASE_URL` and, only if the browser ever calls it, `VITE_JUIZ_BASE_URL`; the build adds each one
and its `ws:`/`wss:` twin to `connect-src` in the `_headers` of the output directory. The e2e iframe origin is added by
`e2e/fixtures/allow-frame-origin.mjs`. The dev server drops
the CSP (React refresh injects inline scripts).

`pnpm build && pnpm check:bundle` fails when the gzip size of the entry JS, the lazy JS or the CSS passes
the ceilings written in `scripts/check-bundle.mjs` (first clean build plus about 5%).
