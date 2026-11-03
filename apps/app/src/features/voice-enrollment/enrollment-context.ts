import { createContext } from 'react'

export const VoiceEnrollmentContext = createContext<((ready: boolean) => void) | undefined>(undefined)
