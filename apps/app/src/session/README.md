# session

## Responsabilidade

Cifra e escrita persistente dos chunks de PCM de uma sessão de captura ao
vivo, mais o adapter que traduz o mundo real (`MediaRecorder`, ring buffer,
motor de ASR, hardware) para eventos da máquina de `@limmiar/session`. Mesma
disciplina de `patients/patient-crypto.ts`/`copilot/copilot-crypto.ts`:
AAD versionada por contexto, cifra pela primitiva única de
`@limmiar/crypto`, nunca reinventada aqui. Esta é a fatia 3 de S05-02 --
cifra + escrita OPFS + adapter (`live-session.ts`) + store de segmentos
(`segment-store.ts`). `pcm-tap.processor.ts`, `asr.worker.ts`,
`engine-for.ts`, `nemotron-engine.ts` e `SessaoAoVivo.tsx` ficam para
fatias seguintes.

## Fluxo -- cifra (`audio-crypto.ts`)

`audioChunkAad(sessionId, seq)` gera a AAD versionada
(`limmiar/audio-chunk/v1|${sessionId}|${seq}`), à imagem de
`patientEntryAad`. `sealChunk(dek, sessionId, seq, chunk)` cifra um chunk
sob essa AAD via `webcrypto.encrypt` de `@limmiar/crypto` -- wire format
`iv(12) || ciphertext || tag(16)`, mesma primitiva usada em todo o resto do
app, não reimplementada.

## Fluxo -- escrita OPFS (`chunk-store.ts`)

1. `opfsWriter(dir: FileSystemDirectoryHandle): WriteSealed` devolve uma
   função que escreve bytes já cifrados num ficheiro nomeado pelo `seq`
   (`getFileHandle(String(seq), { create: true })` ->
   `createWritable()` -> `write()` -> `close()`).
2. `persistChunk(write, dek, sessionId, seq, blob)` compõe `sealChunk` +
   `write`: cifra sempre antes de escrever, `write` nunca recebe `blob` em
   claro.
3. `listarOrfaos(dir)` lista os nomes de ficheiro presentes num diretório
   (`dir.keys()`), para detetar chunks que sobraram de uma sessão anterior
   sem fecho limpo.

### Invariante

`chunk-store.ts` é o único ficheiro autorizado a chamar a API de escrita
OPFS (`createWritable`/`write` de `FileSystemFileHandle`). Nenhum outro
módulo deve chamar `getFileHandle`/`createWritable` diretamente -- quem
precisa de persistir um chunk passa por `persistChunk`.

## Fluxo -- sessão ao vivo (`live-session.ts` + `segment-store.ts`)

`ligarSessao(opcoes): SessaoAoVivo` é o único adapter mundo-real→`SessaoEvento`
da captura ao vivo: traduz `MediaRecorder`, o ring buffer de `@limmiar/audio`,
o `TranscriptionEngine`, hardware (microfone, GPU) e rede em eventos que a
máquina de `@limmiar/session` entende. Síncrono -- devolve o controller já;
`warmup()` e o loop de ASR correm em segundo plano. `criarSegmentStore()`
devolve um `SegmentStore` append-only moldado para `useSyncExternalStore`
(`subscribe`/`getSnapshot`/`acrescentar`), dono é sempre a UI, que o cria
antes de `ligarSessao` existir e o passa por parâmetro.

### Invariante das duas tomadas

O mesmo `MediaStream` alimenta duas tomadas independentes, com garantias
diferentes -- ver ADR-0009 (pendente):

- **Tomada A -- autoritativa, nunca perde.** `MediaRecorder` +
  `persistChunk` (deste módulo) grava cada chunk em OPFS numa fila de
  escrita encadeada (`fila = fila.then(...)`), preservando ordem de `seq`
  mesmo sob escrita concorrente. Sucesso emite `CHUNK_PERSISTIDO`; falha
  (qualquer motivo, sem ramificar por `err.name`) emite `DISCO_CHEIO` com
  `bytesLivres` de `storage.estimate()`.
- **Tomada B -- best-effort, pode dropar.** `AudioWorklet` (fatia 4) empurra
  PCM para o ring de `@limmiar/audio`; `runAsrLoop` consome e entrega
  segmentos a `segmentos.acrescentar(...)`, que não produz `SessaoEvento` --
  é conteúdo, não estado.

