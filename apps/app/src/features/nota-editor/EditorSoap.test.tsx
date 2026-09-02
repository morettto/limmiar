import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../../shared/i18n'
import type { Nota } from '../../entities/nota/nota'
import { EditorSoap } from './EditorSoap'

const NOTA: Nota = {
  id: 'nota-1',
  patientId: 'paciente-1',
  revisao: 0,
  frases: [
    { id: 'S-0', secao: 'S', texto: 'queixa principal', ancoras: [{ inicioMs: 0, fimMs: 1000 }] },
    { id: 'O-0', secao: 'O', texto: 'exame físico', ancoras: [] },
    { id: 'A-0', secao: 'A', texto: 'hipótese', ancoras: [{ inicioMs: 2000, fimMs: 3000 }] },
    // P fica sem frases de propósito -- cobre a secção vazia.
  ],
  estado: 'pendente',
}

function renderEditor(props?: Partial<{ nota: Nota; onChange: (nota: Nota) => void; aoTocar: (ancora: unknown) => void; aoAssinar: (nota: Nota) => void }>) {
  return render(
    <I18nProvider i18n={i18n}>
      <EditorSoap
        nota={props?.nota ?? NOTA}
        onChange={props?.onChange ?? vi.fn()}
        aoTocar={(props?.aoTocar as (ancora: { inicioMs: number; fimMs: number }) => void) ?? vi.fn()}
        aoAssinar={props?.aoAssinar ?? vi.fn()}
      />
    </I18nProvider>,
  )
}

describe('EditorSoap', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => cleanup())

  it('renderiza as quatro secções, cada uma com as frases da sua secção', () => {
    renderEditor()

    expect(screen.getByRole('region', { name: 'Subjetivo' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Objetivo' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Avaliação' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Plano' })).toBeTruthy()
    expect((screen.getByLabelText('Subjetivo 1') as HTMLTextAreaElement).value).toBe('queixa principal')
    expect((screen.getByLabelText('Objetivo 1') as HTMLTextAreaElement).value).toBe('exame físico')
    expect((screen.getByLabelText('Avaliação 1') as HTMLTextAreaElement).value).toBe('hipótese')
  })

  it('a secção "Plano", sem frases, não expõe nenhum textarea', () => {
    renderEditor()

    expect(screen.queryByLabelText('Plano 1')).toBeNull()
  })

  it('editar o texto de uma frase chama onChange com a nota atualizada (revisão incrementada)', () => {
    const onChange = vi.fn()
    renderEditor({ onChange })

    fireEvent.change(screen.getByLabelText('Subjetivo 1'), { target: { value: 'queixa nova' } })

    expect(onChange).toHaveBeenCalledWith({
      ...NOTA,
      revisao: 1,
      frases: [{ ...NOTA.frases[0], texto: 'queixa nova' }, NOTA.frases[1], NOTA.frases[2]],
    })
  })

  it('mostra uma Citacao por âncora e delega o clique a aoTocar', () => {
    const aoTocar = vi.fn()
    renderEditor({ aoTocar })

    fireEvent.click(screen.getAllByRole('button')[0])

    expect(aoTocar).toHaveBeenCalledWith({ inicioMs: 0, fimMs: 1000 })
  })

  it('uma frase sem âncoras não mostra nenhuma Citacao', () => {
    renderEditor()

    // "exame físico" (O-0) não tem âncoras -- só as 2 citações de S-0/A-0 existem no total.
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  // Só um ramo (metaKey) é coberto aqui de propósito -- o wiring é único e a exaustividade
  // metaKey/ctrlKey de `ehAtalhoAssinar` já está provada em navegacao-teclado.test.ts;
  // duplicar os dois modificadores aqui provaria o mesmo ramo duas vezes.
  it('Cmd+Enter (metaKey) chama aoAssinar com a nota atual', () => {
    const aoAssinar = vi.fn()
    renderEditor({ aoAssinar })

    fireEvent.keyDown(screen.getByLabelText('Subjetivo 1'), { key: 'Enter', metaKey: true })

    expect(aoAssinar).toHaveBeenCalledWith(NOTA)
  })

  it('Enter sozinho, sem modificador, não chama aoAssinar', () => {
    const aoAssinar = vi.fn()
    renderEditor({ aoAssinar })

    fireEvent.keyDown(screen.getByLabelText('Subjetivo 1'), { key: 'Enter' })

    expect(aoAssinar).not.toHaveBeenCalled()
  })

  it('nota assinada renderiza os textarea em leitura apenas', () => {
    renderEditor({ nota: { ...NOTA, estado: 'assinada' } })

    expect((screen.getByLabelText('Subjetivo 1') as HTMLTextAreaElement).readOnly).toBe(true)
  })

  it('nota pendente renderiza os textarea editáveis', () => {
    renderEditor()

    expect((screen.getByLabelText('Subjetivo 1') as HTMLTextAreaElement).readOnly).toBe(false)
  })
})
