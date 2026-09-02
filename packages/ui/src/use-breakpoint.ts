import { useSyncExternalStore } from 'react'

export type Breakpoint = 'sm' | 'md' | 'lg' | 'xl'

// The spec's 4 buckets: sm ≤767 / md 768–1023 / lg 1024–1279 / xl ≥1280, equal to
// Tailwind v4's md/lg/xl defaults, so components use plain `md:`/`lg:`/`xl:`.
// Never Tailwind's own `sm:` (640px), which is not one of the 4 buckets.
const QUERY_MD = '(min-width: 768px)'
const QUERY_LG = '(min-width: 1024px)'
const QUERY_XL = '(min-width: 1280px)'

function getSnapshot(): Breakpoint {
  if (window.matchMedia(QUERY_XL).matches) return 'xl'
  if (window.matchMedia(QUERY_LG).matches) return 'lg'
  if (window.matchMedia(QUERY_MD).matches) return 'md'
  return 'sm'
}

function subscribe(onStoreChange: () => void): () => void {
  const mdList = window.matchMedia(QUERY_MD)
  const lgList = window.matchMedia(QUERY_LG)
  const xlList = window.matchMedia(QUERY_XL)

  mdList.addEventListener('change', onStoreChange)
  lgList.addEventListener('change', onStoreChange)
  xlList.addEventListener('change', onStoreChange)

  return () => {
    mdList.removeEventListener('change', onStoreChange)
    lgList.removeEventListener('change', onStoreChange)
    xlList.removeEventListener('change', onStoreChange)
  }
}

/**
 * Width-only breakpoint bucket (R1–R12: never detect device by user-agent).
 * Structural JSX branching reads this; purely visual differences inside a branch
 * use Tailwind's `md:`/`lg:`/`xl:` utilities.
 */
export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, getSnapshot)
}
