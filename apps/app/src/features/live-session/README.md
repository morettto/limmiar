# session

## Responsabilidade

Cifra e escrita persistente dos chunks de PCM de uma sessão de captura ao
vivo, mais o adapter que traduz o mundo real (`MediaRecorder`, ring buffer,
motor de ASR, hardware) para eventos da máquina de `@limmiar/session`, mais
o pipeline de áudio real (tomada B) que alimenta esse ring: um
`AudioWorklet` (`pcm-tap.processor.ts`/`pcm-tap.ts`) e um `TranscriptionEngine`
escolhido por flag de build (`engine-for.ts`), hospedado num Worker
(`asr.worker.ts`), mais o carregador que liga esse motor ao reconhecedor
sherpa-onnx/Nemotron real (`nemotron-loader.ts`), mais a porta única para o
microfone (`microfone.ts`, S10-02 fatia 4) que exige consentimento de
gravação concedido antes de o abrir. Mesma disciplina de
`patients/patient-crypto.ts`/`copilot/copilot-crypto.ts`: AAD versionada
por contexto, cifra pela primitiva única de `@limmiar/crypto`, nunca
reinventada aqui. Fatia 3 de S05-02 -- cifra + escrita OPFS + adapter
(`live-session.ts`) + store de segmentos (`segment-store.ts`). Fatia 4 --
tap + Worker ASR + motor por flag. Fatia 6 -- carregador do motor real
(`nemotron-loader.ts`); o Worker passa a hospedar `nemotronEngine` em vez
de `fakeEngine`. S10-02 fatia 4 -- `microfone.ts` passa a ser o único
construtor de `LigarSessaoOpcoes.microfone`, substituindo o antigo campo
`stream: MediaStream`. `SessaoAoVivo.tsx` fica para uma fatia seguinte.

## Fluxo -- cifra (`audio-crypto.ts`)

`audioChunkAad(sessionId, seq)` gera a AAD versionada
(`limmiar/audio-chunk/v1|${sessionId}|${seq}`), à imagem de
`patientEntryAad`. `sealChunk(dek, sessionId, seq, chunk)` cifra um chunk
sob essa AAD via `webcrypto.encrypt` de `@limmiar/crypto` -- wire format
`iv(12) || ciphertext || tag(16)`, mesma primitiva usada em todo o resto do
app, não reimplementada.

`abrirChunk(dek, sessionId, seq, selado)` é o inverso exato (fatia 3, S08-01)
-- `webcrypto.decrypt` sob a mesma AAD. Rejeita se `sessionId`/`seq` não
forem os mesmos usados para selar: é a AAD, não uma checagem extra, que
impede um chunk de outra sessão ou fora de ordem de abrir por bom. Consumido
por `features/nota-audio/reprodutor.ts` (`abrirSessaoComoBlob`), que também
reusa `listarOrfaos` (abaixo) para listar os chunks de uma sessão por `seq`.

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

## Fluxo -- porta do microfone (`microfone.ts`, S10-02 fatia 4)

`abrirMicrofone(consentimentoGravacao, midia = navigator.mediaDevices)` é a
porta única para `getUserMedia` no caminho de captura ao vivo: sem
`consentimentoGravacao === 'concedido'`, devolve
`{ ok: false, motivo: 'consentimento-ausente' }` **sem nunca chamar
`getUserMedia`** -- é o portão do critério de aceite 3 do ticket S10-02, e é
por isso que existe um teste com um spy de zero chamadas. Com consentimento
concedido, chama `midia.getUserMedia({ audio: true })`; qualquer rejeição
(`NotAllowedError` incluído) mapeia para `{ ok: false, motivo:
'permissao-negada' }` -- `ponytail:` o motivo não distingue
`NotAllowedError` de outras falhas (`NotFoundError`, sem hardware, etc.)
porque `AbrirMicrofoneResult` só tem esses dois motivos e nenhum critério de
aceite pede um terceiro; se a UI precisar de os distinguir, é a hora de
acrescentar o motivo e ramificar por `erro.name`. Em sucesso devolve `{ ok:
true, microfone }`, onde `MicrofoneAutorizado` é um tipo com marca nominal
cujo único construtor é esta função -- `LigarSessaoOpcoes.microfone` (abaixo)
só aceita o que `abrirMicrofone` devolveu, e montar o objeto à mão não compila.

### Prova em browser real (S10-02 fatia 6)

O teste de `microfone.test.ts` acima corre em jsdom, com um `getUserMedia` falso -- prova a
lógica, não que um browser de verdade se comporta assim. `e2e/consentimento-microfone.spec.ts`
fecha essa lacuna: Chromium real, lançado com `--use-fake-device-for-media-stream` (microfone
falso sempre disponível) e `permissions: ['microphone']` já concedida ao contexto -- ou seja, o
browser abriria o microfone se lhe fosse pedido. Navega para o andaime `/e2e/microfone?
consentimento=revogado` (`app/routing/router.tsx`, atrás de `VITE_ENABLE_E2E_TEST_ROUTES`,
mesmo precedente de `/devices/pair-primary`), clica "Gravar" e confirma que aparece o `role=alert`
com `'consentimento-ausente'` -- nunca o `role=status` de sucesso. Prova que o guard cedo de
`abrirMicrofone` é real: se alguém o remover, este teste passa a abrir o microfone de verdade e
falha. O andaime em si não é produção (ver o README de `entities/consentimento` e o comentário
no próprio `router.tsx`); o ida-e-volta ao servidor (registar/obter consentimento) é provado
pelas fatias 3 e 4, não por este spec.

