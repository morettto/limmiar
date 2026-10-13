
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
