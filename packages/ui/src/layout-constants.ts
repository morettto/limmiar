/**
 * Rendered height (px) of AdaptiveNav's M bottom bar. Single source of
 * truth so HeaderAction's `stackAboveMobileNav` offset never silently
 * drifts from AdaptiveNav's actual layout; kept honest by a boundingBox()
 * assertion in AdaptiveNav.spec.tsx (measured with the overflow "Mais"
 * trigger present, which renders 2px taller than a bar with no overflow).
 */
export const MOBILE_NAV_HEIGHT_PX = 47
