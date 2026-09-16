import { beforeAll, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n, dynamicActivate } from '../../shared/i18n'
import { ContactoEmergencia } from './ContactoEmergencia'

function renderContacto() {
  return render(
    <I18nProvider i18n={i18n}>
      <ContactoEmergencia />
    </I18nProvider>,
  )
}

describe('ContactoEmergencia', () => {
  beforeAll(async () => {
    await dynamicActivate('pt-BR')
  })

  it('renders a nav landmark with tel: links to CVV 188 and SAMU 192, CVV first', () => {
    renderContacto()

    const nav = screen.getByRole('navigation', { name: 'Contacto de emergência' })
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(2)
    expect(nav.contains(links[0]!)).toBe(true)
    expect(links[0]!.getAttribute('href')).toBe('tel:188')
    expect(links[1]!.getAttribute('href')).toBe('tel:192')
  })

  it('the CVV link is the first focusable element (first Tab stop)', () => {
    renderContacto()

    const links = screen.getAllByRole('link')
    links[0]!.focus()
    expect(document.activeElement).toBe(links[0])
  })
})
