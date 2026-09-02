import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBreakpoint } from './use-breakpoint'

// jsdom has no matchMedia. This fake evaluates `(min-width: Npx)` against a shared
// mutable width and fires real 'change' events, exercising the hook's own
// subscribe/unsubscribe wiring instead of stubbing the hook.
class FakeMediaQueryList extends EventTarget {
  readonly media: string
  private readonly minWidth: number
  private readonly state: { width: number }

  constructor(query: string, state: { width: number }) {
    super()
    this.media = query
    this.state = state
    const match = /min-width:\s*(\d+)px/.exec(query)
    this.minWidth = match ? Number(match[1]) : 0
  }

  get matches() {
    return this.state.width >= this.minWidth
  }

  addListener() {}
  removeListener() {}
}

function installFakeMatchMedia(initialWidth: number) {
  const state = { width: initialWidth }
  const lists = new Map<string, FakeMediaQueryList>()

  window.matchMedia = (query: string) => {
    let list = lists.get(query)
    if (!list) {
      list = new FakeMediaQueryList(query, state)
      // spyOn wraps the real EventTarget methods (so dispatch still works)
      // while also recording the exact arguments each was called with.
      vi.spyOn(list, 'addEventListener')
      vi.spyOn(list, 'removeEventListener')
      lists.set(query, list)
    }
    return list as unknown as MediaQueryList
  }

  return {
    setWidth(width: number) {
      state.width = width
      for (const list of lists.values()) {
        list.dispatchEvent(new Event('change'))
      }
    },
    getLists() {
      return [...lists.values()]
    },
  }
}

describe('useBreakpoint', () => {
  let originalMatchMedia: typeof window.matchMedia

  beforeEach(() => {
    originalMatchMedia = window.matchMedia
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  it('reports sm below 768px (mobile bucket)', () => {
    installFakeMatchMedia(767)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('sm')
  })

  it('reports md between 768 and 1023px (tablet retrato)', () => {
    installFakeMatchMedia(768)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('md')

    installFakeMatchMedia(1023)
    const { result: upperEdge } = renderHook(() => useBreakpoint())
    expect(upperEdge.current).toBe('md')
  })

  it('reports lg between 1024 and 1279px (tablet paisagem)', () => {
    installFakeMatchMedia(1024)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('lg')

    installFakeMatchMedia(1279)
    const { result: upperEdge } = renderHook(() => useBreakpoint())
    expect(upperEdge.current).toBe('lg')
  })

  it('reports xl at or above 1280px (desktop)', () => {
    installFakeMatchMedia(1280)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('xl')
  })

  it('re-renders with the new bucket when the viewport crosses a threshold', () => {
    const media = installFakeMatchMedia(500)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('sm')

    act(() => {
      media.setWidth(1440)
    })
    expect(result.current).toBe('xl')

    act(() => {
      media.setWidth(900)
    })
    expect(result.current).toBe('md')
  })

  it('subscribes to the "change" event on every media-query list, and unsubscribes on unmount', () => {
    const media = installFakeMatchMedia(500)
    const { unmount } = renderHook(() => useBreakpoint())

    const lists = media.getLists()
    expect(lists).toHaveLength(3)
    for (const list of lists) {
      expect(list.addEventListener).toHaveBeenCalledExactlyOnceWith('change', expect.any(Function))
    }

    unmount()

    for (const list of lists) {
      expect(list.removeEventListener).toHaveBeenCalledExactlyOnceWith('change', expect.any(Function))
    }
  })
})
