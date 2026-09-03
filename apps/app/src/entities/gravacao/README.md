# entities/gravacao

## Responsabilidade

Cifra dos chunks de PCM de uma sessão de captura ao vivo (`audioChunkAad`, `sealChunk`,
`abrirChunk`). Módulo novo do ticket S08-08: `audio-crypto.ts` viveu em
`features/live-session` desde S05-02 até esta fatia, movido inteiro (mesma assinatura, mesmo
formato de fio, byte-a-byte) para baixar de camada -- a cifra não depende de nada específico
de captura ao vivo (`MediaRecorder`, ring buffer, ASR), só de `dek`/`sessionId`/`seq`/bytes, e
duas features (`live-session`, que escreve, e `nota-audio`, que lê para tocar) precisavam de a
importar sem violar a regra de isolamento de slices (`fsd-no-cross-slice`,
`.dependency-cruiser.cjs`) que proíbe uma feature de importar de outra do mesmo nível.

## Fluxo principal

1. `audioChunkAad(sessionId, seq)` gera a AAD versionada
   (`limmiar/audio-chunk/v1|${sessionId}|${seq}`), à imagem de `patientEntryAad`.
2. `sealChunk(dek, sessionId, seq, chunk)` cifra um chunk sob essa AAD via
   `webcrypto.encrypt` de `@limmiar/crypto` -- wire format `iv(12) || ciphertext || tag(16)`,
   mesma primitiva usada em todo o resto do app, não reimplementada.
3. `abrirChunk(dek, sessionId, seq, selado)` é o inverso exato -- `webcrypto.decrypt` sob a
   mesma AAD. Rejeita se `sessionId`/`seq` não forem os mesmos usados para selar: é a AAD,
   não uma checagem extra, que impede um chunk de outra sessão ou fora de ordem de abrir por
   bom.

## Pontos de entrada

- `audioChunkAad(sessionId: string, seq: number): Uint8Array<ArrayBuffer>`
- `sealChunk(dek: CryptoKey, sessionId: string, seq: number, chunk: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>`
- `abrirChunk(dek: CryptoKey, sessionId: string, seq: number, selado: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>`
- Consumido por `features/live-session/chunk-store.ts` (`persistChunk` chama `sealChunk`) e
  por `features/nota-audio/reprodutor.ts` (`abrirSessaoComoBlob` chama `abrirChunk`).

## Decisões desta fatia (S08-08)

- **Movido inteiro, sem tocar em assinatura nem em formato de fio.** A AAD continua
  byte-a-byte a mesma (`limmiar/audio-chunk/v1|...`); um chunk selado antes desta fatia abre
  depois dela sem qualquer migração -- é reorganização de código (`safe-refactor`), não
  mudança de comportamento.
- **`entities`, não `shared`.** A cifra tem um dono de domínio (`gravacao`, o conteúdo de
  uma sessão de captura) e uma AAD que carrega esse domínio no prefixo -- não é utilitário
  genérico como `shared/lib/base64.ts` (que não sabe o que está a (des)codificar).

## Fora de âmbito

- Escrita/leitura em OPFS: continuam em `features/live-session/chunk-store.ts` e
  `features/nota-audio/reprodutor.ts`, respetivamente -- este módulo só cifra bytes, nunca
  toca em `FileSystemDirectoryHandle`.
- Listar nomes de ficheiro num diretório: `shared/lib/opfs.ts` (`listarOrfaos`), movido na
  mesma fatia mas para `shared`, não para aqui.
