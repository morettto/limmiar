/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'argon2-import-confined-to-wrapper',
      comment:
        "ADR-S01-01: Argon2id roda em Worker, API não oferece caminho síncrono — nenhum dado. dependency-cruiser resolves at module granularity, not named-import granularity, so it can't forbid the bare sync `argon2id` export directly (both `argon2id` and `argon2idAsync` live in the same '@noble/hashes/argon2' module). What it CAN do is confine every import of that module to this package's single wrapper file, so there is exactly one call site to audit. The named-import guard itself — only `argon2idAsync` may appear, never bare `argon2id` — is enforced by src/argon2id.test.ts, which reads its own source text. NOTE on the `to.path` pattern: with `doNotFollow: { path: 'node_modules' }` set below, dependency-cruiser still records the edge but reports it via the RESOLVED path (e.g. '../../node_modules/.pnpm/@noble+hashes@2.2.0/node_modules/@noble/hashes/argon2.js'), never the bare specifier — so the pattern must match that resolved suffix, not '^@noble/...'.",
      severity: 'error',
      from: {
        path: '^src',
        pathNot: '^src/argon2id\\.ts$',
      },
      to: {
        path: 'node_modules/@noble/hashes/argon2\\.js$',
      },
    },
    {
      name: 'ciphers-aes-import-confined-to-wrapper',
      comment:
        "ADR-S01-02: encrypt/decrypt must never expose a nonce parameter — the only reliable defense against catastrophic GCM nonce reuse is making it inexpressible in the public API. @noble/ciphers' raw gcm() cipher (exported from the 'aes' subpath, alongside ctr/cbc/cfb/ecb/gcmsiv/etc.) DOES take a caller-supplied nonce; only managedNonce(gcm, ...) (used exclusively in src/aes-gcm.ts) generates it internally and keeps it off the API surface. Confining every import of '@noble/ciphers/aes' to that one wrapper file means there is exactly one call site where raw gcm() could be misused, and it's the one this ticket's test suite audits. The 'utils' subpath (hexToBytes, managedNonce, randomBytes, etc.) is intentionally NOT confined here — it has no nonce-unsafe cipher constructor of its own, and test files legitimately need e.g. hexToBytes for KAT fixtures. Same resolved-path note as the argon2 rule above: the pattern matches the path AFTER resolution through node_modules/.pnpm, not the bare '@noble/ciphers/aes.js' specifier — verified by deliberately introducing a forbidden import and confirming this rule actually fires (a bare '^@noble/ciphers/aes' pattern silently never matches anything and would be a no-op).",
      severity: 'error',
      from: {
        path: '^src',
        pathNot: '^src/aes-gcm\\.ts$',
      },
      to: {
        path: 'node_modules/@noble/ciphers/aes\\.js$',
      },
    },
    {
      name: 'curves-x25519-import-confined-to-wrapper',
      comment:
        "Same rationale as the two rules above, applied to the third @noble family member this package uses. @noble/curves/ed25519.js exports several curve APIs (ed25519, ed25519ph, ristretto255, x25519, ...) from one module, so — as with the argon2/ciphers cases — dependency-cruiser can only confine the whole module import, not the specific `x25519` named export; that's fine, since this package only ever needs x25519 from it. Confining every import of that module to this one wrapper file keeps exactly one call site to audit for RFC 7748 conformance. Same resolved-path note as the other two rules: with `doNotFollow: { path: 'node_modules' }` set below, the pattern must match the RESOLVED path through node_modules/.pnpm, not the bare '@noble/curves/...' specifier.",
      severity: 'error',
      from: {
        path: '^src',
        pathNot: '^src/x25519\\.ts$',
      },
      to: {
        path: 'node_modules/@noble/curves/ed25519\\.js$',
      },
    },
    {
      name: 'bip39-import-confined-to-wrapper',
      comment:
        "Same rationale as the three rules above, applied to the fourth primitive this package wraps. '@scure/bip39' exposes its functions from the package root ('.') and each language wordlist from its own subpath ('./wordlists/english.js', etc.) — this package only ever needs the English one. Confining every import of both resolved modules to this one wrapper file keeps exactly one call site to audit for BIP39 conformance (KAT vectors, checksum handling, no-leak guards — see src/bip39.test.ts). Same resolved-path note as the other three rules: with `doNotFollow: { path: 'node_modules' }` set below, the pattern must match the RESOLVED path through node_modules/.pnpm, not the bare '@scure/bip39' specifier.",
      severity: 'error',
      from: {
        path: '^src',
        pathNot: '^src/bip39\\.ts$',
      },
      to: {
        path: 'node_modules/@scure/bip39/(index|wordlists/english)\\.js$',
      },
    },
    {
      name: 'webcrypto-file-forbids-runtime-node-crypto-import',
      comment:
        "src/webcrypto.ts must only ever take a TYPE-ONLY edge to node:crypto (for the CryptoKey/SubtleCrypto webcrypto namespace types) — a VALUE import (e.g. `import { subtle } from 'node:crypto'`) would silently break when this code is bundled for a browser, since the whole point of this module is using the GLOBAL `crypto.subtle` (identical API in Node and browser) instead of a Node-specific import. Verified during implementation by deliberately introducing a value import and confirming this rule fires.",
      severity: 'error',
      from: { path: '^src' },
      to: { path: '^crypto$', dependencyTypesNot: ['type-only'] },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
  },
}
