import { i18n } from '@lingui/core'
import { negotiateLocale, type Locale } from '@limmiar/i18n'

export { i18n }

export function initialLocale(): Locale {
  return negotiateLocale(navigator.languages)
}

export async function dynamicActivate(locale: Locale): Promise<void> {
  try {
    const { messages } = await import(`./locales/${locale}/messages.po`)
    i18n.loadAndActivate({ locale, messages })
  } catch (error) {
    // AC: a catalog load failure (network down, 404, bad chunk — anything
    // that rejects the dynamic import) must never crash the UI and must
    // leave whichever locale was active before this call still active.
    console.error(`i18n: failed to load catalog for locale "${locale}" — keeping "${i18n.locale}" active`, error)
  }
}
