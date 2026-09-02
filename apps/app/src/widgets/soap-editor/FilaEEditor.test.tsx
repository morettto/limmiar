import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../../shared/i18n'
import type { Nota } from '../../entities/nota/nota'
import { FilaEEditor } from './FilaEEditor'

function nota(id: string, patientId: string): Nota {
  return {
    id,
    patientId,
    revisao: 0,
    frases: [{ id: `${id}-S-0`, secao: 'S', texto: `texto de ${id}`, ancoras: [] }],
    estado: 'pendente',
  }
}

const NOTAS: readonly Nota[] = [nota('nota-1', 'paciente-1'), nota('nota-2', 'paciente-2')]

// jsdom has no matchMedia; AdaptivePanel's useBreakpoint hook needs one to mount at all.
// A fixed "matches: false" (-> sm/disclosure layout) is enough here -- breakpoint-specific
// rendering is proven by AdaptivePanel's own suite, not here. Same stub as
// widgets/patient-wallet/PatientWallet.test.tsx.
function stubMatchMedia() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

function renderWidget(props?: Partial<{
  notas: readonly Nota[]
  onChangeNota: (nota: Nota) => void
  aoTocar: (ancora: unknown) => void
  aoAssinar: (nota: Nota) => void
}>) {
  return render(
    <I18nProvider i18n={i18n}>
      <FilaEEditor
        notas={props?.notas ?? NOTAS}
        onChangeNota={props?.onChangeNota ?? vi.fn()}
        aoTocar={(props?.aoTocar as () => void) ?? vi.fn()}
        aoAssinar={props?.aoAssinar ?? vi.fn()}
      />
    </I18nProvider>,
  )
}

describe('FilaEEditor', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
    stubMatchMedia()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('abre já com a primeira nota da fila carregada no editor', () => {
    renderWidget()

    expect((screen.getByLabelText('Subjetivo 1') as HTMLTextAreaElement).value).toBe('texto de nota-1')
  })

  it('sem itens na fila, mostra uma mensagem de estado em vez do editor', () => {
    renderWidget({ notas: [] })

    expect(screen.getByRole('status').textContent).toBe('Selecione uma nota na fila.')
    expect(screen.queryByLabelText('Subjetivo 1')).toBeNull()
  })

  it('selecionar outra nota na fila troca a nota mostrada no editor', () => {
    renderWidget()

    // stubMatchMedia força o breakpoint "sm" (matches: false) -- a fila fica atrás da
    // gaveta fechada por omissão (AdaptivePanel), como num telemóvel real.
    fireEvent.click(screen.getByRole('button', { name: 'Fila de assinatura' }))
    fireEvent.click(screen.getByText('paciente-2'))

    expect((screen.getByLabelText('Subjetivo 1') as HTMLTextAreaElement).value).toBe('texto de nota-2')
  })

  it('editar uma frase no editor propaga onChangeNota', () => {
    const onChangeNota = vi.fn()
    renderWidget({ onChangeNota })

    fireEvent.change(screen.getByLabelText('Subjetivo 1'), { target: { value: 'edição' } })

    expect(onChangeNota).toHaveBeenCalledWith({
      ...NOTAS[0]!,
      revisao: 1,
      frases: [{ ...NOTAS[0]!.frases[0], texto: 'edição' }],
    })
  })
})
