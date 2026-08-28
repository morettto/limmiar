# features/nota-audio

## Responsabilidade

Reprodução do áudio de uma sessão ao vivo já cifrada e persistida por
`features/live-session` (spec S08, fatia 3 de 5). Duas peças: um wrapper fino sobre
`HTMLAudioElement` (`criarReprodutor`) e a leitura+abertura dos chunks selados em OPFS
até um `Blob` reproduzível (`abrirSessaoComoBlob`). Sem UI própria -- quem monta o
elemento `<audio>` e decide quando chamar `tocar`/`parar` é o chamador
(`pages/notas/NotaPage.tsx`, via `Citacao` de `features/nota-editor`).

## Fluxo principal

1. `criarReprodutor(audio: HTMLAudioElement)` devolve `{ tocar(inicioMs), parar() }`
   (tipo de retorno inferido -- um único produtor, um único consumidor que nunca o nomeia
   por tipo, sem outro adapter no monorepo a implementar a mesma forma) sobre um elemento
   já existente. `tocar` posiciona
   `audio.currentTime = inicioMs / 1000` e chama `audio.play()`; `parar` chama
   `audio.pause()`. O elemento (com `src` já atribuído) é responsabilidade do chamador --
   este seam existe só para o componente de UI nunca tocar no elemento direto, e para
   ser testável em jsdom com um duplo (jsdom não implementa `play()`/`pause()`).
2. `abrirSessaoComoBlob(dir, dek, sessionId): Promise<Blob>` lista os ficheiros de `dir`
   (reusa `listarOrfaos` de `features/live-session/chunk-store.ts` -- mesma operação de
   listar nomes, sem reimplementar), ordena por `seq` (numérico, não lexicográfico -- "10"
   antes de "2" quebraria a ordem), abre cada chunk sob `dek`/`sessionId` via `abrirChunk`
   (`features/live-session/audio-crypto.ts`) e concatena o plaintext resultante num único
   `Blob`.
3. Sessão sem chunks e chunk que falha a abrir **rejeitam** -- nenhum dos dois é
   silenciado. Ver Decisões.

## Pontos de entrada

- `criarReprodutor(audio: HTMLAudioElement)` (`reprodutor.ts`) -- devolve
  `{ tocar(inicioMs: number): void; parar(): void }`; sem interface nomeada de propósito
  (ver Fluxo principal).
- `abrirSessaoComoBlob(dir: FileSystemDirectoryHandle, dek: CryptoKey, sessionId: string): Promise<Blob>` (`reprodutor.ts`).
- Consumido por `pages/notas/NotaPage.tsx`, que passa `(ancora) => criarReprodutor(audioRef.current!).tocar(ancora.inicioMs)`
  como `aoTocar` até `widgets/soap-editor/FilaEEditor.tsx` → `features/nota-editor/EditorSoap.tsx` → `Citacao.tsx`.

## Decisões desta fatia

- **Sessão sem chunks e chunk que falha a abrir rejeitam, não devolvem um `Blob` vazio
  nem saltam o chunk em silêncio.** Um `Blob` vazio tocado como se fosse áudio válido, ou
  um chunk corrompido/fora de lugar descartado sem aviso, escondem perda de dados em vez
  de a sinalizar -- mesmo instinto de `editarFrase` (`entities/nota`) e `persistChunk`
  (`live-session`) já seguido no resto do domínio.
- **`ponytail:` a sessão inteira é decifrada e mantida em memória de uma vez antes de
  devolver o `Blob`** (ver comentário em `abrirSessaoComoBlob`). Teto: uma sessão longa
  (dezenas de minutos) dobra o pico de RAM (chunks selados + plaintext concatenado) só
  para tocar áudio. Upgrade: descodificação preguiçosa por chunk (streaming via
  `MediaSource`), quando uma sessão real bater esse teto -- mesmo achado da fatia 6 do
  S05-02 (`nemotron-loader.ts`).
- **`ponytail:` o MIME do `Blob` (`audio/webm;codecs=opus`) é hardcoded**, não persistido
  como metadado da sessão. `live-session.ts` chama `new MediaRecorder(stream)` sem
  `mimeType` explícito -- o codec é o default do browser (Chromium/Firefox escolhem
  `audio/webm;codecs=opus` para um `MediaStream` só de áudio). Teto: um browser que grave
  com outro codec produz um `Blob` cujo tipo não bate com os bytes reais. Upgrade: a
  fatia 4 grava `recorder.mimeType` junto da sessão e este ficheiro lê-lo em vez de
  assumir.
- **`abrirSessaoComoBlob` reusa `listarOrfaos` de `chunk-store.ts` para listar os nomes de
  ficheiro**, em vez de reimplementar `dir.keys()` aqui -- é literalmente a mesma
  operação (listar o que está num diretório OPFS), só o chamador difere (recuperação de
  sessão órfã vs. leitura de sessão para tocar).
- **Sem mock de OPFS de repositório para reusar** (mesma decisão de `chunk-store.test.ts`):
  o mock (`FakeDirectoryHandle`/`FakeFileHandle`) começou local a
  `reprodutor.test.ts`, só com os métodos que `abrirSessaoComoBlob` de facto usa
  (`getFileHandle` → `getFile` → `arrayBuffer`, `keys`). Desde S08-02 vive em
  `apps/app/src/test-support/fake-opfs.ts`, partilhado com `chunk-store.test.ts` (que só
  escreve) e `indice-store.test.ts` de `features/nota-biblioteca` (que lê e escreve) --
  terceira duplicação do mesmo duplo, extraído em vez de copiado outra vez.

## Fora de âmbito (fatias seguintes da spec S08)

- Carregar `dir`/`dek`/`sessionId` reais de um backend e atribuir o `Blob` resultante ao
  `src` do `<audio>` de `NotaPage` -- fatia 4. Hoje o elemento existe e o reprodutor liga
  a ele de verdade, mas sem fonte carregada (tocar antes disso é um no-op honesto: o
  elemento não tem `src`, não uma função vazia escondendo o gap).
- Descodificação preguiçosa por chunk / streaming -- ver o `ponytail:` acima.
