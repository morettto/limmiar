import type { ReactNode } from 'react'
import { MOBILE_NAV_HEIGHT_PX } from './layout-constants'

export interface HeaderActionProps {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  disabled?: boolean
  'aria-label'?: string
  /**
   * Set when this HeaderAction shares an M screen with an AdaptiveNav bottom bar
   * (P1-M's "Iniciar sessão"): without it both `fixed` elements sit at `bottom-4`
   * and overlap, and R4 requires this bar above the nav.
   */
  stackAboveMobileNav?: boolean
}

const BASE_GAP_PX = 16 // matches the previous flat `bottom-4`

/**
 * R4 — Ação primária: header button (D/T) to a fixed 48px footer bar above the
 * nav (M), purely CSS-responsive. Heights follow the spec's "Alvos e densidade"
 * table; the inline `bottom` is inert from md up, where `md:static` applies.
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