### Invariante -- só `microfone.ts` chama `getUserMedia`

`microfone.ts` é o único ficheiro do caminho de captura ao vivo autorizado a
chamar `navigator.mediaDevices.getUserMedia`. Mesmo precedente da invariante
de `chunk-store.ts` sobre a escrita OPFS (acima): documentada, sem lint a
impor -- sobe a lint se um segundo módulo deste caminho lhe tocar. **Não
cobre `features/qr-scan/qr-decode.ts`**, que já chamava `getUserMedia`
diretamente antes deste ticket (câmara para leitura de QR, não microfone) --
essa chamada é anterior a esta invariante e fora do âmbito de S10-02.

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

## Tomada B -- tap e motor (`pcm-tap.processor.ts`, `pcm-tap.ts`, `asr.worker.ts`, `engine-for.ts`, `nemotron-loader.ts`)

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

`asr.worker.ts` hospeda `nemotronEngine(carregarReconhecedor(importarGlue))`
(`@limmiar/audio` + `nemotron-loader.ts`, fatia 6 -- trocou `fakeEngine()`
sem mudar o protocolo) e responde por `AsrRequest`/`AsrReply`:

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

### Carregador do motor real (`nemotron-loader.ts`)

`carregarReconhecedor(importarGlue): Promise<AsrRecognizer>` é o único dono
do acoplamento à plataforma do ASR real -- corre dentro do Worker de ASR
(`asr.worker.ts:15`), não na main thread, logo o download de centenas de MB
nunca bloqueia a UI nem a tomada A.

1. `base = import.meta.env.VITE_ASR_MODEL_BASE_URL ?? '/models/'`. Dev:
   `/models/` -- `public/models/` gitignored, servido por `vite dev`.
   Produção: aponta para um object store externo (bucket com CORS +
   `Cross-Origin-Resource-Policy: cross-origin`, obrigatório sob COEP
   `credentialless`), porque `apps/app/wrangler.jsonc` serve `dist/` como
   assets de Cloudflare Worker com limite de **25 MiB por ficheiro** e os
   artefactos pesam **682 MB**.
2. `glue = await importarGlue(base + 'sherpa-onnx-wasm-main-asr.mjs')` --
   o glue ESM (`-sMODULARIZE=1 -sEXPORT_ES6=1`) da nossa build Emscripten do
   sherpa-onnx.
3. `mod = await glue.default({ locateFile: (f) => base + f })` -- o
   Emscripten faz `fetch` do `.wasm` e do `.data` sozinho.
4. `mod.createOnlineRecognizer(mod, CONFIG)` já é um `AsrRecognizer` de
   `@limmiar/audio` -- zero adapter.

**MEMFS, não `fetch` nosso.** `encoder.onnx`/`decoder.onnx`/`joiner.onnx`/
`tokens.txt` não são pedidos por este ficheiro: o `--preload-file` da build
empacota-os num único `sherpa-onnx-wasm-main-asr.data` que o Emscripten
descarrega para MEMFS sozinho a partir do `locateFile`. Por isso as paths
em `CONFIG` (`./encoder.onnx`, …) são paths MEMFS, não URLs -- escrever um
`fetch` + `FS.writeFile` por cima disso dobraria o pico de memória (682 MB
em JS mais 682 MB no heap WASM) para ganhar zero.

**Protocolo de erro.** Qualquer rejeição nos passos 2-4 (404, CORS, DNS,
WASM inválido, OOM) vira `throw new Error(\`ASR: falhou a carregar de
${base} — ${causa}\`, { cause: erro })`, `causa` sendo `erro.message` se
`erro instanceof Error`, senão `String(erro)` -- mesmo padrão de
`asr.worker.ts:36`. Essa mensagem atravessa intacta `AsrReply.error` →
`new Error(reply.error)` em `engine-for.ts` → devtools; o controlo de fluxo
usa `GPU_PERDIDA` (sem evento novo), só o texto é que nomeia a causa real.

**Tetos conhecidos, sem upgrade nesta fatia:**
- `// ponytail: carga não é cancelável; sem timeout/AbortController/retry -- close() não interrompe um download em curso, só terminate() do Worker o leva atrás. 682 MB numa ligação lenta demoram legitimamente minutos; um timeout partia utilizadores reais para apanhar um caso que o utilizador já resolve fechando a sessão.`
- `numThreads: 1` -- o build WASM oficial não passa `-pthread`. Se o RTF
  ficar acima de 1 no soak, o primeiro botão é rebuildar com
  `-pthread -sPTHREAD_POOL_SIZE=N` (COOP/COEP já servidas em
  `public/_headers`, `SharedArrayBuffer` já funciona).
