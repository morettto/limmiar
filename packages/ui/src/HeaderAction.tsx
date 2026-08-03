import type { ReactNode } from 'react'

export interface HeaderActionProps {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  disabled?: boolean
  'aria-label'?: string
}

/**
 * R4 — Ação primária: botão no cabeçalho (D/T) → barra fixa no rodapé, 48px,
 * acima da navegação (M). Purely CSS-responsive (same button, same
 * semantics — only position/size change), so no useBreakpoint dependency.
 *
 * Target height follows the spec's own "Alvos e densidade" table, not just
 * R4's 48px (that number is M-specific): min-h-12 (48px) at sm, min-h-11
 * (44px, T's touch minimum) from md, min-h-8 (32px, D's mouse minimum) from xl.
 */
export function HeaderAction({
  children,
  onClick,
  type = 'button',
  disabled,
  'aria-label': ariaLabel,
}: HeaderActionProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="fixed inset-x-4 bottom-4 z-10 min-h-12 rounded-lg bg-neutral-900 px-4 text-sm text-white shadow-lg md:static md:inset-auto md:mb-0 md:min-h-11 md:w-auto md:shadow-none xl:min-h-8"
    >
      {children}
    </button>
  )
}
