import type { ReactNode } from 'react'
import { useBreakpoint } from './use-breakpoint'
import { useDisclosure } from './use-disclosure'

export interface AdaptivePanelProps {
  children: ReactNode
  /** Accessible name for the panel, and the disclosure trigger's label at T/M. */
  label: string
}

/**
 * R5 — Painel lateral: coluna fixa (D), gaveta de 40% (T), faixa recolhível (M).
 * Closed by default at T/M: the wireframe's remembered state is an application
 * concern for the screens this composes into (S02+), not this primitive's.
 */
export function AdaptivePanel({ children, label }: AdaptivePanelProps) {
  const breakpoint = useBreakpoint()
  const { isOpen, id: panelId, triggerProps } = useDisclosure()

  if (breakpoint === 'xl') {
    return (
      <div aria-label={label} className="w-64 shrink-0 border-l border-neutral-300 p-3">
        {children}
      </div>
    )
  }

  if (breakpoint === 'sm') {
    return (
      <div className="rounded-lg border border-neutral-300">
        <button {...triggerProps} className="flex min-h-11 w-full items-center justify-between px-3 text-left">
          {label}
        </button>
        {isOpen && (
          <div id={panelId} className="border-t border-neutral-300 p-3">
            {children}
          </div>
        )}
      </div>
    )
  }

  // md/lg (T): 40%-width on-demand drawer over the content.
  return (
    <div className="relative">
      <button {...triggerProps} className="min-h-11 min-w-11 rounded-md border border-neutral-300 px-3">
        {label}
      </button>
      {isOpen && (
        <div
          id={panelId}
          aria-label={label}
          className="absolute inset-y-0 right-0 w-2/5 border-l border-neutral-300 bg-white p-3 shadow-lg"
        >
          {children}
        </div>
      )}
    </div>
  )
}
