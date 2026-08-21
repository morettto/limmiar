# session

## Responsabilidade

Cifra e escrita persistente dos chunks de PCM de uma sessão de captura ao
vivo. Mesma disciplina de `patients/patient-crypto.ts`/`copilot/copilot-crypto.ts`:
AAD versionada por contexto, cifra pela primitiva única de
`@limmiar/crypto`, nunca reinventada aqui. Esta é a fatia 2 de S05-02 --
só cifra + escrita OPFS. `live-session.ts`, `segment-store.ts`,
`pcm-tap.processor.ts`, `asr.worker.ts`, `engine-for.ts`,
`nemotron-engine.ts` e `SessaoAoVivo.tsx` ficam para fatias seguintes.

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

## Pontos de entrada

- `audioChunkAad(sessionId, seq): Uint8Array<ArrayBuffer>`,
  `sealChunk(dek, sessionId, seq, chunk): Promise<Uint8Array<ArrayBuffer>>`
  (`audio-crypto.ts`).
- `WriteSealed` (tipo), `opfsWriter(dir): WriteSealed`,
  `persistChunk(write, dek, sessionId, seq, blob): Promise<void>`,
  `listarOrfaos(dir): Promise<string[]>` (`chunk-store.ts`).

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
