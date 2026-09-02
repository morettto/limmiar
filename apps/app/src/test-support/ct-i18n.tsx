import type { ReactNode } from 'react'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
// @lingui/vite-plugin compiles .po to JS at request time, so this static import needs
// playwright-ct.config.ts's ctViteConfig to include lingui() — the same way it needs the babel macro
// preset — or it never resolves.
import { messages } from '../locales/pt-BR/messages.po'

// CT mounts AuthScreen directly, bypassing the boot sequence that loads a catalog, and its copy is
// entirely Lingui macros, which render blank without one. Activating at module-evaluation time
// leaves no async gap for a screenshot to race. pt-BR only: S02-01's AC is 4 breakpoints, no locales.
i18n.loadAndActivate({ locale: 'pt-BR', messages })

export function CtI18nProvider({ children }: { children: ReactNode }) {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>
}
