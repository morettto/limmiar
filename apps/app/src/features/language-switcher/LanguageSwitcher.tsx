import { useId } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { LOCALES, type Locale } from '@limmiar/i18n'
import { setLocale } from '../../shared/i18n'

// Endonyms: each language is named in itself, so it stays findable when the UI is in another one.
/* eslint-disable lingui/no-unlocalized-strings -- endonyms are never translated */
const NOMES_DOS_IDIOMAS: Record<Locale, string> = {
  'pt-BR': 'Português',
  'en-US': 'English',
  'es-419': 'Español',
  'it-IT': 'Italiano',
}
/* eslint-enable lingui/no-unlocalized-strings */

export function LanguageSwitcher() {
  const { i18n, t } = useLingui()
  const selectId = useId()
  return (
    <nav className="language-switcher" aria-label={t`Idioma`}>
      <label htmlFor={selectId}><Trans>Idioma</Trans></label>
      <select
        id={selectId}
        value={i18n.locale}
        // Every <option> value comes from LOCALES, so the cast cannot lie.
        onChange={(evento) => void setLocale(evento.target.value as Locale)}
      >
        {LOCALES.map((locale) => (
          <option key={locale} value={locale} lang={locale}>{NOMES_DOS_IDIOMAS[locale]}</option>
        ))}
      </select>
    </nav>
  )
}
