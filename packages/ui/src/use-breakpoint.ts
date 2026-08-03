import { useSyncExternalStore } from 'react'

export type Breakpoint = 'sm' | 'md' | 'lg' | 'xl'

// Matches the wireframe spec's 4 buckets exactly — sm ≤767 / md 768–1023 /
// lg 1024–1279 / xl ≥1280 (Wireframes - Responsivo (3 plataformas).dc.html,
// "Nomenclatura, breakpoints e regras"). These also happen to equal Tailwind
// v4's default md/lg/xl thresholds, so components style with plain
// `md:`/`lg:`/`xl:` utilities and never need custom breakpoint config — the
// one rule is to never use Tailwind's own `sm:` (640px), which isn't one of
// the spec's 4 buckets; unprefixed utilities already cover "sm" as the base.
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
 * Width-only breakpoint bucket (R1–R12's mandate: never detect device by
 * user-agent). Structural JSX branching in the 7 primitives reads this;
 * pure visual/layout differences within a branch use Tailwind's
 * `md:`/`lg:`/`xl:` utilities directly instead.
 */
export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, getSnapshot)
}
