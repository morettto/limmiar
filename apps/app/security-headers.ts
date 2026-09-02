// Extension kept explicit: this file is also pulled into tsconfig.node.json's graph (module
// nodenext) because vite.config.ts imports it -- drop the .ts here and SUPPORTED_PROVIDERS
// degrades to `any` under that config, silently. Do not "clean up" this extension.
import { SUPPORTED_PROVIDERS } from './src/features/copilot-byok/provider-registry.ts'

// connect-src derives from SUPPORTED_PROVIDERS, so the whitelist is never written twice by hand.
// ponytail: `'self'` only holds while the .NET API shares this origin — the day it gets its own,
// it has to be added here. The other directives stay out on purpose (ZAP 10055, see .zap/rules.tsv).
const CONTENT_SECURITY_POLICY = `connect-src 'self' ${SUPPORTED_PROVIDERS.map((provider) => provider.baseUrl).join(' ')}; object-src 'none'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'`

// Build-layer policy: this file sits at the app root, not inside src/features/copilot-byok. Only the
// connect-src whitelist is data owned by that slice; which headers and directives to send is
// app-wide and has nothing to do with BYOK.
export const SECURITY_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
} as const
