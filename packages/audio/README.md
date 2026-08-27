# @limmiar/audio

## Responsabilidade

Núcleo puro e testável em Node do caminho de áudio: o buffer partilhado que
liga produtor (AudioWorklet) a consumidor (worker de ASR), o gate de
silêncio, o contrato de motor de transcrição, um duplo determinístico desse
contrato para testes, o motor real sobre um reconhecedor streaming
estrutural (`nemotron-engine.ts`), e o loop que consome o buffer em janelas.
Zero dependências de runtime, zero UI, zero WASM/ONNX real — só os seams
puros. O carregador do reconhecedor (`fetch` do `.wasm`/`.onnx`, `Module`
Emscripten) é código de browser e vive em `apps/app`, fatia seguinte de
S05-02.

## Fluxo — ring buffer (`ring-buffer.ts`)

1. `createRingSab(capacityFrames)` aloca um único `SharedArrayBuffer`: um
   cabeçalho `Int32Array(4)` (`writeFrames`, `readFrames`, `droppedFrames`,
   reservado) seguido de um `Float32Array(capacityFrames)` de amostras PCM.
   `capacityFrames` tem de ser potência de 2 — o índice de escrita/leitura é
   uma máscara (`contador & (capacidade - 1)`), não um módulo.
2. `attachRing(sab)` deriva a capacidade do `byteLength` do SAB e devolve as
   views tipadas (`{ header, data, capacity }`) — qualquer thread com o
   mesmo SAB (worklet, worker, thread principal) chama isto para ver o
   mesmo buffer.
3. `push(ring, block)` copia `block` para dentro do buffer via `.set()`. Em
   overflow (não há espaço livre para o bloco inteiro), o bloco inteiro é
   descartado e `droppedFrames` no cabeçalho é incrementado — o buffer nunca
   cresce nem bloqueia o produtor. `push` também faz `Atomics.notify` no
   slot `writeFrames`, para acordar quem estiver em `waitFor`.
4. `pull(ring, dest)` copia até `dest.length` frames disponíveis para `dest`,
   devolve quantos copiou de facto (nunca mais do que havia disponível).
5. `waitFor(ring, frames, timeoutMs)` resolve `true` assim que há pelo menos
   `frames` disponíveis, `false` se `timeoutMs` esgotar primeiro. Usa
   `Atomics.waitAsync` sobre o slot `writeFrames` — espera/notificação
   nativa, sem loop de polling.
6. `available(ring)` e `droppedFrames(ring)` leem o cabeçalho sem copiar
   dados.

### Cópia, mas zero-alocação (leitura obrigatória antes de mexer aqui)

`push`/`pull` **copiam** via `.set()` — não é zero-cópia no sentido literal
(não devolvem uma view direta sobre o `SharedArrayBuffer` para o chamador
manter). Isso é deliberado: o SAB pode dar a volta (`wrap`) a meio de uma
janela pedida, e um tensor ONNX (fatia seguinte) precisa de um
`Float32Array` contíguo, não de dois pedaços. A garantia que este módulo
promete não é "zero cópia" — é **zero alocação por quantum, zero
`postMessage`, zero structured-clone no caminho quente**: `push` e `pull`
nunca alocam um array novo (o destino é sempre passado pelo chamador,
tipicamente reutilizado entre chamadas) e nunca cruzam uma fronteira de
`postMessage`, que é o custo real que este design evita.

## Fluxo — gate de silêncio (`gate.ts`)

`rms(block)` calcula a energia RMS de um bloco PCM (bloco vazio → `0`, sem
divisão por zero). `isSilent(block, threshold = DEFAULT_SILENCE_RMS)` decide
se o bloco é silêncio a mais para valer a pena empurrar para o ring/ASR.
Ambas puras, sem estado.

## Fluxo — motor de transcrição (`transcription-engine.ts`, `fake-engine.ts`)

`TranscriptionEngine` é o contrato (`warmup`, `transcribe`, `close`) que o
motor real (worker ONNX/Nemotron, fatia seguinte) e o duplo de teste
(`fakeEngine`) implementam — é o seam onde a fatia seguinte troca um motor
verdadeiro sem tocar em `asr-loop.ts`. `fakeEngine(opts?)` é determinístico:
mesmo `pcm.length` produz sempre o mesmo `TranscriptionSegment[]` (um
segmento cobrindo o bloco inteiro, `text` derivado do comprimento), sem
`Math.random` nem `Date.now` não injetado. `opts.transcribe` permite
cenários de teste guionizados.

## Motor real (`nemotron-engine.ts`)

`nemotronEngine(recognizer: Promise<AsrRecognizer>): TranscriptionEngine`
traduz um reconhecedor streaming (a API confirmada do `OnlineRecognizer` do
sherpa-onnx, aqui como interfaces estruturais — `AsrRecognizer`, `AsrStream`,
`AsrResult`) para o contrato `TranscriptionEngine`. Recebe a *promessa* do
reconhecedor, não um reconhecedor pronto: o download do WASM + pesos arranca
no boot do Worker, e `warmup()` é o ponto onde se espera por ele — a
rejeição da promessa propaga-se pela rejeição de `warmup()`, que é o gancho
que a máquina de sessão usa para `GPU_PERDIDA`.

