import type { ReactNode } from 'react'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
// @lingui/vite-plugin compiles .po -> JS at request time (same mechanism
// apps/app/src/i18n.ts's dynamicActivate() relies on for its dynamic
// `import(...)`); this static import needs playwright-ct.config.ts's
// ctViteConfig to include lingui() the same way it needs
// @rolldown/plugin-babel's macro preset, or it never resolves.
import { messages } from '../locales/pt-BR/messages.po'

// Component Testing mounts AuthScreen directly, bypassing apps/app's normal
// boot sequence (main.tsx -> App.tsx's `bootLocale()`, see src/i18n.ts) that
// loads and activates a Lingui catalog before anything renders. AuthScreen's
// copy is entirely <Trans>/t (Lingui macros), which need an active i18n
// instance with loaded messages -- without one they render blank. Activating
// synchronously at module-evaluation time (not inside a mounted component's
// effect, and not via i18n.ts's async dynamicActivate()) means the catalog
// is guaranteed loaded before AuthScreen's first render, with no async gap
// for a screenshot/axe scan to race against.
//
// pt-BR only, not apps/app's other 3 catalogs (or packages/ui's 5-value
// VISUAL_LOCALES/pseudo-locale matrix): S02-01's confirmed AC is "A1 verde
// nos 4 breakpoints com axe bloqueante" -- 4 breakpoints, no locale matrix.
// A locale-matrix visual-regression harness for apps/app screens is real,
// separate scope better done as its own ticket/AC than assumed here.
i18n.loadAndActivate({ locale: 'pt-BR', messages })

/** Wraps a mounted component with the same I18nProvider apps/app's real component tree uses, pre-activated with the pt-BR catalog (see module doc above). */
export function CtI18nProvider({ children }: { children: ReactNode }) {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>
}
