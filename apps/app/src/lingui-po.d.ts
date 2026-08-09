// Ambient typing for statically-imported .po catalogs (e.g.
// src/test-support/ct-i18n.tsx's `import { messages } from '../locales/pt-BR/messages.po'`).
// @lingui/vite-plugin compiles .po -> JS at request time (see that file's own
// comment for why this import needs to stay static + literal), but plain
// `tsc -b` has no bundler plugin to resolve the module through -- without
// this declaration, `tsc -b` (this app's "build" script) fails with
// TS2307 "Cannot find module '...messages.po'" even though Vite/Playwright CT
// resolve it fine at runtime.
declare module '*.po' {
  import type { Messages } from '@lingui/core'

  export const messages: Messages
}
