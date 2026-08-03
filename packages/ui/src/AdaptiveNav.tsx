import { type ReactNode, useId, useState } from 'react'
import { useBreakpoint } from './use-breakpoint'

export interface AdaptiveNavItem {
  key: string
  label: string
  icon: ReactNode
  href: string
  current?: boolean
}

export interface AdaptiveNavProps {
  items: AdaptiveNavItem[]
  /** Accessible name for the nav landmark, and the T rail's toggle button. */
  brandLabel?: string
  /** Label for the M bottom-bar overflow trigger, when there are >5 items. */
  moreLabel?: string
}

const MAX_BOTTOM_BAR_ITEMS = 5
// One slot is reserved for the "Mais" trigger itself when there's overflow.
const MAX_VISIBLE_BEFORE_OVERFLOW = MAX_BOTTOM_BAR_ITEMS - 1

/**
 * R1 — Navegação: sidebar 150px (D) → rail de ícones 72px, rótulo em gaveta
 * (T) → barra inferior com 5 itens + "Mais" (M).
 */
export function AdaptiveNav({ items, brandLabel = 'Menu', moreLabel = 'Mais' }: AdaptiveNavProps) {
  const breakpoint = useBreakpoint()
  const [isOpen, setIsOpen] = useState(false)
  const panelId = useId()

  if (breakpoint === 'xl') {
    return (
      <nav aria-label={brandLabel} className="flex w-[150px] shrink-0 flex-col gap-1 border-r border-neutral-300 p-2">
        {items.map((item) => (
          <a
            key={item.key}
            href={item.href}
            aria-current={item.current ? 'page' : undefined}
            className="flex min-h-8 items-center gap-2 rounded-md px-2 text-sm"
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </a>
        ))}
      </nav>
    )
  }

  if (breakpoint === 'sm') {
    const hasOverflow = items.length > MAX_BOTTOM_BAR_ITEMS
    const visible = hasOverflow ? items.slice(0, MAX_VISIBLE_BEFORE_OVERFLOW) : items
    const overflow = hasOverflow ? items.slice(MAX_VISIBLE_BEFORE_OVERFLOW) : []

    return (
      <nav aria-label={brandLabel} className="fixed inset-x-0 bottom-0 z-10 flex border-t border-neutral-300 bg-white">
        {visible.map((item) => (
          <a
            key={item.key}
            href={item.href}
            aria-current={item.current ? 'page' : undefined}
            className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1 text-xs"
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </a>
        ))}
        {hasOverflow && (
          <div className="relative flex-1">
            <button
              type="button"
              onClick={() => setIsOpen((open) => !open)}
              aria-expanded={isOpen}
              aria-controls={panelId}
              className="flex min-h-11 w-full flex-col items-center justify-center gap-0.5 py-1 text-xs"
            >
              {moreLabel}
            </button>
            {isOpen && (
              <div
                id={panelId}
                className="absolute right-0 bottom-full mb-1 w-40 rounded-lg border border-neutral-300 bg-white p-1 shadow-lg"
              >
                {overflow.map((item) => (
                  <a
                    key={item.key}
                    href={item.href}
                    aria-current={item.current ? 'page' : undefined}
                    className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm"
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    {item.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </nav>
    )
  }

  // md/lg (T): 72px icon rail; the toggle ("logo") opens a labeled drawer.
  return (
    <nav
      aria-label={brandLabel}
      className="relative flex w-[72px] shrink-0 flex-col items-center gap-1 border-r border-neutral-300 p-2"
    >
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-label={brandLabel}
        className="mb-2 flex min-h-11 min-w-11 items-center justify-center rounded-md"
      >
        ☰
      </button>
      {items.map((item) => (
        <a
          key={item.key}
          href={item.href}
          aria-current={item.current ? 'page' : undefined}
          aria-label={item.label}
          className="flex min-h-11 w-11 items-center justify-center rounded-md"
        >
          <span aria-hidden="true">{item.icon}</span>
        </a>
      ))}
      {isOpen && (
        <div
          id={panelId}
          className="absolute inset-y-0 left-full z-10 w-40 border-r border-neutral-300 bg-white p-2 shadow-lg"
        >
          {items.map((item) => (
            <a
              key={item.key}
              href={item.href}
              aria-current={item.current ? 'page' : undefined}
              className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm"
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </a>
          ))}
        </div>
      )}
    </nav>
  )
}