- `CONFIG` é fixo no código (não injetável): `modelType:'nemotron'`,
  `featureDim:128`, `decodingMethod:'greedy_search'`, `provider:'cpu'` são
  todos confirmados em fonte e nenhum varia entre ambientes ou por
  utilizador.

**Limite conhecido de prova:** os testes deste ficheiro provam o
protocolo (URL, `locateFile`, `CONFIG`, forma do erro) com um
`importarGlue` falso em jsdom -- nenhum prova que o sherpa-onnx real
arranca com este `CONFIG`. A primeira prova real é manual: artefactos
gerados, `pnpm dev`, um microfone -- mesmo estado em que `pcm-tap.ts` já
vive.

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
  `sealChunk(dek, sessionId, seq, chunk): Promise<Uint8Array<ArrayBuffer>>`,
  `abrirChunk(dek, sessionId, seq, selado): Promise<Uint8Array<ArrayBuffer>>`
  (`audio-crypto.ts`).
- `WriteSealed` (tipo), `opfsWriter(dir): WriteSealed`,
  `persistChunk(write, dek, sessionId, seq, blob): Promise<void>`,
  `listarOrfaos(dir): Promise<string[]>` (`chunk-store.ts`).
- `abrirMicrofone(consentimentoGravacao: EstadoConsentimento, midia?: MediaDevices): Promise<AbrirMicrofoneResult>`
  -- porta única para `getUserMedia`; `MicrofoneAutorizado` (tipo, construtor
  único é esta função), `AbrirMicrofoneResult` (`microfone.ts`, S10-02 fatia 4).
- `ligarSessao(opcoes: LigarSessaoOpcoes): SessaoAoVivo` -- controller com
  `pausar()`, `retomar()`, `encerrar(): Promise<void>` (idempotente, drena
  a fila e emite `FILA_DRENADA`) (`live-session.ts`). `opcoes.microfone:
  MicrofoneAutorizado` (S10-02 fatia 4, substitui o antigo `stream:
  MediaStream`) -- só `abrirMicrofone` o constrói, o que transforma "quem
  liga a sessão tem de se lembrar do consentimento" em erro de compilação.
  O que torna isto verdade e não convenção é a marca nominal (um `unique
  symbol` não exportado no campo da interface): sem ela, a tipagem estrutural
  do TypeScript aceitaria qualquer `{ stream }` montado à mão.
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
- `carregarReconhecedor(importarGlue: ImportarGlue): Promise<AsrRecognizer>`
  -- glue Emscripten + config do reconhecedor Nemotron; `ImportarGlue`/
  `GlueSherpa` (tipos, seam de plataforma) (`nemotron-loader.ts`).

## Decisões relevantes

**Sem mock de OPFS de repositório para reusar**: grepado
`FileSystemDirectoryHandle`/`createWritable`/`getDirectory` em todo o repo
antes de escrever um -- nenhum precedente. O mock (`FakeDirectoryHandle`/
`FakeFileHandle`/`FakeWritable`) começou local a `chunk-store.test.ts`, só com
os métodos que `chunk-store.ts` de facto usa (`getFileHandle`,
`createWritable`, `write`, `close`, `keys`), sem lib nova. Desde S08-02
(terceira duplicação -- `reprodutor.test.ts` já tinha duplicado uma vez, e
`indice-store.test.ts` de `features/nota-biblioteca` precisava dos dois
lados, leitura e escrita) vive em `apps/app/src/test-support/fake-opfs.ts`;
`chunk-store.test.ts` importa de lá em vez de o redeclarar. `handle.bytes`
só fica visível depois de `close()` -- espelha a API real e substitui o
antigo campo `writable.closed`.

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
hospeda o motor real (`nemotronEngine` sobre `nemotron-loader.ts`, fatia 6)
-- `VITE_FAKE_ASR=true` é o único jeito de continuar a testar/desenvolver
sem artefactos `.wasm`/`.data` disponíveis.

**`importarGlue` é parâmetro de `carregarReconhecedor`, não configuração
(decisão 6 do desenho da fatia 6).** `import(/* @vite-ignore */ url)` com
URL só conhecida em runtime não é intercetável por `vi.mock` e cairia sob
`perFile: 100` de `vite.config.ts` sem exclusão de cobertura. Com o seam,
`nemotron-loader.ts` fica 100% testável em jsdom sem `.wasm`; a única linha
de plataforma (`(url) => import(url)`) fica em `asr.worker.ts:15`, onde um
teste a executa contra uma URL inexistente só para provar que corre.
Mesmo padrão de `WriteSealed` em `chunk-store.ts` e de
`engine`/`storage`/`gpu` em `live-session.ts`.

**`pcm-tap.processor.ts` sem exclusão de cobertura**: a classe só usa
`options.processorOptions` e os globais `AudioWorkletProcessor`/
`registerProcessor`; com `vi.stubGlobal` desses dois + `await import()`, o
`process()` corre em jsdom como função pura sobre `Float32Array` -- não
precisa de `AudioContext` nem de viver fora de `src/**`.
