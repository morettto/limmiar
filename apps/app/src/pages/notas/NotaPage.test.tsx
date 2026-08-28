import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { NotaPage } from './NotaPage'

vi.mock('../../widgets/soap-editor/FilaEEditor', () => ({
  FilaEEditor: vi.fn(() => <div data-testid="fila-e-editor" />),
}))

describe('NotaPage', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  // O <audio> renderiza sempre junto com este componente (ver comentário em NotaPage.tsx),
  // então este ramo nunca é alcançado por um caminho de UI real -- mas a guarda existe
  // (ADR contra `!` na fronteira) e precisa do próprio teste para provar que, se o ref
  // alguma vez estiver nulo (aqui: componente já desmontado), aoTocar é um no-op seguro
  // em vez de rebentar com `audioRef.current!`.
  it('aoTocar não rebenta se o ref do <audio> estiver nulo', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    render(<NotaPage />)

    const { FilaEEditor } = await import('../../widgets/soap-editor/FilaEEditor')
    const props = vi.mocked(FilaEEditor).mock.calls[0]![0]

    cleanup() // desmonta o <audio> -- React zera audioRef.current

    expect(() => props.aoTocar({ inicioMs: 1000, fimMs: 2000 })).not.toThrow()
    expect(play).not.toHaveBeenCalled()

    play.mockRestore()
  })
})
