import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n } from '@lingui/core'
import { CopilotPage } from './CopilotPage'

i18n.loadAndActivate({ locale: 'pt-BR', messages: {} })

afterEach(() => { cleanup(); localStorage.clear() })

describe('CopilotPage', () => {
  it('mostra só o interruptor de envio dos votos da conta e o aviso', () => {
    localStorage.setItem('limmiar:voto-consentimento:a1', 'sim')
    render(<I18nProvider i18n={i18n}><CopilotPage accountId="a1" /></I18nProvider>)
    expect(screen.getByRole('heading', { name: 'Votos do copiloto de IA' })).toBeTruthy()
    expect(screen.getByText(/ficam cifrados neste aparelho/)).toBeTruthy()
    expect(screen.getAllByRole('switch')).toHaveLength(1)
    expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
