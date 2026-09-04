import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../../shared/i18n'
import { ESTADO_ASSINADA, ESTADO_PENDENTE, type Nota } from '../../entities/nota/nota'
import { FilaAssinatura } from './FilaAssinatura'

function nota(id: string, patientId: string, estado: Nota['estado']): Nota {
  return { id, patientId, revisao: 0, frases: [], estado }
}

const ITENS: readonly Nota[] = [
  nota('nota-1', 'paciente-1', ESTADO_PENDENTE),
  nota('nota-2', 'paciente-2', ESTADO_PENDENTE),
  nota('nota-3', 'paciente-3', ESTADO_ASSINADA),
]

function renderFila(props?: Partial<{ itens: readonly Nota[]; selecionadoId: string | null; onSelecionar: (id: string) => void }>) {
  return render(
    <I18nProvider i18n={i18n}>
      <FilaAssinatura
        itens={props?.itens ?? ITENS}
        selecionadoId={props?.selecionadoId ?? null}
        onSelecionar={props?.onSelecionar ?? vi.fn()}
      />
    </I18nProvider>,
  )
}

describe('FilaAssinatura', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => cleanup())

  it('mostra a aba "Pendentes" ativa por omissão, só com as notas pendentes', () => {
    renderFila()

    expect(screen.getByRole('tab', { name: 'Pendentes' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Assinadas' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.queryByText('paciente-3')).toBeNull()
  })

  it('a listbox aponta aria-activedescendant para a primeira opção por omissão', () => {
    renderFila()

    const listbox = screen.getByRole('listbox')
    const primeiraOpcao = screen.getByText('paciente-1').closest('[role="option"]') as HTMLElement
    expect(listbox.getAttribute('aria-activedescendant')).toBe(primeiraOpcao.id)
  })

  it('trocar para a aba "Assinadas" mostra só as notas assinadas e reativa a primeira opção', () => {
    renderFila()

    fireEvent.click(screen.getByRole('tab', { name: 'Assinadas' }))

    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByText('paciente-3')).toBeTruthy()
    const listbox = screen.getByRole('listbox')
    const opcao = screen.getByText('paciente-3').closest('[role="option"]') as HTMLElement
    expect(listbox.getAttribute('aria-activedescendant')).toBe(opcao.id)
  })

  it('"j" desce o índice ativo na listbox', () => {
    renderFila()
    const listbox = screen.getByRole('listbox')

    fireEvent.keyDown(listbox, { key: 'j' })

    const segundaOpcao = screen.getByText('paciente-2').closest('[role="option"]') as HTMLElement
    expect(listbox.getAttribute('aria-activedescendant')).toBe(segundaOpcao.id)
  })

  it('"k" sobe o índice ativo na listbox', () => {
    renderFila()
    const listbox = screen.getByRole('listbox')
    fireEvent.keyDown(listbox, { key: 'j' })

    fireEvent.keyDown(listbox, { key: 'k' })

    const primeiraOpcao = screen.getByText('paciente-1').closest('[role="option"]') as HTMLElement
    expect(listbox.getAttribute('aria-activedescendant')).toBe(primeiraOpcao.id)
  })

  it('Enter seleciona a nota ativa', () => {
    const onSelecionar = vi.fn()
    renderFila({ onSelecionar })
    const listbox = screen.getByRole('listbox')
    fireEvent.keyDown(listbox, { key: 'j' })

    fireEvent.keyDown(listbox, { key: 'Enter' })

    expect(onSelecionar).toHaveBeenCalledWith('nota-2')
  })

  it('uma tecla irrelevante não muda o índice ativo nem chama onSelecionar', () => {
    const onSelecionar = vi.fn()
    renderFila({ onSelecionar })
    const listbox = screen.getByRole('listbox')

    fireEvent.keyDown(listbox, { key: 'x' })

    const primeiraOpcao = screen.getByText('paciente-1').closest('[role="option"]') as HTMLElement
    expect(listbox.getAttribute('aria-activedescendant')).toBe(primeiraOpcao.id)
    expect(onSelecionar).not.toHaveBeenCalled()
  })

  it('clicar diretamente numa opção chama onSelecionar com o seu id', () => {
    const onSelecionar = vi.fn()
    renderFila({ onSelecionar })

    fireEvent.click(screen.getByText('paciente-2'))

    expect(onSelecionar).toHaveBeenCalledWith('nota-2')
  })

  it('marca aria-selected na opção que corresponde a selecionadoId', () => {
    renderFila({ selecionadoId: 'nota-2' })

    expect(screen.getByText('paciente-1').closest('[role="option"]')?.getAttribute('aria-selected')).toBe('false')
    expect(screen.getByText('paciente-2').closest('[role="option"]')?.getAttribute('aria-selected')).toBe('true')
  })

  it('lista vazia mostra uma mensagem de estado e não expõe aria-activedescendant nem opções', () => {
    renderFila({ itens: [] })

    expect(screen.getByRole('status').textContent).toBe('Nenhuma nota nesta aba.')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByRole('listbox').hasAttribute('aria-activedescendant')).toBe(false)
  })

  it('Enter com a lista vazia não chama onSelecionar', () => {
    const onSelecionar = vi.fn()
    renderFila({ itens: [], onSelecionar })

    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' })

    expect(onSelecionar).not.toHaveBeenCalled()
  })

  it('itens que encolhem sob a mesma aba (ex.: aoAssinar no widget-pai) clampam o índice ativo em vez de rebentar', () => {
    const onSelecionar = vi.fn()
    const { rerender } = render(
      <I18nProvider i18n={i18n}>
        <FilaAssinatura itens={ITENS} selecionadoId={null} onSelecionar={onSelecionar} />
      </I18nProvider>,
    )
    const listbox = screen.getByRole('listbox')
    // Move o cursor para a última pendente (nota-2, índice 1 dentro da aba "pendente").
    fireEvent.keyDown(listbox, { key: 'j' })

    // O widget-pai assina nota-2 "por fora" -- a aba continua "pendente", mas filtrados
    // encolhe de 2 para 1 sem que trocarAba tenha corrido.
    rerender(
      <I18nProvider i18n={i18n}>
        <FilaAssinatura
          itens={[
            nota('nota-1', 'paciente-1', ESTADO_PENDENTE),
            nota('nota-2', 'paciente-2', ESTADO_ASSINADA),
            nota('nota-3', 'paciente-3', ESTADO_ASSINADA),
          ]}
          selecionadoId={null}
          onSelecionar={onSelecionar}
        />
      </I18nProvider>,
    )

    const primeiraOpcao = screen.getByText('paciente-1').closest('[role="option"]') as HTMLElement
    expect(listbox.getAttribute('aria-activedescendant')).toBe(primeiraOpcao.id)

    fireEvent.keyDown(listbox, { key: 'Enter' })
    expect(onSelecionar).toHaveBeenCalledWith('nota-1')
  })

  it('itens que ficam vazios sob a mesma aba não deixam aria-activedescendant nem Enter apontar para nada', () => {
    const onSelecionar = vi.fn()
    const { rerender } = render(
      <I18nProvider i18n={i18n}>
        <FilaAssinatura itens={ITENS} selecionadoId={null} onSelecionar={onSelecionar} />
      </I18nProvider>,
    )
    const listbox = screen.getByRole('listbox')
    fireEvent.keyDown(listbox, { key: 'j' })

    rerender(
      <I18nProvider i18n={i18n}>
        <FilaAssinatura
          itens={[nota('nota-1', 'paciente-1', ESTADO_ASSINADA), nota('nota-2', 'paciente-2', ESTADO_ASSINADA)]}
          selecionadoId={null}
          onSelecionar={onSelecionar}
        />
      </I18nProvider>,
    )

    expect(screen.getByRole('status')).toBeTruthy()
    expect(listbox.hasAttribute('aria-activedescendant')).toBe(false)

    fireEvent.keyDown(listbox, { key: 'Enter' })
    expect(onSelecionar).not.toHaveBeenCalled()
  })
})
