import type { Locale } from '@limmiar/i18n'

export interface PageContent {
  title: string
  body: string
}

/**
 * The "coming soon" placeholder page's copy, one entry per configured
 * locale. Single source of truth looked up by each src/pages/<locale>/index.astro
 * instead of hardcoding the translated string separately in every file
 * (ADR-S00.5-02: Astro's native i18n — a TS dictionary + a static route per
 * locale, no library). Typed as Record<Locale, PageContent> so adding a 5th
 * locale without an entry here is a compile error.
 *
 * Real marketing copy is out of scope — a later Spec (S16) replaces this
 * placeholder with actual site content.
 */
export const content: Record<Locale, PageContent> = {
  'pt-BR': { title: 'Limmiar — Em breve', body: 'Em breve.' },
  'en-US': { title: 'Limmiar — Coming soon', body: 'Coming soon.' },
  'es-419': { title: 'Limmiar — Próximamente', body: 'Próximamente.' },
  'it-IT': { title: 'Limmiar — Prossimamente', body: 'Prossimamente.' },
}
