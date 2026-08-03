import type { ReactNode } from 'react'
import { MOBILE_NAV_HEIGHT_PX } from './layout-constants'

export interface HeaderActionProps {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  disabled?: boolean
  'aria-label'?: string
  /**
   * Set when this HeaderAction is composed on the same M screen as an
   * AdaptiveNav bottom bar (e.g. P1-M's "Iniciar sessão" — see the
   * wireframe). Without it the two `fixed` elements would sit at the same
   * `bottom-4` and overlap; R4 requires this bar sit "acima da nav".
   */
  stackAboveMobileNav?: boolean
}

const BASE_GAP_PX = 16 // matches the previous flat `bottom-4`

/**
 * R4 — Ação primária: botão no cabeçalho (D/T) → barra fixa no rodapé, 48px,
 * acima da navegação (M). Purely CSS-responsive (same button, same
 * semantics — only position/size change), so no useBreakpoint dependency.
 *
 * Target height follows the spec's own "Alvos e densidade" table, not just
 * R4's 48px (that number is M-specific): min-h-12 (48px) at sm, min-h-11
 * (44px, T's touch minimum) from md, min-h-8 (32px, D's mouse minimum) from xl.
 *
 * The inline `bottom` style below is inert from md up: `md:static` makes
 * the element `position: static`, and `bottom` only applies to positioned
 * elements per the CSS spec — so `stackAboveMobileNav` never affects T/D.
 */
export function HeaderAction({
  children,
  onClick,
  type = 'button',
  disabled,
  'aria-label': ariaLabel,
  stackAboveMobileNav = false,
}: HeaderActionProps) {
  const bottom = stackAboveMobileNav ? MOBILE_NAV_HEIGHT_PX + BASE_GAP_PX : BASE_GAP_PX

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{ bottom }}
      className="fixed inset-x-4 z-10 min-h-12 rounded-lg bg-neutral-900 px-4 text-sm text-white shadow-lg md:static md:inset-auto md:mb-0 md:min-h-11 md:w-auto md:shadow-none xl:min-h-8"
    >
      {children}
    </button>
  )
}
