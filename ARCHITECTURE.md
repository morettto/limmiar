# Architecture

Monorepo (pnpm workspaces: `apps/*`, `packages/*`) for Limmiar: a .NET API, a React SPA, a public Astro site, and a set of framework-free TypeScript packages shared between them.

## apps

- `apps/api` — .NET solution (`Api.sln`), the backend API. See [apps/api/README.md](./apps/api/README.md).
- `apps/app` — React + TypeScript SPA (Vite), the product's client application. See [apps/app/README.md](./apps/app/README.md).
- `apps/site` — Astro public site (locale-routed). No module README yet.

## packages

- `packages/crypto` — client-side cryptographic primitives (Argon2id, AES-GCM, X25519, BIP39), each wrapped behind a single confined call site. No module README yet.
- `packages/i18n` — locale negotiation, content-locale handling, and Intl-backed formatters. No module README yet.
- `packages/ui` — shared UI primitives. No module README yet.
- `packages/agenda` — time model: IANA time zone validation and RRULE recurrence expansion, pure TypeScript, no UI. See [packages/agenda/README.md](./packages/agenda/README.md).
- `packages/session` — session lifecycle statechart (XState v5, no `invoke`, no audio, no UI), testable in Node. See [packages/session/README.md](./packages/session/README.md).
- `packages/diarization` — pure diarization pipeline: merge (`atribuirLocutores`, ASR words + speaker turns by summed overlap), binary classification (`classificarLocutores`, voice-embedding cosine similarity → `voce`/`paciente`), and canonical pass (`montarTranscricaoCanonica`, collapses labeled words into transcript chunks); zero runtime dependencies. See [packages/diarization/README.md](./packages/diarization/README.md).
