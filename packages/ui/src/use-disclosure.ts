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
 * Shared show/hide-behind-a-trigger state for every primitive that collapses a
 * region at some breakpoint (AdaptiveNav, AdaptivePanel, Columns): same
 * aria-expanded/aria-controls wiring, only label and revealed content differ.
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
