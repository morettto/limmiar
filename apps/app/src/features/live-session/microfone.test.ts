import { afterEach, describe, expect, it, vi } from 'vitest'
import { abrirMicrofone, type MicrofoneAutorizado } from './microfone'

function midiaFalsa(getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>): MediaDevices {
  return { getUserMedia } as unknown as MediaDevices
}

describe('MicrofoneAutorizado', () => {
  it('não se forja: montar o objeto à mão não compila, só `abrirMicrofone` o constrói', () => {
    // @ts-expect-error -- literal sem a marca não é `MicrofoneAutorizado`. A invariante da porta
    // única é imposta pelo compilador, não por convenção escrita no README.
    const forjado: MicrofoneAutorizado = { stream: {} as MediaStream }

    expect(forjado.stream).toBeDefined()
  })
})

describe('abrirMicrofone', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'mediaDevices')
  })

  it('abrirMicrofone recusa sem consentimento ativo e não chama getUserMedia', async () => {
    const getUserMedia = vi.fn()

    const resultado = await abrirMicrofone('pendente', midiaFalsa(getUserMedia))

    expect(resultado).toEqual({ ok: false, motivo: 'consentimento-ausente' })
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('recusa também quando o consentimento foi revogado, sem chamar getUserMedia', async () => {
    const getUserMedia = vi.fn()

    const resultado = await abrirMicrofone('revogado', midiaFalsa(getUserMedia))

    expect(resultado).toEqual({ ok: false, motivo: 'consentimento-ausente' })
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('com consentimento concedido, chama getUserMedia({ audio: true }) e devolve o stream em MicrofoneAutorizado', async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream
    const getUserMedia = vi.fn().mockResolvedValue(stream)

    const resultado = await abrirMicrofone('concedido', midiaFalsa(getUserMedia))

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(resultado).toEqual({ ok: true, microfone: { stream } })
  })

  it('abrirMicrofone mapeia NotAllowedError para permissao-negada', async () => {
    const erro = new DOMException('Permission denied', 'NotAllowedError')
    const getUserMedia = vi.fn().mockRejectedValue(erro)

    const resultado = await abrirMicrofone('concedido', midiaFalsa(getUserMedia))

    expect(resultado).toEqual({ ok: false, motivo: 'permissao-negada' })
  })

  it('usa navigator.mediaDevices por omissão quando midia não é passado', async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })

    const resultado = await abrirMicrofone('concedido')

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(resultado).toEqual({ ok: true, microfone: { stream } })
  })
})
