import { describe, expect, it, vi } from 'vitest'
import { criarReprodutor } from './reprodutor'


// jsdom não implementa HTMLMediaElement.play()/pause() -- este duplo tem só as duas
// propriedades e os dois métodos que criarReprodutor de facto usa.
function audioDuplo(): HTMLAudioElement {
  return {
    currentTime: 0,
    play: vi.fn(),
    pause: vi.fn(),
  } as unknown as HTMLAudioElement
}

describe('criarReprodutor', () => {
  it('tocar(inicioMs) posiciona currentTime em segundos e chama play()', () => {
    const audio = audioDuplo()
    const reprodutor = criarReprodutor(audio)

    reprodutor.tocar(2500)

    expect(audio.currentTime).toBe(2.5)
    expect(audio.play).toHaveBeenCalledTimes(1)
  })

  it('parar() chama pause()', () => {
    const audio = audioDuplo()
    const reprodutor = criarReprodutor(audio)

    reprodutor.parar()

    expect(audio.pause).toHaveBeenCalledTimes(1)
  })
})
