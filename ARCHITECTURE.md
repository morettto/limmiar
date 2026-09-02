# Architecture

Monorepo (pnpm workspaces: `apps/*`, `packages/*`) for Limmiar: a .NET API, a React SPA, a public Astro site, and a set of framework-free TypeScript packages shared between them.

## apps

- `apps/api` — .NET solution (`Api.sln`), the backend API. See [apps/api/README.md](./apps/api/README.md), which itemizes each vertical slice, including `src/Api/Features/Consent` (S10-02: append-only consent-by-purpose log, `Gravacao`/`AnaliseIa`, revocation as `INSERT` never `UPDATE`/`DELETE`).
- `apps/app` — React + TypeScript SPA (Vite), the product's client application. See [apps/app/README.md](./apps/app/README.md).
- `apps/site` — Astro public site (locale-routed). No module README yet.

## packages

- `packages/crypto` — client-side cryptographic primitives (Argon2id, AES-GCM, X25519, BIP39), each wrapped behind a single confined call site. No module README yet.
- `packages/i18n` — locale negotiation, content-locale handling, and Intl-backed formatters. No module README yet.
- `packages/ui` — shared UI primitives. No module README yet.
- `packages/agenda` — time model: IANA time zone validation and RRULE recurrence expansion, pure TypeScript, no UI. See [packages/agenda/README.md](./packages/agenda/README.md).
- `packages/session` — session lifecycle statechart (XState v5, no `invoke`, no audio, no UI), testable in Node. See [packages/session/README.md](./packages/session/README.md). The real-world adapter that feeds it events lives outside the package, in [apps/app/src/features/live-session/live-session.ts](./apps/app/src/features/live-session/live-session.ts) (moved there by the FSD refactor, PR #9 — this pointer used to read `apps/app/src/session/live-session.ts`, a path that no longer exists). That same directory also holds `microfone.ts` (S10-02 fatia 4), the sole caller of `getUserMedia` in the live-capture path: it refuses to open the microphone unless the recording-purpose consent read from [apps/app/src/entities/consentimento](./apps/app/src/entities/consentimento) is `'concedido'`, gating the statechart's `temConsentimento` guard from the outside.
- `packages/diarization` — pure diarization pipeline: merge (`atribuirLocutores`, ASR words + speaker turns by summed overlap), binary classification (`classificarLocutores`, voice-embedding cosine similarity → `voce`/`paciente`), and canonical pass (`montarTranscricaoCanonica`, collapses labeled words into transcript chunks); zero runtime dependencies. See [packages/diarization/README.md](./packages/diarization/README.md).
- `packages/audio` — pure, Node-testable audio core: a `SharedArrayBuffer` ring buffer (`createRingSab`/`attachRing`/`push`/`pull`/`waitFor`) for the AudioWorklet-to-ASR-worker hot path, a silence gate (`rms`/`isSilent`), the `TranscriptionEngine` contract plus a deterministic `fakeEngine` test double, the real ASR engine over a structural streaming recognizer (`nemotronEngine`, in [packages/audio/src/nemotron-engine.ts](./packages/audio/src/nemotron-engine.ts)), and the consuming loop (`runAsrLoop`, reports `rtf`/`droppedFrames`/`windows`); zero runtime dependencies. The recognizer loader (fetch of the WASM/ONNX artifacts, the Emscripten `Module`) is browser code and lives in `apps/app`, at [apps/app/src/features/live-session/nemotron-loader.ts](./apps/app/src/features/live-session/nemotron-loader.ts) (moved there by the FSD refactor, PR #9 — this pointer used to read `apps/app/src/session/nemotron-loader.ts`, a path that no longer exists). See [packages/audio/README.md](./packages/audio/README.md).
- `packages/copilot` — AI copilot draft entity (spec S07, BYOK) and its provenance layer: a statechart (`criarMaquinaRascunho`, XState v5, no `invoke`) that only ever keeps draft claims with a temporal anchor into the source audio, plus expiry rules (warn at 23 days, discard at 30). See [packages/copilot/README.md](./packages/copilot/README.md).
