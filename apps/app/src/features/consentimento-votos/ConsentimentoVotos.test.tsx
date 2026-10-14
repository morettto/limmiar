import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { dynamicActivate, i18n } from '../../shared/i18n'
import { lerConsentimento } from '../../entities/insight/consentimento-voto'
import { ConsentimentoVotos } from './ConsentimentoVotos'

beforeAll(async () => dynamicActivate('pt-BR'))
afterEach(() => { cleanup(); localStorage.clear() })

describe('interruptor de envio de votos', () => {
  it('começa desligado sem escolha e grava sim / nao ao alternar', () => {
    render(<I18nProvider i18n={i18n}><ConsentimentoVotos accountId="c1" /></I18nProvider>)
    const chave = screen.getByRole('switch') as HTMLInputElement
    expect(chave.checked).toBe(false)
    fireEvent.click(chave)
    expect(lerConsentimento('c1')).toBe('sim')
    fireEvent.click(chave)
    expect(lerConsentimento('c1')).toBe('nao')
  })
  it('reflete o consentimento já gravado', () => {
    localStorage.setItem('limmiar:voto-consentimento:c1', 'sim')
    render(<I18nProvider i18n={i18n}><ConsentimentoVotos accountId="c1" /></I18nProvider>)
    expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(true)
  })
})
