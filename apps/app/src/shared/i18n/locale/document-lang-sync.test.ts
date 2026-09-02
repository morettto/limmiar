import { afterEach, describe, expect, it, vi } from 'vitest'
import { setupI18n } from '@lingui/core'
import { syncDocumentLang } from './document-lang-sync'

describe('syncDocumentLang', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('applies the instance current locale to document.documentElement.lang immediately on call', () => {
    const instance = setupI18n({ locale: 'it-IT', messages: { 'it-IT': {} } })

    syncDocumentLang(instance)

    expect(document.documentElement.lang).toBe('it-IT')
  })

  it('updates document.documentElement.lang after a subsequent activate() (a live switch)', () => {
    const instance = setupI18n({
      locale: 'pt-BR',
      messages: { 'pt-BR': {}, 'en-US': {} },
    })

    syncDocumentLang(instance)
    expect(document.documentElement.lang).toBe('pt-BR')

    instance.activate('en-US')

    expect(document.documentElement.lang).toBe('en-US')
  })

  it('leaves document.documentElement.lang unchanged when a dynamicActivate-style import genuinely rejects', async () => {
    const instance = setupI18n({ locale: 'pt-BR', messages: { 'pt-BR': {} } })
    syncDocumentLang(instance)
    expect(document.documentElement.lang).toBe('pt-BR')

    // Same technique as i18n.test.ts: importing a locale with no compiled catalog really
    // rejects — a genuine failure, not a mock. The path must stay a template literal so Vite
    // resolves it at runtime; activate() is never reached, so 'change' correctly never fires.
    const locale = 'xx-XX'
    await expect(import(`../locales/${locale}/messages.po`)).rejects.toBeDefined()

    expect(document.documentElement.lang).toBe('pt-BR')
  })
})