**Ciclo accept→decode→endpoint→reset.** `warmup()` cria um único
`OnlineStream` (reutilizado em todas as janelas seguintes — o relógio de
`start_time` do sherpa e o contexto do FastConformer são ambos relativos ao
*stream*, não à janela) e aquece-o com 320ms de zeros. Cada `transcribe(pcm)`:
1. `stream.acceptWaveform(16000, pcm)`
2. `while (recognizer.isReady(stream)) recognizer.decode(stream)` — drena
   todo o decode disponível para a janela
3. `recognizer.isEndpoint(stream)` — `false` devolve `[]` sem ler nem
   resetar; `true` lê o resultado, reseta o stream (mesmo com texto vazio —
   o silêncio tem de fechar o segmento) e devolve o segmento

**Semântica de segmento finalizado.** Só sai um segmento no `isEndpoint`;
texto parcial a meio de frase nunca é devolvido — `SegmentStore` (fatia 3)
é append-only, e devolver o parcial crescente a cada janela duplicaria
"olá", "olá bom", "olá bom dia" como três segmentos. `startMs`/`endMs` somam
`start_time` (início do segmento, absoluto no stream) com `timestamps[i]`
(relativo ao segmento, zera em cada `reset`); sem `timestamps`, ambos caem
no `start_time`. `// ponytail: só finalizados; parcial ao vivo exige
SegmentStore.revisarUltimo — mudança de contrato, não deste ficheiro`.

**`transcribe()` espera pela mesma promessa que `warmup()`, não por
`rec`/`stream` soltos.** `live-session.ts` chama `engine.warmup().then(...)`
sem `await` e arranca o loop que chama `transcribe()` logo a seguir — se
`transcribe()` lesse duas variáveis de módulo populadas por `warmup()`,
correria com `undefined` sempre que `warmup()` ainda não tivesse resolvido.
Em vez disso, `warmup()` guarda uma única `readyPromise` (a `IIFE` que faz
`createStream` → aquece → `reset`); `transcribe()` faz
`const { rec, stream } = await readyPromise` — se `warmup()` já foi chamado
mas ainda não resolveu, `transcribe()` espera pela mesma promessa em vez de
ver `undefined`. Chamar `transcribe()` sem nunca ter chamado `warmup()` (fora
do contrato, não deveria acontecer em produção) lança
`Error('transcribe() chamado antes de warmup()')` em vez de um cast a mentir
ao compilador.

`close()` é idempotente e tolerante a `warmup()` que nunca correu, nunca
resolveu, ou ainda está a resolver — se `readyPromise` existe, espera por ela
(engolindo rejeição) antes de libertar `stream`/`recognizer`, e só liberta se
o resultado existir.

**O relógio do stream não é o relógio da sessão.** `start_time`/`timestamps`
medem "áudio efetivamente alimentado" ao `acceptWaveform` — chunks
descartados pelo gate de silêncio ou por overflow do ring nunca chegam cá,
logo o tempo só coincide com o da sessão se nada tiver sido descartado.
`// ponytail: relógio = áudio alimentado, não relógio de parede; a linha
exata vem do passe canónico`. Não corrigido aqui de propósito — passar um
`offsetMs` mudaria a assinatura de `TranscriptionEngine` para servir a
tomada best-effort; a linha temporal autoritativa é a dos chunks do
`MediaRecorder` em OPFS e do passe canónico (`packages/diarization`).

**Limite conhecido de integração.** Os testes cobrem 100% do ciclo contra um
duplo estrutural fiel à API do sherpa-onnx (lida no código-fonte oficial,
não suposta), mas nenhum deles prova que o `.wasm` real se comporta como o
duplo — não há teste de integração possível até existirem os dois artefactos
externos: o export Python dos pesos NVIDIA e o build Emscripten do
sherpa-onnx. A primeira prova real é manual, com microfone, na fatia
seguinte (carregador em `apps/app`). Mesmo estado em que `nemotron-engine.ts`
já correu de graça em Node: zero dependências novas (`package.json`
inalterado), `environment: 'node'` no `vitest.config` do pacote.

## Fluxo — loop de ASR (`asr-loop.ts`)

1. `runAsrLoop({ ring, engine, signal, windowFrames?, onSegments, onStats, now? })`
   consome `ring` em janelas de tamanho fixo (`windowFrames`, por omissão
   `5 * CHUNK_FRAMES` ≈ 1.6s @16kHz).
2. Em cada volta: espera (`waitFor`) até haver uma janela cheia ou o
   `signal` abortar; se `signal.aborted` sai do loop; se esgotou o timeout
   de espera sem dados, tenta de novo (repolling — ver "Decisão relevante"
   abaixo).
