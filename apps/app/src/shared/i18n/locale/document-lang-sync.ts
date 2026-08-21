import type { I18n } from '@lingui/core'

// Single dedicated place that keeps document.documentElement.lang in sync
// with the active Lingui locale — not a side effect scattered across every
// call site that might change it. Lingui's 'change' event fires from both
// activate() and loadAndActivate(), so this covers boot and every later
// switch uniformly. dynamicActivate's catch block (apps/app/src/i18n.ts)
// never calls either of those on a failed catalog load, so 'change'
// correctly never fires on fallback — document.documentElement.lang simply
// stays whatever it already was, which is exactly the desired behavior.
export function syncDocumentLang(i18nInstance: I18n): void {
  const applyLang = () => {
    document.documentElement.lang = i18nInstance.locale
  }
  applyLang()
  i18nInstance.on('change', applyLang)
}
