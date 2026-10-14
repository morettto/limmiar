import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { LOCALE_STORAGE_KEY } from '../../shared/i18n/locale/local-storage-locale-store'
import { LanguageSwitcher } from './LanguageSwitcher'

function renderSwitcher() {
  return render(<I18nProvider i18n={i18n}><LanguageSwitcher /></I18nProvider>)
}

beforeEach(async () => dynamicActivate('pt-BR'))
afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('seletor de idioma', () => {
  it('oferece os 4 idiomas, cada um no próprio nome, com o idioma ativo selecionado', () => {
    renderSwitcher()

    const seletor = screen.getByRole('combobox', { name: 'Idioma' })
    const opcoes = screen.getAllByRole('option').map((opcao) => [opcao.textContent, opcao.getAttribute('value')])

    expect(opcoes).toEqual([['Português', 'pt-BR'], ['Español', 'es-419'], ['Italiano', 'it-IT'], ['English', 'en-US']])
    expect(seletor).toHaveProperty('value', 'pt-BR')
    expect(screen.getByRole('navigation', { name: 'Idioma' })).toBeTruthy()
  })

  it('troca o idioma ativo, grava a escolha no aparelho e traduz o próprio rótulo', async () => {
    renderSwitcher()

    fireEvent.change(screen.getByRole('combobox', { name: 'Idioma' }), { target: { value: 'en-US' } })

    expect(await screen.findByRole('combobox', { name: 'Language' })).toHaveProperty('value', 'en-US')
    expect(i18n.locale).toBe('en-US')
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en-US')
  })
})
