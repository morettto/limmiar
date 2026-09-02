// Ambient typing for statically-imported .po catalogs (see test-support/ct-i18n.tsx).
// @lingui/vite-plugin compiles .po to JS at request time, but plain `tsc -b` has no such plugin —
// without this declaration the build fails with TS2307 even though Vite resolves it fine.
declare module '*.po' {
  import type { Messages } from '@lingui/core'

  export const messages: Messages
}
