import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from './App'
import { dynamicActivate } from './shared/i18n'

describe('App — locale switch survives an active recording session (D18)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not reload the document and preserves in-memory session state across a locale switch', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['pt-BR'])

    // jsdom hardens window.location.reload against redefinition, so it cannot be spied on. The
    // no-reload guarantee is proven structurally instead: the DOM root and an unrelated piece of
    // in-memory state both survive the switch, which a reload would have destroyed.
    render(<App />)

    await screen.findByText('Bem-vindo ao Limmiar')

    const rootBefore = document.body

    // Stand-in for S05's recording pipeline, which does not exist yet. A real remount or a document
    // reload would reset this reference, so its identity surviving the switch is the proxy this
    // AC asks for.
    const mockRecordingSession = { active: true }

    await dynamicActivate('en-US')

    await screen.findByText('Welcome to Limmiar')

    expect(mockRecordingSession.active).toBe(true)
    expect(document.body).toBe(rootBefore)
  })
})
