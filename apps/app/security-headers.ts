// Extension kept explicit: this file is also pulled into tsconfig.node.json's graph (module
// nodenext) because vite.config.ts imports it -- drop the .ts here and SUPPORTED_PROVIDERS
// degrades to `any` under that config, silently. Do not "clean up" this extension.
import { SUPPORTED_PROVIDERS } from './src/features/copilot-byok/provider-registry.ts'

// connect-src derives from SUPPORTED_PROVIDERS -- the whitelist is never written a second time
// by hand (see public/_headers, kept in sync via security-headers.test.ts).
//
// ponytail: connect-src 'self' only holds while the .NET API is served from the same origin as
// this app -- shared/api/client.ts takes `baseUrl` as a parameter and no screen wires it to an
// external domain today, so there's no regression. The day the backend gets its own origin, that
// origin has to be added here or every API call gets blocked by the browser.
// frame-ancestors 'none' entrou porque não custa nada -- nada neste app é embutido por
// terceiros, e o COOP same-origin acima já assume isso. As restantes diretivas continuam de
// fora, e é decisão consciente: sem default-src, script-src/style-src/worker-src ficam
// abertas, e fechá-las é trabalho com verificação em browser real (estilos inline do React,
// worker em blob, WebAssembly do ASR), não uma linha nesta string. O ZAP marca isso como
// alerta 10055 -- ver .zap/rules.tsv para o registo de porque está IGNORE.
const CONTENT_SECURITY_POLICY = `connect-src 'self' ${SUPPORTED_PROVIDERS.map((provider) => provider.baseUrl).join(' ')}; object-src 'none'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'`

// Build-layer policy: this file lives at the app root, next to vite.config.ts, not inside
// src/features/copilot-byok. Only the CSP connect-src whitelist is data owned by that BYOK slice
// (SUPPORTED_PROVIDERS); the security-header *policy* itself -- which headers, which directives --
// is app-wide and has nothing to do with BYOK, so it doesn't live inside that feature.
export const SECURITY_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
} as const
