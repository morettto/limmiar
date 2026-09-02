import type { I18n } from '@lingui/core'

// Single place keeping document.documentElement.lang in sync with the active Lingui locale, rather
// than a side effect at every call site. Lingui's 'change' fires from activate() and
// loadAndActivate(), and never on a failed catalog load — so `lang` correctly stays put.
export function syncDocumentLang(i18nInstance: I18n): void {
  const applyLang = () => {
    document.documentElement.lang = i18nInstance.locale
  }
  applyLang()
  i18nInstance.on('change', applyLang)
}
