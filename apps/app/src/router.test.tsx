import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'

describe('router', () => {
  it('resolves the index route ("/") and renders the app shell', async () => {
    // Re-import the module fresh inside the test (rather than importing the
    // singleton at file scope) so route construction runs as part of this
    // test's own call stack. Stryker's perTest coverage analysis can only
    // attribute mutations to a test when the mutated code actually executes
    // during that test; module-top-level construction that only runs once
    // at import time is invisible to it and gets misreported as "survived".
    vi.resetModules()
    const { router } = await import('./router')

    render(<RouterProvider router={router} />)

    const shell = await screen.findByText('Limmiar')

    expect(shell.id).toBe('app-shell')
    expect(shell.textContent).toBe('Limmiar')

    const matches = router.state.matches
    expect(matches).toHaveLength(2)
    expect(matches[0]?.routeId).toBe('__root__')
    expect(matches[1]?.routeId).toBe('/')
    expect(matches[1]?.fullPath).toBe('/')
  })
})
