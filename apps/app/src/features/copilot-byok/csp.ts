// Extension kept explicit: this file is also pulled into tsconfig.node.json's graph (module
// nodenext) because vite.config.ts imports it -- drop the .ts here and SUPPORTED_PROVIDERS
// degrades to `any` under that config, silently. Do not "clean up" this extension.
import { SUPPORTED_PROVIDERS } from './provider-registry.ts'

// connect-src derives from SUPPORTED_PROVIDERS -- the whitelist is never written a second time
// by hand (see public/_headers, kept in sync via csp.test.ts).
//
// ponytail: connect-src 'self' only holds while the .NET API is served from the same origin as
// this app -- shared/api/client.ts takes `baseUrl` as a parameter and no screen wires it to an
// external domain today, so there's no regression. The day the backend gets its own origin, that
// origin has to be added here or every API call gets blocked by the browser.
export const CONTENT_SECURITY_POLICY = `connect-src 'self' ${SUPPORTED_PROVIDERS.map((provider) => provider.baseUrl).join(' ')}; object-src 'none'`