3. Puxa a janela (`pull`), mede o tempo de processamento com `now()` (por
   omissão `Date.now`, injetável em teste) à volta de `engine.transcribe`,
   acumula tempo de processamento e tempo de áudio processado.
4. Chama `await onSegments(segments)` com os segmentos da janela e
   `await onStats(stats)` com o `AsrLoopStats` corrente a cada janela —
   `onSegments`/`onStats` podem ser síncronos ou devolver `Promise<void>`; se
   um deles rejeitar, o loop para e a promise devolvida por `runAsrLoop`
   rejeita com o mesmo erro (não é engolido). É o seam que a fatia seguinte
   (`live-session.ts`) usa para ligar `persistChunk` a `onSegments` sem
   perder uma falha de persistência em silêncio.
5. Devolve o `AsrLoopStats` final quando `signal.aborted`.

`AsrLoopStats { rtf: number; droppedFrames: number; windows: number }` —
`rtf` (real-time factor) é tempo de processamento acumulado dividido por
tempo de áudio processado acumulado (`0` enquanto nenhuma janela foi
processada, evita `NaN`).

### O que este loop não faz

Não processa uma janela parcial — só puxa quando `waitFor` confirma uma
janela cheia. Isto significa que, ao abortar, um resto de áudio menor que
`windowFrames` que ainda esteja no ring fica por ler (não é descartado do
ring, só não é consumido por este loop antes de parar). Drenar esse resto
no encerramento da sessão é decisão de UI/lifecycle de uma fatia seguinte
(ver `docs/adr/0008-maquina-sessao-nao-invoca-atores.md` — quem orquestra
isso é o adapter, não este loop), não desta fatia.

## Pontos de entrada

- `createRingSab(capacityFrames): SharedArrayBuffer`, `attachRing(sab): Ring`,
  `push(ring, block): boolean`, `pull(ring, dest): number`,
  `available(ring): number`, `droppedFrames(ring): number`,
  `waitFor(ring, frames, timeoutMs): Promise<boolean>`,
  `CHUNK_FRAMES = 5120` (`src/ring-buffer.ts`).
- `rms(block): number`, `isSilent(block, threshold?): boolean`,
  `DEFAULT_SILENCE_RMS = 0.01` (`src/gate.ts`).
- `TranscriptionEngine`, `TranscriptionSegment` (`src/transcription-engine.ts`).
- `fakeEngine(opts?): TranscriptionEngine` (`src/fake-engine.ts`).
- `nemotronEngine(recognizer: Promise<AsrRecognizer>): TranscriptionEngine`,
  `AsrRecognizer`, `AsrStream`, `AsrResult` (`src/nemotron-engine.ts`).
- `runAsrLoop(options): Promise<AsrLoopStats>`, `AsrLoopStats` (`src/asr-loop.ts`).
- `src/index.ts` reexporta tudo o que é API pública dos ficheiros acima.

## Decisões relevantes

**Poll de 200ms para reagir a `signal.aborted` enquanto espera dados:**
`// ponytail:` em `asr-loop.ts` — o loop não reage instantaneamente a um
abort no meio de uma espera sem dados, reage no máximo `POLL_TIMEOUT_MS`
(200ms) depois. Teto conhecido; caminho de upgrade se a latência algum dia
importar: correr `waitFor` numa `Promise.race` contra uma promise resolvida
pelo evento `'abort'` do `AbortSignal`, para cancelamento instantâneo.

**`waitFor` usa `Atomics.waitAsync`, não um loop `setTimeout`:** é
espera/notificação nativa da plataforma (`push` chama `Atomics.notify` no
mesmo slot) — zero CPU gasto a fazer polling enquanto não há dados, e
funciona tanto na thread principal como num worker (ao contrário de
`Atomics.wait` síncrono, que a thread principal não pode chamar).
`tsconfig.json` inclui `"ES2024.SharedMemory"` na lib só por causa deste
tipo — `target` continua `es2023`.

**Contadores do cabeçalho são `Int32Array`, não 64-bit:** `writeFrames` e
`readFrames` fazem aritmética modular de 32 bits (a subtração
`(w - r) | 0` continua correta mesmo depois de um dos dois dar a volta a
2³¹). O teto real é a diferença entre os dois nunca poder exceder 2³¹
frames — a ~37h de áudio contínuo a 16kHz sem o consumidor drenar nada,
muito acima da duração de uma sessão de teleconsulta. Não perseguido além
disto.

**`Ring` (a struct devolvida por `attachRing`) fica público, não escondido
atrás de um objeto com métodos:** `push`/`pull`/`available`/`waitFor` são
funções livres que recebem `Ring`, não métodos de uma classe — mantém o
buffer serializável/inspecionável (é só duas views sobre o mesmo SAB) e
evita uma camada de indireção que nada aqui precisa.
