import type { ReactNode } from 'react'

export interface KpiStripItemProps {
  label: string
  value: ReactNode
}

function KpiStripItem({ label, value }: KpiStripItemProps) {
  return (
    <div className="min-w-[65%] shrink-0 snap-start rounded-lg border border-neutral-300 bg-white p-3 md:min-w-0 md:shrink md:snap-none">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-xl text-neutral-900">{value}</div>
    </div>
  )
}

export interface KpiStripProps {
  children: ReactNode
  /** Accessible name for the group — override with what the KPIs are of. */
  'aria-label'?: string
}

/**
 * R6 — KPIs: 4 col (D), 2×2 (T), carrossel com snap (M), purely CSS-responsive.
 * `tabIndex={0}` is unconditional: below md the strip scrolls and WCAG 2.1.1
 * requires it reachable by keyboard; from md up it is a harmless attribute.
 */
export function KpiStrip({ children, 'aria-label': ariaLabel = 'Indicadores' }: KpiStripProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      tabIndex={0}
      className="flex snap-x snap-mandatory gap-3 overflow-x-auto md:grid md:grid-cols-2 md:snap-none md:overflow-visible xl:grid-cols-4"
    >
      {children}
    </div>
  )
}

KpiStrip.Item = KpiStripItem
