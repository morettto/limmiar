# session

## Responsabilidade

Cifra e escrita persistente dos chunks de PCM de uma sessão de captura ao
vivo, mais o adapter que traduz o mundo real (`MediaRecorder`, ring buffer,
motor de ASR, hardware) para eventos da máquina de `@limmiar/session`, mais
o pipeline de áudio real (tomada B) que alimenta esse ring: um
`AudioWorklet` (`pcm-tap.processor.ts`/`pcm-tap.ts`) e um `TranscriptionEngine`
escolhido por flag de build (`engine-for.ts`), hospedado num Worker
(`asr.worker.ts`). Mesma disciplina de
`patients/patient-crypto.ts`/`copilot/copilot-crypto.ts`: AAD versionada
por contexto, cifra pela primitiva única de `@limmiar/crypto`, nunca
reinventada aqui. Fatia 3 de S05-02 -- cifra + escrita OPFS + adapter
(`live-session.ts`) + store de segmentos (`segment-store.ts`). Fatia 4 --
tap + Worker ASR + motor por flag. `nemotron-engine.ts` e
`SessaoAoVivo.tsx` ficam para fatias seguintes.

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
- **Tomada B -- best-effort, pode dropar.** `AudioWorklet`
  (`pcm-tap.processor.ts`/`pcm-tap.ts`) empurra PCM para o ring de
  `@limmiar/audio`; `runAsrLoop` consome e entrega segmentos a
  `segmentos.acrescentar(...)`, que não produz `SessaoEvento` -- é
  conteúdo, não estado. Ver secção seguinte para o protocolo.

A gravação nunca depende de ASR ter sucesso: se o motor atrasar ou o ring
saturar, a tomada A continua a escrever em disco sem interrupção.

## Tomada B -- tap e motor (`pcm-tap.processor.ts`, `pcm-tap.ts`, `asr.worker.ts`, `engine-for.ts`)

### Tap (`AudioWorklet`)

`ligarTap(stream, ring): Promise<() => void>` (`pcm-tap.ts`, main thread)
monta `new AudioContext({ sampleRate: 16000 }) → createMediaStreamSource →
AudioWorkletNode('pcm-tap', { processorOptions: { sab }, channelCount: 1,
channelCountMode: 'explicit', numberOfOutputs: 0 })`. Resample (16kHz) e
downmix (mono) são nativos do `AudioContext`/`channelCount` -- zero DSP
neste módulo. O nó é um sink zero-output (nunca liga a
`ctx.destination`, ou o microfone voltaria pelas colunas); devolve um
desligar síncrono (`source.disconnect(); node.disconnect(); ctx.close()`).
Rejeita se o browser não tiver `AudioWorklet`/SAB -- best-effort, tratado
pelo chamador.

`PcmTap` (`pcm-tap.processor.ts`, corre na **audio thread**, registada como
`'pcm-tap'`) acumula quanta de 128 frames até `CHUNK_FRAMES` (320ms
@16kHz), aplica `isSilent` sobre o bloco inteiro (não sobre 8ms, que
cortaria consoantes a meio) e `push` no ring se não for silêncio. Zero
`postMessage`, zero alocação por quantum -- o único canal de setup é
`processorOptions.sab` no construtor.

### `live-session` liga e desliga o tap

`ligarSessao` cria `desligarTap = ligarTap(stream, ring).catch(() => () =>
{})` ao arrancar -- uma falha do tap (sem AudioWorklet/SAB, caso comum em
jsdom/CI) nunca bloqueia a sessão, só desativa a tomada B. `encerrar()`
resolve essa promise e chama o desligar antes de parar as faixas do
`stream`.

### Motor (`engine-for.ts` + `asr.worker.ts`)

`engineFor(): TranscriptionEngine` escolhe o motor por
`import.meta.env.VITE_FAKE_ASR` (precedente `router.tsx`,
`VITE_ENABLE_E2E_TEST_ROUTES`): `'true'` devolve `fakeEngine()` local, sem
Worker; qualquer outro valor devolve um proxy sobre um `Worker` dedicado
(`new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module'
})`).

`asr.worker.ts` hospeda hoje um `fakeEngine()` (troca por
`nemotron-engine.ts` numa fatia futura, sem mudar o protocolo) e responde
por `AsrRequest`/`AsrReply`:

```ts
type AsrRequest =
  | { id: number; kind: 'warmup' }
  | { id: number; kind: 'transcribe'; pcm: Float32Array }
  | { id: number; kind: 'close' }
type AsrReply =
  | { id: number; ok: true; segments: TranscriptionSegment[] } // [] em warmup/close
  | { id: number; ok: false; error: string }
```

O proxy em `engine-for.ts` mantém um `Map<id, {resolve, reject}>` de
pendentes e roteia cada `AsrReply` pelo `id` -- necessário porque
`warmup()`/`transcribe()` podem estar em voo ao mesmo tempo (`live-session`
não aguarda o warmup). Dentro do Worker, uma fila serial
(`fila = fila.then(...)`) garante que warmup/transcribe/close no engine
nunca correm em paralelo -- uma sessão ONNX não é reentrante. `worker.onerror`
rejeita todos os pendentes de uma vez.

**Invariante do buffer reutilizado:** `pcm` viaja por structured clone,
nunca por `transfer`. `runAsrLoop` reutiliza o mesmo `Float32Array` em
todas as janelas (`packages/audio/src/asr-loop.ts`); transferi-lo o
destacaria e a janela seguinte chegaria vazia ao motor. Uma cópia de
~100KB por 1.6s de áudio não é o caminho quente -- o caminho quente é o
ring, que nunca atravessa `postMessage`.

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
- `ligarTap(stream, ring): Promise<() => void>` -- monta o `AudioWorklet` e
  devolve o desligar; rejeita se o browser não suportar (`pcm-tap.ts`).
  Classe `PcmTap` registada como `'pcm-tap'` (`pcm-tap.processor.ts`, audio
  thread, sem export -- só efeito de `registerProcessor`).
- `engineFor(): TranscriptionEngine` -- motor por
  `VITE_FAKE_ASR` (`engine-for.ts`).
- `AsrRequest`/`AsrReply` (tipos) -- protocolo do Worker
  (`asr.worker.ts`, corre isolado, sem export de função: side effect de
  `self.onmessage`).

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

**`engineFor()` sem parâmetros**: o único chamador de produção é a UI, e os
testes de `live-session` já injetam `engine` direto -- um `opts` hoje seria
especulativo. Se um segundo chamador vier a precisar de escolher motor por
outra via que não `VITE_FAKE_ASR`, é a hora de adicionar o parâmetro, não
antes.

**Default é sempre o Worker; `VITE_FAKE_ASR=true` é opt-in.** O Worker
hospeda `fakeEngine` hoje, portanto os dois ramos dão o mesmo texto e só
diferem em threading -- o caminho real já é o default, e quando
`nemotron-engine.ts` entrar não há default para inverter.

**`pcm-tap.processor.ts` sem exclusão de cobertura**: a classe só usa
`options.processorOptions` e os globais `AudioWorkletProcessor`/
`registerProcessor`; com `vi.stubGlobal` desses dois + `await import()`, o
`process()` corre em jsdom como função pura sobre `Float32Array` -- não
precisa de `AudioContext` nem de viver fora de `src/**`.
