import type { CryptoKey } from '@limmiar/crypto'
import { abrirChunk } from '../live-session/audio-crypto'
import { listarOrfaos } from '../live-session/chunk-store'

/** Wrapper fino sobre um `HTMLAudioElement` já existente (com `src` atribuído pelo
 *  chamador, ver `abrirSessaoComoBlob`) -- o próprio elemento é responsabilidade de quem
 *  chama, este seam só existe para o componente de UI nunca tocar no elemento direto
 *  (testável em jsdom com um duplo, já que jsdom não implementa `play()`/`pause()`).
 *  Tipo de retorno inferido de propósito -- um produtor (`criarReprodutor`), um
 *  consumidor (`NotaPage`) que nunca o nomeia por tipo, nenhum outro adapter no monorepo
 *  a implementar a mesma forma: nomear a interface seria abstração sem segundo uso. */
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

// MIME do `MediaRecorder` em `live-session.ts` -- `new MediaRecorder(stream)`, sem
// segundo argumento, então o codec é o default do browser. Chromium/Firefox escolhem
// `audio/webm;codecs=opus` para um MediaStream só de áudio sem `mimeType` explícito.
// ponytail: hardcoded aqui em vez de persistido como metadado da sessão -- teto: um
// browser que grave com outro codec produz um Blob cujo tipo não bate com os bytes
// reais; upgrade é a fatia 4 gravar `recorder.mimeType` junto da sessão e este ficheiro
// lê-lo em vez de assumir.
const MIME_SESSAO = 'audio/webm;codecs=opus'

/** Lê os chunks selados de `dir` por ordem de `seq`, abre cada um sob `dek`/`sessionId`
 *  (`abrirChunk`) e concatena o resultado num único `Blob` reproduzível. Sessão sem
 *  chunks e chunk que falha a abrir rejeitam -- nenhum dos dois casos é silenciado: uma
 *  sessão vazia tocada como se fosse áudio válido, ou um chunk corrompido/fora de lugar
 *  descartado sem aviso, escondem perda de dados em vez de a sinalizar. */
export async function abrirSessaoComoBlob(
  dir: FileSystemDirectoryHandle,
  dek: CryptoKey,
  sessionId: string,
): Promise<Blob> {
  const seqs = (await listarOrfaos(dir)).map(Number).sort((a, b) => a - b)
  if (seqs.length === 0) {
    throw new Error(`sessão ${sessionId} não tem chunks`)
  }

  // ponytail: a sessão inteira é decifrada e mantida em memória de uma vez antes de
  // devolver o Blob -- teto: uma sessão longa (dezenas de minutos) dobra o pico de RAM
  // (chunks selados + plaintext concatenado) só para tocar áudio; upgrade é
  // descodificação preguiçosa por chunk (streaming via MediaSource), quando uma sessão
  // real bater esse teto -- mesmo achado da fatia 6 do S05-02 (nemotron-loader.ts).
  const partes: Uint8Array<ArrayBuffer>[] = []
  for (const seq of seqs) {
    const handle = await dir.getFileHandle(String(seq))
    const file = await handle.getFile()
    const selado = new Uint8Array(await file.arrayBuffer()) as Uint8Array<ArrayBuffer>
    partes.push(await abrirChunk(dek, sessionId, seq, selado))
  }
  return new Blob(partes, { type: MIME_SESSAO })
}
