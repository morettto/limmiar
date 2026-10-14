import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '@lingui/react'
import { i18n } from '@lingui/core'
import { AuditPage } from './AuditPage'

vi.mock('../../features/audit-trail/AuditTrail', () => ({ AuditTrail: vi.fn(() => <div data-testid="audit-trail" />) }))

i18n.loadAndActivate({ locale: 'pt-BR', messages: {} })

afterEach(cleanup)

describe('AuditPage', () => {
  it('mostra o título e a trilha', () => {
    render(<I18nProvider i18n={i18n}><AuditPage baseUrl="http://api" accountId="a1" accessToken="t" /></I18nProvider>)
    expect(screen.getByRole('heading', { name: 'Trilha de auditoria' })).toBeTruthy()
    expect(screen.getByTestId('audit-trail')).toBeTruthy()
  })
})
