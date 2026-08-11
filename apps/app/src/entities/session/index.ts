export type { KeyValueStorage } from './session'
export { createSessionRecorder } from './session'

import { createSessionRecorder } from './session'

// The one place this module reaches for the real browser storage -- every caller that
// needs to persist the signed-in account's session goes through this ready-made recorder
// instead of touching `window.sessionStorage` directly.
export const recordSession = createSessionRecorder(window.sessionStorage)
