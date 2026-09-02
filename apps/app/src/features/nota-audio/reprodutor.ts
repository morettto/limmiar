import type { CryptoKey } from '@limmiar/crypto'
import { abrirChunk } from '../live-session/audio-crypto'
import { listarOrfaos } from '../live-session/chunk-store'

/** Wrapper fino sobre um `HTMLAudioElement` já existente (com `src` posto pelo chamador): o seam
 *  existe para o componente de UI nunca tocar no elemento direto, e é testável em jsdom com um
 *  duplo. Tipo de retorno inferido — um produtor, um consumidor, nomear a interface seria cedo. */
export function criarReprodutor(audio: HTMLAudioElement) {
  return {
    tocar(inicioMs: number) {
      audio.currentTime = inicioMs / 1000
      void audio.play()
    },
    parar() {
      audio.pause()
    },
  }
}

// MIME do `MediaRecorder` em `live-session.ts`, que usa o default do browser (Chromium e Firefox
// escolhem opus em WebM). ponytail: hardcoded em vez de persistido — teto: um browser com outro
// codec dá um Blob com tipo errado; upgrade é gravar `recorder.mimeType` com a sessão.
const MIME_SESSAO = 'audio/webm;codecs=opus'

/** Lê os chunks selados de `dir` por ordem de `seq`, abre cada um sob `dek`/`sessionId` e concatena
 *  num único `Blob`. Sessão sem chunks e chunk que falha a abrir rejeitam: silenciá-los esconderia
 *  perda de dados em vez de a sinalizar. */
export async function abrirSessaoComoBlob(
  dir: FileSystemDirectoryHandle,
  dek: CryptoKey,
  sessionId: string,
): Promise<Blob> {
  const seqs = (await listarOrfaos(dir)).map(Number).sort((a, b) => a - b)
  if (seqs.length === 0) {
    throw new Error(`sessão ${sessionId} não tem chunks`)
  }

  // ponytail: a sessão inteira é decifrada em memória antes de devolver o Blob — teto: uma sessão
  // longa dobra o pico de RAM só para tocar áudio; upgrade é descodificação preguiçosa por chunk
  // (streaming via MediaSource) quando uma sessão real bater esse teto.
  const partes: Uint8Array<ArrayBuffer>[] = []
  for (const seq of seqs) {
    const handle = await dir.getFileHandle(String(seq))
    const file = await handle.getFile()
    const selado = new Uint8Array(await file.arrayBuffer()) as Uint8Array<ArrayBuffer>
    partes.push(await abrirChunk(dek, sessionId, seq, selado))
  }
  return new Blob(partes, { type: MIME_SESSAO })
}
