import { type ReactNode, useId, useState } from 'react'
import { useBreakpoint } from './use-breakpoint'

export interface ColumnsProps {
  /** Primary content — 1st column at D, stays visible at T, last at M. */
  content: ReactNode
  /** Secondary column — 2nd at D and T, middle at M. */
  alert: ReactNode
  /** Tertiary column — 3rd at D, an on-demand drawer at T, first at M. */
  action: ReactNode
  /** Accessible name for the drawer trigger that reveals `action` at T. */
  actionLabel?: string
}

/**
 * R2 — Colunas: 3 col (D) → 2 col, a 3ª vira gaveta (T) → 1 col empilhada na
 * ordem ação › alerta › conteúdo (M).
 */
export function Columns({ content, alert, action, actionLabel = 'Mais' }: ColumnsProps) {
  const breakpoint = useBreakpoint()
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const drawerId = useId()

  if (breakpoint === 'sm') {
    return (
      <div className="flex flex-col gap-4">
        <div>{action}</div>
        <div>{alert}</div>
        <div>{content}</div>
      </div>
    )
  }

  if (breakpoint === 'xl') {
    return (
      <div className="grid grid-cols-3 gap-4">
        <div>{content}</div>
        <div>{alert}</div>
        <div>{action}</div>
      </div>
    )
  }

  // md/lg (T): the 3rd column becomes a 40%-width on-demand drawer.
  return (
    <div className="relative flex gap-4">
      <div className="min-w-0 flex-1">{content}</div>
      <div className="min-w-0 flex-1">{alert}</div>
      <button
        type="button"
        onClick={() => setIsDrawerOpen((open) => !open)}
        aria-expanded={isDrawerOpen}
        aria-controls={drawerId}
        className="min-h-11 min-w-11 self-start rounded-md border border-neutral-300 px-3"
      >
        {actionLabel}
      </button>
      {isDrawerOpen && (
        <div
          id={drawerId}
          className="absolute inset-y-0 right-0 w-2/5 border-l border-neutral-300 bg-white p-3 shadow-lg"
        >
          {action}
        </div>
      )}
    </div>
  )
}