A gravação nunca depende de ASR ter sucesso: se o motor atrasar ou o ring
saturar, a tomada A continua a escrever em disco sem interrupção.

### Tabela evento-real → `SessaoEvento`

17 variantes cobertas: 11 saem do adapter (`live-session`), 6 do chamador
(UI / futuros `recovery.ts` e `SessaoAoVivo.tsx`).

| Fonte real | Dono | `SessaoEvento` |
|---|---|---|
| `recorder.ondataavailable` → `persistChunk` resolve | adapter | `CHUNK_PERSISTIDO` |
| `persistChunk` rejeita → `storage.estimate()` | adapter | `DISCO_CHEIO { bytesLivres }` |
| `track.addEventListener('ended')` em cada faixa | adapter | `MICROFONE_REVOGADO` |
| `gpu.lost` resolve | adapter | `GPU_PERDIDA` |
| `engine.warmup()` rejeita | adapter | `GPU_PERDIDA` |
| `engine.warmup()` resolve | adapter | `MODELO_PRONTO` |
| `window` `'offline'` / `'online'` | adapter | `REDE_CAIU` / `REDE_VOLTOU` |
| `document` `'visibilitychange'` (`document.hidden`) | adapter | `DISPOSITIVO_SUSPENSO` |
| `controller.pausar()` / `retomar()` | adapter | `PAUSAR` / `RETOMAR` |
| `controller.encerrar()` | adapter | `ENCERRAR`, depois `FILA_DRENADA` |
| `onSegments` do asr-loop | adapter → `segmentos.acrescentar` | nenhum (conteúdo, não estado) |
| `onStats` do asr-loop | adapter | nenhum (no-op nesta fatia) |
| clique de consentimento | UI | `CONSENTIMENTO_CONCEDIDO` (precede `ligarSessao`) |
| clique de marcar momento | UI | `MARCAR_MOMENTO { offsetMs }` (sem efeito real) |
| botão "tentar de novo" | UI | `TENTAR_NOVAMENTE` + novo `ligarSessao` |
| varrimento de `listarOrfaos` | UI / futuro `recovery.ts` | `RECUPERACAO_CONCLUIDA` / `RECUPERACAO_FALHOU` |
| `montarTranscricaoCanonica` (`@limmiar/diarization`) | UI / futuro `SessaoAoVivo.tsx` | `PASSE_CANONICO_CONCLUIDO` / `PASSE_CANONICO_FALHOU` |

## Pontos de entrada

- `audioChunkAad(sessionId, seq): Uint8Array<ArrayBuffer>`,
  `sealChunk(dek, sessionId, seq, chunk): Promise<Uint8Array<ArrayBuffer>>`
  (`audio-crypto.ts`).
- `WriteSealed` (tipo), `opfsWriter(dir): WriteSealed`,
  `persistChunk(write, dek, sessionId, seq, blob): Promise<void>`,
  `listarOrfaos(dir): Promise<string[]>` (`chunk-store.ts`).
- `ligarSessao(opcoes: LigarSessaoOpcoes): SessaoAoVivo` -- controller com
  `pausar()`, `retomar()`, `encerrar(): Promise<void>` (idempotente, drena
  a fila e emite `FILA_DRENADA`) (`live-session.ts`).
- `SegmentStore` (tipo), `criarSegmentStore(): SegmentStore` --
  `subscribe`/`getSnapshot`/`acrescentar`, contrato `useSyncExternalStore`
  (`segment-store.ts`).

## Decisões relevantes

**Sem mock de OPFS de repositório para reusar**: grepado
`FileSystemDirectoryHandle`/`createWritable`/`getDirectory` em todo o repo
antes de escrever um -- nenhum precedente. O mock (`FakeDirectoryHandle`/
`FakeFileHandle`/`FakeWritable`) fica local a `chunk-store.test.ts`, só com
os métodos que `chunk-store.ts` de facto usa (`getFileHandle`,
`createWritable`, `write`, `close`, `keys`), sem lib nova.

**Nome de ficheiro é só o `seq`, sem `sessionId`**: o diretório passado a
`opfsWriter` já é escopado a uma sessão (quem chama decide o diretório);
`sessionId` continua no parâmetro de `WriteSealed` para a assinatura bater
com o que uma implementação alternativa de `write` (ex.: IndexedDB, fatia
futura) poderia precisar, mesmo `opfsWriter` não o usando no nome do
ficheiro.
