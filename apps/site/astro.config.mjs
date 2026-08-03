import { defineConfig } from 'astro/config'
import { LOCALES, BASE_LOCALE } from '@limmiar/i18n'

export default defineConfig({
  // Placeholder domain — replacing with the real production domain is a
  // follow-up, out of scope for this ticket.
  site: 'https://limmiar.example',
  i18n: {
    locales: [...LOCALES],
    defaultLocale: BASE_LOCALE,
    routing: {
      prefixDefaultLocale: true,
    },
  },
})
