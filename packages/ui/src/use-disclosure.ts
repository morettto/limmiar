import { useId, useState } from 'react'

export interface UseDisclosureResult {
  isOpen: boolean
  /** Unique id linking the disclosure's trigger to its revealed content via aria-controls. */
  id: string
  /** Spread directly onto the trigger `<button>` — type, click handler, and both aria attrs. */
  triggerProps: {
    type: 'button'
    onClick: () => void
    'aria-expanded': boolean
    'aria-controls': string
  }
}

/**
 * Shared show/hide-behind-a-trigger state, used by every primitive that
 * collapses a region behind a button at some breakpoint (AdaptiveNav's T
 * rail drawer and M overflow menu, AdaptivePanel's T/M disclosure,
 * Columns' T drawer) — same aria-expanded/aria-controls wiring each time,
 * only the trigger's label/className and the revealed content differ.
 */
export function useDisclosure(): UseDisclosureResult {
  const [isOpen, setIsOpen] = useState(false)
  const id = useId()

  return {
    isOpen,
    id,
    triggerProps: {
      type: 'button',
      onClick: () => setIsOpen((open) => !open),
      'aria-expanded': isOpen,
      'aria-controls': id,
    },
  }
}
