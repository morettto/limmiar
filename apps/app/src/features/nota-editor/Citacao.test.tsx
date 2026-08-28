import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../../shared/i18n'
import { Citacao } from './Citacao'

describe('Citacao', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  afterEach(() => cleanup())

  it('mostra o intervalo formatado mm:ss–mm:ss', () => {
    render(
      <I18nProvider i18n={i18n}>
        <Citacao ancora={{ inicioMs: 5000, fimMs: 65000 }} aoTocar={vi.fn()} />
      </I18nProvider>,
    )

    expect(screen.getByRole('button').textContent).toBe('0:05–1:05')
  })

  it('chama aoTocar com a própria âncora ao clicar', () => {
    const aoTocar = vi.fn()
    const ancora = { inicioMs: 0, fimMs: 1000 }
    render(
      <I18nProvider i18n={i18n}>
        <Citacao ancora={ancora} aoTocar={aoTocar} />
      </I18nProvider>,
    )

    fireEvent.click(screen.getByRole('button'))

    expect(aoTocar).toHaveBeenCalledWith(ancora)
  })

  // Critério de aceite: "ao passar o rato" toca o instante -- caminho do mouse.
  it('chama aoTocar com a própria âncora ao passar o rato por cima', () => {
    const aoTocar = vi.fn()
    const ancora = { inicioMs: 3000, fimMs: 4000 }
    render(
      <I18nProvider i18n={i18n}>
        <Citacao ancora={ancora} aoTocar={aoTocar} />
      </I18nProvider>,
    )

    fireEvent.mouseEnter(screen.getByRole('button'))

    expect(aoTocar).toHaveBeenCalledWith(ancora)
  })

  // Um caminho que só o rato dispara quebra o critério de teclado da mesma spec --
  // dar foco (Tab) tem de tocar o mesmo instante para quem não usa mouse.
  it('chama aoTocar com a própria âncora ao ganhar foco pelo teclado', () => {
    const aoTocar = vi.fn()
    const ancora = { inicioMs: 7000, fimMs: 8000 }
    render(
      <I18nProvider i18n={i18n}>
        <Citacao ancora={ancora} aoTocar={aoTocar} />
      </I18nProvider>,
    )

    fireEvent.focus(screen.getByRole('button'))

    expect(aoTocar).toHaveBeenCalledWith(ancora)
  })

  it('tem aria-label descritivo com o intervalo', () => {
    render(
      <I18nProvider i18n={i18n}>
        <Citacao ancora={{ inicioMs: 0, fimMs: 1000 }} aoTocar={vi.fn()} />
      </I18nProvider>,
    )

    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Tocar áudio de 0:00 a 0:01')
  })
})
