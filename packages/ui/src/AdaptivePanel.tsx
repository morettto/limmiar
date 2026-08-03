import { type ReactNode, useId, useState } from 'react'
import { useBreakpoint } from './use-breakpoint'

export interface AdaptivePanelProps {
  children: ReactNode
  /** Accessible name for the panel, and the disclosure trigger's label at T/M. */
  label: string
}

/**
 * R5 — Painel lateral: coluna fixa (D) → gaveta de 40% sob demanda (T) →
 * faixa recolhível no topo do conteúdo (M). Closed by default at T/M — the
 * wireframe's "estado lembrado" (remembered across the session) is an
 * application-level concern for the real screens this composes into later
 * (S02+), not this primitive's own contract.
 */
export function AdaptivePanel({ children, label }: AdaptivePanelProps) {
  const breakpoint = useBreakpoint()
  const [isOpen, setIsOpen] = useState(false)
  const panelId = useId()

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
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          aria-controls={panelId}
          className="flex min-h-11 w-full items-center justify-between px-3 text-left"
        >
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
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="min-h-11 min-w-11 rounded-md border border-neutral-300 px-3"
      >
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
